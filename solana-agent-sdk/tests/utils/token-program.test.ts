import { describe, it, expect, jest } from "@jest/globals";
import { Keypair, PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { resolveTokenProgramId } from "../../src/utils/token-program.js";
import { MintNotFoundError, NotATokenMintError } from "../../src/errors.js";

const THREE_MINT = new PublicKey("FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump");
const mintFromSeed = (seed: number) => Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey;

function connectionOwnedBy(owner: PublicKey | null) {
  const getAccountInfo = jest.fn(async () =>
    owner ? { owner, data: Buffer.alloc(82), lamports: 1_461_600, executable: false } : null,
  );
  return { connection: { getAccountInfo } as unknown as Connection, getAccountInfo };
}

describe("resolveTokenProgramId", () => {
  it("resolves a Token-2022 mint ($THREE) to the Token-2022 program", async () => {
    const { connection } = connectionOwnedBy(TOKEN_2022_PROGRAM_ID);
    await expect(resolveTokenProgramId(connection, THREE_MINT)).resolves.toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("resolves a classic mint to the SPL Token program", async () => {
    const { connection } = connectionOwnedBy(TOKEN_PROGRAM_ID);
    await expect(resolveTokenProgramId(connection, mintFromSeed(63))).resolves.toBe(TOKEN_PROGRAM_ID);
  });

  it("memoizes the owner program so repeat lookups skip the RPC", async () => {
    const mint = mintFromSeed(64);
    const { connection, getAccountInfo } = connectionOwnedBy(TOKEN_PROGRAM_ID);
    await resolveTokenProgramId(connection, mint);
    await resolveTokenProgramId(connection, mint);
    expect(getAccountInfo).toHaveBeenCalledTimes(1);
  });

  it("throws MintNotFoundError when the mint account does not exist, and does not cache the miss", async () => {
    const mint = mintFromSeed(65);
    const missing = connectionOwnedBy(null);
    const err = await resolveTokenProgramId(missing.connection, mint).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MintNotFoundError);
    expect((err as MintNotFoundError).mint).toBe(mint.toBase58());

    const created = connectionOwnedBy(TOKEN_PROGRAM_ID);
    await expect(resolveTokenProgramId(created.connection, mint)).resolves.toBe(TOKEN_PROGRAM_ID);
  });

  it("throws NotATokenMintError naming the owner when the account is not an SPL mint", async () => {
    const mint = mintFromSeed(66);
    const { connection } = connectionOwnedBy(SystemProgram.programId);
    const err = await resolveTokenProgramId(connection, mint).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotATokenMintError);
    expect((err as NotATokenMintError).mint).toBe(mint.toBase58());
    expect((err as NotATokenMintError).owner).toBe(SystemProgram.programId.toBase58());
  });
});
