import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { PublicKey, AccountInfo, Connection } from "@solana/web3.js";
import type { WalletProvider } from "../../src/wallet/types.js";

const mockBuildAndSendFn = jest.fn<(...args: any[]) => Promise<string>>();

jest.unstable_mockModule("../../src/tx/build.js", () => ({
  buildAndSend: mockBuildAndSendFn,
}));

const { getOrCreateAta } = await import("../../src/actions/ata.js");
const { Keypair } = await import("@solana/web3.js") as typeof import("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
  await import("@solana/spl-token") as typeof import("@solana/spl-token");

const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const CUSTOM_OWNER = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const MINT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;

const FAKE_ACCOUNT = { data: Buffer.alloc(0), executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID };

const wallet = {
  publicKey: WALLET_PUBKEY,
  signTransaction: jest.fn(),
  signAndSendTransaction: jest.fn(),
} as unknown as WalletProvider;

function makeConnection(ataExists: boolean) {
  const getAccountInfo = jest.fn<(pubkey: PublicKey) => Promise<AccountInfo<Buffer> | null>>();
  getAccountInfo.mockResolvedValue(ataExists ? (FAKE_ACCOUNT as unknown as AccountInfo<Buffer>) : null);
  return { getAccountInfo } as unknown as Connection;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSendFn.mockResolvedValue("fakeSig");
});

describe("getOrCreateAta", () => {
  it("returns { ata, signature: undefined } when ATA already exists", async () => {
    const result = await getOrCreateAta(wallet, makeConnection(true), { mint: MINT_PUBKEY });

    expect(result.signature).toBeUndefined();
    expect(mockBuildAndSendFn).not.toHaveBeenCalled();

    const expectedAta = getAssociatedTokenAddressSync(
      MINT_PUBKEY, WALLET_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(result.ata.equals(expectedAta)).toBe(true);
  });

  it("calls buildAndSend and returns signature when ATA does not exist", async () => {
    const result = await getOrCreateAta(wallet, makeConnection(false), { mint: MINT_PUBKEY });

    expect(mockBuildAndSendFn).toHaveBeenCalledTimes(1);
    expect(result.signature).toBe("fakeSig");
  });

  it("sends createAssociatedTokenAccountInstruction when ATA does not exist", async () => {
    await getOrCreateAta(wallet, makeConnection(false), { mint: MINT_PUBKEY });

    const [, , instructions] = mockBuildAndSendFn.mock.calls[0]!;
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("uses wallet.publicKey as owner by default", async () => {
    const result = await getOrCreateAta(wallet, makeConnection(true), { mint: MINT_PUBKEY });

    const expectedAta = getAssociatedTokenAddressSync(
      MINT_PUBKEY, WALLET_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(result.ata.equals(expectedAta)).toBe(true);
  });

  it("uses provided owner instead of wallet.publicKey", async () => {
    const result = await getOrCreateAta(wallet, makeConnection(true), {
      mint: MINT_PUBKEY, owner: CUSTOM_OWNER,
    });

    const expectedAta = getAssociatedTokenAddressSync(
      MINT_PUBKEY, CUSTOM_OWNER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(result.ata.equals(expectedAta)).toBe(true);
  });
});
