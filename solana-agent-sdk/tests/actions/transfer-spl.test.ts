import {
  Keypair,
  PublicKey,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { transferSpl } from "../../src/actions/transfer-spl.js";
import { buildAndSend } from "../../src/tx/build.js";
import { MissingTokenAccountError } from "../../src/errors.js";

jest.mock("../../src/tx/build.js", () => ({ buildAndSend: jest.fn() }));

jest.mock("@solana/spl-token", () => ({
  ...jest.requireActual("@solana/spl-token"),
  getMint: jest.fn(),
}));

const mockBuildAndSend = jest.mocked(buildAndSend);
const mockGetMint = jest.mocked(getMint);

// Deterministic test keys
const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const RECIPIENT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const MINT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;

const SENDER_ATA = getAssociatedTokenAddressSync(
  MINT_PUBKEY, WALLET_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);
const RECEIVER_ATA = getAssociatedTokenAddressSync(
  MINT_PUBKEY, RECIPIENT_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);

const DECIMALS = 6;
const FAKE_ACCOUNT = { data: Buffer.alloc(0), executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID } as any;

function makeMockConnection(senderExists: boolean, receiverExists: boolean) {
  return {
    getAccountInfo: jest
      .fn()
      .mockImplementation(async (pubkey: PublicKey) => {
        if (pubkey.equals(SENDER_ATA)) return senderExists ? FAKE_ACCOUNT : null;
        if (pubkey.equals(RECEIVER_ATA)) return receiverExists ? FAKE_ACCOUNT : null;
        return null;
      }),
  } as unknown as Connection;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSend.mockResolvedValue("mockSig");
  mockGetMint.mockResolvedValue({ decimals: DECIMALS, mintAuthority: null, supply: 0n, freezeAuthority: null, isInitialized: true } as any);
});

describe("transferSpl", () => {
  it("adds createAssociatedTokenAccountInstruction when receiver ATA is missing", async () => {
    const connection = makeMockConnection(true, false);
    await transferSpl(wallet(WALLET_PUBKEY), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSend.mock.calls[0];
    expect(instructions).toHaveLength(2);
    expect(instructions[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("skips createAssociatedTokenAccountInstruction when receiver ATA exists", async () => {
    const connection = makeMockConnection(true, true);
    await transferSpl(wallet(WALLET_PUBKEY), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSend.mock.calls[0];
    expect(instructions).toHaveLength(1);
    expect(instructions[0].programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("throws MissingTokenAccountError when sender ATA is missing", async () => {
    const connection = makeMockConnection(false, true);
    await expect(
      transferSpl(wallet(WALLET_PUBKEY), connection, {
        mint: MINT_PUBKEY,
        to: RECIPIENT_PUBKEY,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(MissingTokenAccountError);
  });

  it("throws error message containing 'no token account' when sender ATA is missing", async () => {
    const connection = makeMockConnection(false, true);
    await expect(
      transferSpl(wallet(WALLET_PUBKEY), connection, {
        mint: MINT_PUBKEY,
        to: RECIPIENT_PUBKEY,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/no token account/i);
  });

  it("builds TransferChecked instruction with correct keys", async () => {
    const connection = makeMockConnection(true, true);
    await transferSpl(wallet(WALLET_PUBKEY), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSend.mock.calls[0];
    const transferIx = instructions[0]; // only instruction (receiver exists)
    // TransferChecked keys: source, mint, destination, authority
    expect(transferIx.keys[0].pubkey.equals(SENDER_ATA)).toBe(true);
    expect(transferIx.keys[1].pubkey.equals(MINT_PUBKEY)).toBe(true);
    expect(transferIx.keys[2].pubkey.equals(RECEIVER_ATA)).toBe(true);
    expect(transferIx.keys[3].pubkey.equals(WALLET_PUBKEY)).toBe(true);
  });

  it("computes uiAmount without BigInt precision loss for safe integers", async () => {
    const connection = makeMockConnection(true, true);
    // 1_500_000 base units at 6 decimals = 1.5
    await transferSpl(wallet(WALLET_PUBKEY), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_500_000n,
      symbol: "USDC",
    });

    const [, , , opts] = mockBuildAndSend.mock.calls[0];
    expect(opts?.meta?.amountIn?.uiAmount).toBe("1.5");
  });
});

// Helper to build a minimal WalletProvider mock
function wallet(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: jest.fn(),
    signAndSendTransaction: jest.fn(),
  };
}
