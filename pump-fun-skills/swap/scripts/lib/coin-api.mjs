/** Default coins-v2 prefix; override with PUMP_COINS_V2_BASE if using another backend. */
const DEFAULT_COINS_V2_BASE = "https://frontend-api-v3.pump.fun/coins-v2";

/** @returns {string} */
function coinsV2BaseUrl() {
  const raw = process.env.PUMP_COINS_V2_BASE?.trim();
  const base = (raw && raw.length > 0 ? raw : DEFAULT_COINS_V2_BASE).replace(
    /\/+$/,
    "",
  );
  return base;
}

/**
 * @param {string} mint
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchCoinV2(mint) {
  const url = `${coinsV2BaseUrl()}/${mint}`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`coins-v2 request failed: HTTP ${r.status} for mint ${mint}`);
  }
  const text = await r.text();
  if (!text || text.trim().length === 0) {
    throw new Error(
      `coins-v2 returned empty response for mint ${mint} (url: ${url}). ` +
        "If using devnet, set PUMP_COINS_V2_BASE to the devnet coins API.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `coins-v2 returned invalid JSON for mint ${mint}: ${text.slice(0, 200)}`,
    );
  }
}
