import { describe, it, expect, jest } from "@jest/globals";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getTokenAccounts } from "../../src/actions/get-token-accounts.js";

const THREE_MINT = "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump";
const owner = Keypair.fromSeed(new Uint8Array(32).fill(51)).publicKey;
const key = (seed: number) => Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey;

function parsed(pubkey: PublicKey, mint: string, amount: string, decimals: number) {
  return {
    pubkey,
    account: {
      data: { program: "spl-token", parsed: { info: { mint, owner: owner.toBase58(), tokenAmount: { amount, decimals } } }, space: 165 },
      executable: false,
      lamports: 2_039_280,
      owner: TOKEN_PROGRAM_ID,
    },
  };
}

describe("getTokenAccounts", () => {
  it("lists holdings from both SPL Token and Token-2022, skipping empty accounts", async () => {
    const classicMint = key(52).toBase58();
    const emptyMint = key(53).toBase58();
    const getParsedTokenAccountsByOwner = jest.fn(async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      context: { slot: 1 },
      value: filter.programId.equals(TOKEN_2022_PROGRAM_ID)
        ? [parsed(key(54), THREE_MINT, "2500000", 6)]
        : [parsed(key(55), classicMint, "7", 0), parsed(key(56), emptyMint, "0", 9)],
    }));
    const connection = { getParsedTokenAccountsByOwner } as unknown as Connection;

    const result = await getTokenAccounts(connection, owner);

    expect(getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
    const programs = getParsedTokenAccountsByOwner.mock.calls.map(([, f]) => f.programId.toBase58()).sort();
    expect(programs).toEqual([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].sort());
    expect(result).toEqual([
      { mint: classicMint, ata: key(55).toBase58(), amount: "7", decimals: 0, uiAmount: "7", programId: TOKEN_PROGRAM_ID.toBase58() },
      {
        mint: THREE_MINT,
        ata: key(54).toBase58(),
        amount: "2500000",
        decimals: 6,
        uiAmount: "2.5",
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      },
    ]);
  });

  it("keeps full precision for large raw amounts", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: jest.fn(async (_o: PublicKey, f: { programId: PublicKey }) => ({
        context: { slot: 1 },
        value: f.programId.equals(TOKEN_PROGRAM_ID) ? [parsed(key(57), key(58).toBase58(), "9007199254740993000", 9)] : [],
      })),
    } as unknown as Connection;
    const [acct] = await getTokenAccounts(connection, owner);
    expect(acct!.uiAmount).toBe("9007199254.740993");
  });

  it("returns an empty list for a wallet with no token accounts", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: jest.fn(async () => ({ context: { slot: 1 }, value: [] })),
    } as unknown as Connection;
    await expect(getTokenAccounts(connection, owner)).resolves.toEqual([]);
  });

  it("rejects when either program query fails, rather than returning a partial list", async () => {
    const outage = new Error("429 Too Many Requests");
    const connection = {
      getParsedTokenAccountsByOwner: jest.fn(async (_o: PublicKey, f: { programId: PublicKey }) => {
        if (f.programId.equals(TOKEN_2022_PROGRAM_ID)) throw outage;
        return { context: { slot: 1 }, value: [parsed(key(59), key(60).toBase58(), "1", 0)] };
      }),
    } as unknown as Connection;
    await expect(getTokenAccounts(connection, owner)).rejects.toBe(outage);
  });
});
