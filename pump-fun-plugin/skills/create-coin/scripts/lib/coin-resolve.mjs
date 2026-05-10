import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const KNOWN_SPL_TOKEN_PROGRAMS = new Set([
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
]);

/**
 * SPL mint accounts are owned by Token or Token-2022 program.
 * @param {import("@solana/web3.js").Connection} connection
 * @param {import("@solana/web3.js").PublicKey} mint
 * @param {import("@solana/web3.js").Commitment} [commitment="confirmed"]
 * @returns {Promise<import("@solana/web3.js").PublicKey>}
 */
export async function tokenProgramIdFromMint(
  connection,
  mint,
  commitment = "confirmed",
) {
  const info = await connection.getAccountInfo(mint, commitment);
  if (!info) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  const owner = info.owner;
  if (!KNOWN_SPL_TOKEN_PROGRAMS.has(owner.toBase58())) {
    throw new Error(
      `Mint owner is not SPL Token or Token-2022: ${owner.toBase58()}`,
    );
  }
  return owner;
}

/**
 * @param {Record<string, unknown>} coin
 * @returns {import("@solana/web3.js").PublicKey}
 */
export function poolPublicKeyFromCoin(coin) {
  const pool = coin?.pump_swap_pool;
  if (typeof pool !== "string" || !pool.length) {
    throw new Error(
      "Coin has no pump_swap_pool — not graduated to AMM or still migrating.",
    );
  }
  return new PublicKey(pool);
}
