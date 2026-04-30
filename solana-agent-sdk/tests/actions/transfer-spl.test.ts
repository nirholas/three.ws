import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { PublicKey, AccountInfo, Connection } from "@solana/web3.js";
import type { WalletProvider } from "../../src/wallet/types.js";
import { MissingTokenAccountError } from "../../src/errors.js";

const mockBuildAndSendFn = jest.fn<(...args: any[]) => Promise<string>>();
const mockGetMintFn = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../../src/tx/build.js", () => ({
  buildAndSend: mockBuildAndSendFn,
}));

jest.unstable_mockModule("@solana/spl-token", () => {
  const actual = jest.requireActual("@solana/spl-token") as typeof import("@solana/spl-token");
  return { ...(actual as object), getMint: mockGetMintFn };
});

const { transferSpl } = await import("../../src/actions/transfer-spl.js");
const { Keypair } = await import("@solana/web3.js") as typeof import("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
  await import("@solana/spl-token") as typeof import("@solana/spl-token");

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

const MINT_INFO = {
  decimals: 6, mintAuthority: null, supply: 0n, freezeAuthority: null, isInitialized: true,
};

function makeConnection(senderExists: boolean, receiverExists: boolean) {
  const getAccountInfo = jest.fn<(pubkey: PublicKey) => Promise<AccountInfo<Buffer> | null>>();
  getAccountInfo.mockImplementation(async (pubkey) => {
    if (pubkey.equals(SENDER_ATA)) return senderExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null;
    if (pubkey.equals(RECEIVER_ATA)) return receiverExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null;
    return null;
  });
  return { getAccountInfo } as unknown as Connection;
}

function makeWallet() {
  return {
    publicKey: WALLET_PUBKEY,
    signTransaction: jest.fn(),
    signAndSendTransaction: jest.fn(),
  } as unknown as WalletProvider;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSendFn.mockResolvedValue("mockSig");
  mockGetMintFn.mockResolvedValue(MINT_INFO);
});

describe("transferSpl", () => {
  it("adds createAssociatedTokenAccountInstruction when receiver ATA is missing", async () => {
    await transferSpl(makeWallet(), makeConnection(true, false), {
      mint: MINT_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSendFn.mock.calls[0]!;
    expect(instructions).toHaveLength(2);
    expect(instructions[0]!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("skips createAssociatedTokenAccountInstruction when receiver ATA exists", async () => {
    await transferSpl(makeWallet(), makeConnection(true, true), {
      mint: MINT_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSendFn.mock.calls[0]!;
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("throws MissingTokenAccountError when sender ATA is missing", async () => {
    await expect(
      transferSpl(makeWallet(), makeConnection(false, true), {
        mint: MINT_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_000_000n,
      }),
    ).rejects.toThrow(MissingTokenAccountError);
  });

  it("throws error containing 'no token account' when sender ATA is missing", async () => {
    await expect(
      transferSpl(makeWallet(), makeConnection(false, true), {
        mint: MINT_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_000_000n,
      }),
    ).rejects.toThrow(/no token account/i);
  });

  it("builds TransferChecked instruction with correct keys", async () => {
    await transferSpl(makeWallet(), makeConnection(true, true), {
      mint: MINT_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSendFn.mock.calls[0]!;
    const ix = instructions[0]!;
    // TransferChecked keys: source, mint, destination, authority
    expect(ix.keys[0]!.pubkey.equals(SENDER_ATA)).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(MINT_PUBKEY)).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(RECEIVER_ATA)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(WALLET_PUBKEY)).toBe(true);
  });

  it("computes uiAmount without BigInt precision loss for safe integers", async () => {
    // 1_500_000 base units at 6 decimals = 1.5
    await transferSpl(makeWallet(), makeConnection(true, true), {
      mint: MINT_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_500_000n, symbol: "USDC",
    });

    const [, , , opts] = mockBuildAndSendFn.mock.calls[0]!;
    expect(opts?.meta?.amountIn?.uiAmount).toBe("1.5");
  });
});
