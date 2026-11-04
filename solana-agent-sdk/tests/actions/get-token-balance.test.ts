import { describe, it, expect, jest } from "@jest/globals";
import { Keypair, PublicKey, SolanaJSONRPCError, type Connection } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getTokenBalance } from "../../src/actions/get-token-balance.js";

const THREE_MINT = new PublicKey("FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump");
const owner = Keypair.fromSeed(new Uint8Array(32).fill(41)).publicKey;
const syntheticMint = (seed: number) => Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey;

/**
 * The mint's owner program is memoized per process by resolveTokenProgramId,
 * so every test that needs a different owner program uses its own mint.
 */
function connectionFor(mintOwner: PublicKey | null, balance: () => Promise<unknown>) {
  const getAccountInfo = jest.fn(async () => (mintOwner ? { owner: mintOwner, data: Buffer.alloc(82), lamports: 1, executable: false } : null));
  const getTokenAccountBalance = jest.fn(balance);
  return {
    connection: { getAccountInfo, getTokenAccountBalance } as unknown as Connection,
    getAccountInfo,
    getTokenAccountBalance,
  };
}

const ataOf = (mint: PublicKey, programId: PublicKey, who = owner) =>
  getAssociatedTokenAddressSync(mint, who, true, programId, ASSOCIATED_TOKEN_PROGRAM_ID);

describe("getTokenBalance", () => {
  it("reads a Token-2022 balance ($THREE) from the Token-2022 associated account", async () => {
    const { connection, getTokenAccountBalance } = connectionFor(TOKEN_2022_PROGRAM_ID, async () => ({
      context: { slot: 1 },
      value: { amount: "1234500000", decimals: 6, uiAmount: 1234.5, uiAmountString: "1234.5" },
    }));
    const result = await getTokenBalance(connection, owner, THREE_MINT.toBase58());
    const expectedAta = ataOf(THREE_MINT, TOKEN_2022_PROGRAM_ID);
    expect(getTokenAccountBalance).toHaveBeenCalledWith(expectedAta);
    expect(result).toEqual({
      mint: THREE_MINT.toBase58(),
      amount: "1234500000",
      decimals: 6,
      uiAmount: "1234.5",
      ata: expectedAta.toBase58(),
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
    });
  });

  it("reads a classic SPL Token balance from the classic associated account", async () => {
    const mint = syntheticMint(42);
    const { connection, getTokenAccountBalance } = connectionFor(TOKEN_PROGRAM_ID, async () => ({
      context: { slot: 1 },
      value: { amount: "5", decimals: 0, uiAmount: 5, uiAmountString: "5" },
    }));
    const result = await getTokenBalance(connection, owner, mint);
    expect(getTokenAccountBalance).toHaveBeenCalledWith(ataOf(mint, TOKEN_PROGRAM_ID));
    expect(result).toMatchObject({ amount: "5", uiAmount: "5", programId: TOKEN_PROGRAM_ID.toBase58() });
  });

  it("keeps full precision for balances above 2^53", async () => {
    const mint = syntheticMint(43);
    const { connection } = connectionFor(TOKEN_PROGRAM_ID, async () => ({
      context: { slot: 1 },
      value: { amount: "123456789012345678901", decimals: 9, uiAmount: null, uiAmountString: "" },
    }));
    const result = await getTokenBalance(connection, owner, mint);
    expect(result?.uiAmount).toBe("123456789012.345678901");
  });

  it("supports an owner that is a PDA (off the ed25519 curve)", async () => {
    const mint = syntheticMint(44);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], TOKEN_PROGRAM_ID);
    const { connection, getTokenAccountBalance } = connectionFor(TOKEN_PROGRAM_ID, async () => ({
      context: { slot: 1 },
      value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" },
    }));
    await expect(getTokenBalance(connection, pda, mint)).resolves.not.toBeNull();
    expect(getTokenAccountBalance).toHaveBeenCalledWith(ataOf(mint, TOKEN_PROGRAM_ID, pda));
  });

  it("returns null when the owner has no token account for the mint", async () => {
    const mint = syntheticMint(45);
    const { connection } = connectionFor(TOKEN_PROGRAM_ID, async () => {
      throw new SolanaJSONRPCError(
        { code: -32602, message: "Invalid param: could not find account" },
        "failed to get token account balance",
      );
    });
    await expect(getTokenBalance(connection, owner, mint)).resolves.toBeNull();
  });

  it("returns null when the mint does not exist", async () => {
    const { connection, getTokenAccountBalance } = connectionFor(null, async () => ({}));
    await expect(getTokenBalance(connection, owner, syntheticMint(46))).resolves.toBeNull();
    expect(getTokenAccountBalance).not.toHaveBeenCalled();
  });

  it("surfaces RPC failures instead of reporting a zero or missing balance", async () => {
    const mint = syntheticMint(47);
    const outage = new Error("fetch failed: 503 Service Unavailable");
    const { connection } = connectionFor(TOKEN_PROGRAM_ID, async () => {
      throw outage;
    });
    await expect(getTokenBalance(connection, owner, mint)).rejects.toBe(outage);
  });
});
