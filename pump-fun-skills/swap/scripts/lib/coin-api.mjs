/**
 * pump.fun's public coin API. GET /coins-v2/<mint> (and /coins/<mint>) were
 * retired on 2026-11-25 and answer 404 for every mint, so the coin record is
 * read from the search route keyed by the mint. Search also returns fuzzy hits
 * for other coins, so only the row whose mint matches exactly is used.
 */
const PUMP_FRONTEND_BASE = "https://frontend-api-v3.pump.fun";

/**
 * A backend that still serves <base>/<mint> (a devnet coins API), or null for
 * pump.fun mainnet.
 * @returns {string|null}
 */
function coinsV2BaseUrl() {
  const raw = process.env.PUMP_COINS_V2_BASE?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * @param {string} url
 * @param {string} mint
 * @returns {Promise<unknown>}
 */
async function getJson(url, mint) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) {
    throw new Error(`pump.fun coin request failed: HTTP ${r.status} for mint ${mint} (url: ${url})`);
  }
  const text = await r.text();
  if (!text || text.trim().length === 0) {
    throw new Error(
      `pump.fun coin API returned an empty response for mint ${mint} (url: ${url}). ` +
        "If using devnet, set PUMP_COINS_V2_BASE to the devnet coins API.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`pump.fun coin API returned invalid JSON for mint ${mint}: ${text.slice(0, 200)}`);
  }
}

/**
 * The pump.fun coin record for one mint.
 * @param {string} mint
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchCoinV2(mint) {
  const override = coinsV2BaseUrl();
  if (override) {
    return /** @type {Record<string, unknown>} */ (await getJson(`${override}/${mint}`, mint));
  }
  const url = new URL("/coins/search-unrestricted", PUMP_FRONTEND_BASE);
  url.searchParams.set("searchTerm", mint);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "10");
  url.searchParams.set("includeNsfw", "true");
  const body = await getJson(url.toString(), mint);
  const rows = Array.isArray(body) ? body : Array.isArray(body?.coins) ? body.coins : [];
  const coin = rows.find((row) => row && row.mint === mint);
  if (!coin) {
    throw new Error(`pump.fun has no coin with mint ${mint}`);
  }
  return coin;
}
