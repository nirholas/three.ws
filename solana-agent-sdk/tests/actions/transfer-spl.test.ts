import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  Keypair,
  PublicKey,
  type AccountInfo,
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
import type { WalletProvider } from "../../src/wallet/types.js";

jest.mock("../../src/tx/build.js", () => ({ buildAndSend: jest.fn() }));

jest.mock("@solana/spl-token", () => ({
  ...jest.requireActual("@solana/spl-token"),
  getMint: jest.fn(),
}));

const mockBuildAndSend = jest.mocked(buildAndSend);
const mockGetMint = jest.mocked(getMint);

const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const RECIPIENT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const MINT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;

const SENDER_ATA = getAssociatedTokenAddressSync(
  MINT_PUBKEY, WALLET_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);
const RECEIVER_ATA = getAssociatedTokenAddressSync(
  MINT_PUBKEY, RECIPIENT_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);

const FAKE_ACCOUNT = { data: Buffer.alloc(0), executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID };

function makeConnection(senderExists: boolean, receiverExists: boolean) {
  const getAccountInfo = jest.fn<(pubkey: PublicKey) => Promise<AccountInfo<Buffer> | null>>();
  getAccountInfo.mockImplementation(async (pubkey) => {
    if (pubkey.equals(SENDER_ATA)) return senderExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null;
    if (pubkey.equals(RECEIVER_ATA)) return receiverExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null;
    return null;
  });
  return { getAccountInfo } as unknown as Connection;
}

function makeWallet(publicKey = WALLET_PUBKEY): WalletProvider {
  return {
    publicKey,
    signTransaction: jest.fn(),
    signAndSendTransaction: jest.fn(),
  } as unknown as WalletProvider;
}

const MINT_INFO = {
  decimals: 6, mintAuthority: null, supply: 0n, freezeAuthority: null, isInitialized: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSend.mockResolvedValue("mockSig");
  mockGetMint.mockResolvedValue(MINT_INFO as ReturnType<typeof getMint> extends Promise<infer T> ? T : never);
});

describe("transferSpl", () => {
  it("adds createAssociatedTokenAccountInstruction when receiver ATA is missing", async () => {
    const connection = makeConnection(true, false);
    await transferSpl(makeWallet(), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSend.mock.calls[0]!;
    expect(instructions).toHaveLength(2);
    expect(instructions[0]!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("skips createAssociatedTokenAccountInstruction when receiver ATA exists", async () => {
    const connection = makeConnection(true, true);
    await transferSpl(makeWallet(), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSend.mock.calls[0]!;
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("throws MissingTokenAccountError when sender ATA is missing", async () => {
    const connection = makeConnection(false, true);
    await expect(
      transferSpl(makeWallet(), connection, {
        mint: MINT_PUBKEY,
        to: RECIPIENT_PUBKEY,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(MissingTokenAccountError);
  });

  it("throws error message containing 'no token account' when sender ATA is missing", async () => {
    const connection = makeConnection(false, true);
    await expect(
      transferSpl(makeWallet(), connection, {
        mint: MINT_PUBKEY,
        to: RECIPIENT_PUBKEY,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow(/no token account/i);
  });

  it("builds TransferChecked instruction with correct keys", async () => {
    const connection = makeConnection(true, true);
    await transferSpl(makeWallet(), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSend.mock.calls[0]!;
    const ix = instructions[0]!; // only instruction when receiver ATA exists
    // TransferChecked keys: source, mint, destination, authority
    expect(ix.keys[0]!.pubkey.equals(SENDER_ATA)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(MINT_PUBKEY)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(RECEIVER_ATA)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(WALLET_PUBKEY)).toBe(true);
  });

  it("computes uiAmount without BigInt precision loss for safe integers", async () => {
    const connection = makeConnection(true, true);
    // 1_500_000 base units at 6 decimals = 1.5
    await transferSpl(makeWallet(), connection, {
      mint: MINT_PUBKEY,
      to: RECIPIENT_PUBKEY,
      amount: 1_500_000n,
      symbol: "USDC",
    });

    const [, , , opts] = mockBuildAndSend.mock.calls[0]!;
    expect(opts?.meta?.amountIn?.uiAmount).toBe("1.5");
  });
});
