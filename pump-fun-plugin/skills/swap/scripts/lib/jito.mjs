import { PublicKey, SystemProgram } from "@solana/web3.js";

const DEFAULT_TIP_LAMPORTS = 100_000; // 0.0001 SOL

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
].map((k) => new PublicKey(k));

export const JITO_ENDPOINTS = [
  "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://london.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://slc.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://singapore.mainnet.block-engine.jito.wtf/api/v1/transactions",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions",
];

function randomJitoTipAccount() {
  return JITO_TIP_ACCOUNTS[
    Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)
  ];
}

/**
 * @param {import("@solana/web3.js").PublicKey} payer
 * @param {number} [tipSol] — tip in SOL (default 0.0001)
 * @returns {import("@solana/web3.js").TransactionInstruction}
 */
export function jitoTipInstruction(payer, tipSol) {
  const lamports =
    tipSol != null ? Math.floor(tipSol * 1_000_000_000) : DEFAULT_TIP_LAMPORTS;
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: randomJitoTipAccount(),
    lamports,
  });
}

/**
 * Send a base64-encoded transaction to all Jito block engine endpoints.
 * Resolves with the first successful JSON-RPC result or rejects if all fail.
 *
 * @param {string} txBase64
 * @returns {Promise<string>} Jito response result (usually the signature)
 */
export async function sendTransactionToJito(txBase64) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sendTransaction",
    params: [txBase64, { encoding: "base64" }],
  });

  const results = await Promise.allSettled(
    JITO_ENDPOINTS.map((endpoint) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then(async (r) => {
        const json = await r.json();
        if (json.error) throw new Error(JSON.stringify(json.error));
        return json.result;
      }),
    ),
  );

  const first = results.find((r) => r.status === "fulfilled");
  if (first) return first.value;

  const errors = results.map(
    (r) => /** @type {PromiseRejectedResult} */ (r).reason?.message ?? r,
  );
  throw new Error(`All Jito endpoints failed: ${errors.join("; ")}`);
}
