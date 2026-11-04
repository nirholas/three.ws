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
const { Keypair, PublicKey: PublicKeyCtor } = await import("@solana/web3.js") as typeof import("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
  await import("@solana/spl-token") as typeof import("@solana/spl-token");

const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const RECIPIENT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const MINT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
// A distinct mint for the Token-2022 case. resolveTokenProgramId memoizes a
// mint's owning program (immutable on-chain), so the 2022 test must use its own
// mint rather than reuse MINT_PUBKEY, which the classic-program tests already cached.
const MINT_2022_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;

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

function makeConnection(
  senderExists: boolean,
  receiverExists: boolean,
  mintProgram: PublicKey = TOKEN_PROGRAM_ID,
  mint: PublicKey = MINT_PUBKEY,
  recipient: PublicKey = RECIPIENT_PUBKEY,
) {
  // ATAs are derived with whichever program owns the mint, so a Token-2022 test
  // must look its accounts up under the Token-2022 program.
  const senderAta = getAssociatedTokenAddressSync(mint, WALLET_PUBKEY, false, mintProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = getAssociatedTokenAddressSync(mint, recipient, true, mintProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const getAccountInfo = jest.fn<(pubkey: PublicKey) => Promise<AccountInfo<Buffer> | null>>();
  getAccountInfo.mockImplementation(async (pubkey) => {
    // resolveTokenProgramId reads the mint account's owner to pick the program.
    if (pubkey.equals(mint)) return ({ ...FAKE_ACCOUNT, owner: mintProgram } as unknown as AccountInfo<Buffer>);
    if (pubkey.equals(senderAta)) return senderExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null;
    if (pubkey.equals(receiverAta)) return receiverExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null;
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

  it("uses the Token-2022 program for a Token-2022 mint (e.g. $THREE)", async () => {
    // Mint account owned by Token-2022 → ATAs and the transfer must build against
    // Token-2022, not the classic program (which would derive the wrong ATA).
    await transferSpl(makeWallet(), makeConnection(true, true, TOKEN_2022_PROGRAM_ID, MINT_2022_PUBKEY), {
      mint: MINT_2022_PUBKEY, to: RECIPIENT_PUBKEY, amount: 1_000_000n,
    });

    const [, , instructions] = mockBuildAndSendFn.mock.calls[0]!;
    const transferIx = instructions[instructions.length - 1]!;
    expect(transferIx.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    // And the source ATA is the Token-2022-derived address, not the classic one.
    const expectedSenderAta = getAssociatedTokenAddressSync(
      MINT_2022_PUBKEY, WALLET_PUBKEY, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(transferIx.keys[0]!.pubkey.equals(expectedSenderAta)).toBe(true);
  });

  it("pays a program-owned (PDA) recipient, creating its token account", async () => {
    // Escrows, vaults and multisigs hold tokens at an off-curve PDA. Deriving
    // their ATA must not throw TokenOwnerOffCurveError.
    const [pda] = PublicKeyCtor.findProgramAddressSync([Buffer.from("vault")], TOKEN_2022_PROGRAM_ID);
    expect(PublicKeyCtor.isOnCurve(pda.toBytes())).toBe(false);

    await transferSpl(makeWallet(), makeConnection(true, false, TOKEN_PROGRAM_ID, MINT_PUBKEY, pda), {
      mint: MINT_PUBKEY, to: pda, amount: 1_000_000n,
    });

    const pdaAta = getAssociatedTokenAddressSync(MINT_PUBKEY, pda, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const [, , instructions] = mockBuildAndSendFn.mock.calls[0]!;
    expect(instructions).toHaveLength(2);
    const [createIx, transferIx] = instructions;
    expect(createIx!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(createIx!.keys[1]!.pubkey.equals(pdaAta)).toBe(true);
    expect(createIx!.keys[2]!.pubkey.equals(pda)).toBe(true);
    expect(transferIx!.keys[2]!.pubkey.equals(pdaAta)).toBe(true);
  });
});
