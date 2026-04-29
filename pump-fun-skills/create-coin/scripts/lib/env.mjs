import { Connection } from "@solana/web3.js";

/** @returns {string} */
export function getRpcUrl() {
  const url =
    process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!url?.trim()) {
    throw new Error(
      "SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL must be set (use an HTTPS JSON-RPC endpoint).",
    );
  }
  return url.trim();
}

/** @returns {import("@solana/web3.js").Connection} */
export function getConnection() {
  return new Connection(getRpcUrl(), "confirmed");
}
