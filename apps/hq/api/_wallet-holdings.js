/**
 * Read a public wallet's priced holdings for portfolio risk. Read-only: it
 * calls public balance APIs and never signs or sends anything.
 *
 * Solana (the home chain) reads native SOL plus every SPL account under both
 * token programs over JSON-RPC, then prices mints through DeFiLlama's coins
 * API. EVM addresses read native ETH and ERC-20 balances from keyless
 * Blockscout instances, which carry their own USD exchange rates.
 *
 * Only priced holdings become positions. Tokens with no price, or a price
 * DeFiLlama marks as low confidence, are counted but not valued, so an
 * illiquid or spoofed token cannot inflate the portfolio.
 */

export const SOLANA_TOKEN_PROGRAMS = Object.freeze([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

/** Keyless Blockscout v2 hosts. Native coin on each is ETH. */
export const EVM_EXPLORERS = Object.freeze({
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  optimism: 'https://explorer.optimism.io',
});

const PRICE_URL = 'https://coins.llama.fi/prices/current/';
const PRICE_CHUNK = 50;
const MAX_MINTS = 300;
const MIN_CONFIDENCE = 0.7;
const MIN_USD = 0.01;
const MAX_POSITIONS = 50;
const LAMPORTS = 1e9;

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/** 'solana', 'evm', or null when the string is neither address shape. */
export function addressKind(address) {
  if (typeof address !== 'string') return null;
  const a = address.trim();
  if (EVM_RE.test(a)) return 'evm';
  if (SOLANA_RE.test(a)) return 'solana';
  return null;
}

/** Ordered Solana RPC list: operator RPC first, then Helius, then the public endpoint. */
export function solanaRpcEndpoints(env = {}) {
  const list = [];
  if (env.SOLANA_RPC_URL) list.push(env.SOLANA_RPC_URL);
  if (env.HELIUS_API_KEY) list.push(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`);
  list.push('https://api.mainnet-beta.solana.com');
  return [...new Set(list)];
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function solanaRpc(endpoints, method, params, { fetchImpl, timeoutMs }) {
  let lastError = null;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) { lastError = new Error(`${method} HTTP ${res.status}`); continue; }
      const json = await res.json();
      if (json?.error) { lastError = new Error(`${method}: ${json.error.message ?? 'RPC error'}`); continue; }
      return json.result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error(`${method} failed`);
}

/** DeFiLlama prices keyed by coin id; chunks keep each URL short. */
async function fetchPrices(ids, { fetchImpl, timeoutMs }) {
  const prices = {};
  await Promise.all(chunk(ids, PRICE_CHUNK).map(async (group) => {
    const res = await fetchImpl(PRICE_URL + group.map(encodeURIComponent).join(','), {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`price lookup HTTP ${res.status}`);
    const json = await res.json();
    Object.assign(prices, json?.coins ?? {});
  }));
  return prices;
}

const priced = (p) => p && Number.isFinite(p.price) && p.price > 0 && (p.confidence === undefined || p.confidence >= MIN_CONFIDENCE);

async function readSolana(address, { fetchImpl, timeoutMs, env }) {
  const endpoints = solanaRpcEndpoints(env);
  const opts = { fetchImpl, timeoutMs };
  const [lamports, ...programs] = await Promise.all([
    solanaRpc(endpoints, 'getBalance', [address], opts),
    ...SOLANA_TOKEN_PROGRAMS.map((programId) =>
      solanaRpc(endpoints, 'getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed' }], opts)
        .then((r) => ({ ok: true, accounts: r?.value ?? [] }), (err) => ({ ok: false, error: err.message }))),
  ]);
  if (programs.every((p) => !p.ok)) throw new Error(programs[0].error);

  const amounts = new Map();
  for (const p of programs) {
    for (const acct of p.ok ? p.accounts : []) {
      const info = acct?.account?.data?.parsed?.info;
      const amount = Number(info?.tokenAmount?.uiAmountString);
      if (!info?.mint || !Number.isFinite(amount) || amount <= 0) continue;
      amounts.set(info.mint, (amounts.get(info.mint) ?? 0) + amount);
    }
  }

  const mints = [...amounts.keys()];
  const checked = mints.slice(0, MAX_MINTS);
  const nativeId = 'coingecko:solana';
  const prices = await fetchPrices([nativeId, ...checked.map((m) => `solana:${m}`)], opts);

  const holdings = [];
  const sol = (lamports?.value ?? 0) / LAMPORTS;
  if (sol > 0 && priced(prices[nativeId])) {
    holdings.push({ symbol: prices[nativeId].symbol || 'SOL', chain: 'Solana', amount: sol, usd: sol * prices[nativeId].price, token: { chain: 'solana', address: 'native' } });
  }
  let unpriced = mints.length - checked.length;
  for (const mint of checked) {
    const p = prices[`solana:${mint}`];
    if (!priced(p) || !p.symbol) { unpriced += 1; continue; }
    const amount = amounts.get(mint);
    holdings.push({ symbol: p.symbol, chain: 'Solana', amount, usd: amount * p.price, token: { chain: 'solana', address: mint } });
  }
  const skippedPrograms = programs.filter((p) => !p.ok).length;
  return { holdings, unpriced, chains: [{ chain: 'Solana', ok: true, ...(skippedPrograms ? { note: `${skippedPrograms} token program could not be read` } : {}) }] };
}

async function readBlockscoutChain(chain, address, { fetchImpl, timeoutMs }) {
  const base = EVM_EXPLORERS[chain];
  const get = async (path) => {
    const res = await fetchImpl(`${base}/api/v2/addresses/${address}${path}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${chain} explorer HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error(`${chain} explorer returned a non-JSON page`);
    return res.json();
  };
  const [info, tokens] = await Promise.all([get(''), get('/token-balances')]);
  const label = chain[0].toUpperCase() + chain.slice(1);
  const holdings = [];
  let unpriced = 0;

  const wei = Number(info?.coin_balance ?? 0);
  const ethRate = Number(info?.exchange_rate);
  if (wei > 0 && ethRate > 0) {
    const amount = wei / 1e18;
    holdings.push({ symbol: 'ETH', chain: label, amount, usd: amount * ethRate, token: { chain, address: 'native' } });
  }
  for (const t of Array.isArray(tokens) ? tokens : []) {
    const tok = t?.token;
    if (!tok || tok.type !== 'ERC-20') continue;
    const rate = Number(tok.exchange_rate);
    const decimals = Number(tok.decimals);
    const raw = Number(t.value);
    if (!(raw > 0)) continue;
    if (!(rate > 0) || !Number.isFinite(decimals) || !tok.symbol || (tok.reputation && tok.reputation !== 'ok')) { unpriced += 1; continue; }
    const amount = raw / 10 ** decimals;
    holdings.push({ symbol: tok.symbol, chain: label, amount, usd: amount * rate, token: { chain, address: String(tok.address_hash).toLowerCase() } });
  }
  return { holdings, unpriced };
}

async function readEvm(address, chain, opts) {
  const chains = chain ? [chain] : Object.keys(EVM_EXPLORERS);
  const results = await Promise.all(chains.map((c) =>
    readBlockscoutChain(c, address, opts).then((r) => ({ c, ok: true, ...r }), (err) => ({ c, ok: false, error: err.message }))));
  if (results.every((r) => !r.ok)) throw new Error(results.map((r) => r.error).join('; '));
  return {
    holdings: results.flatMap((r) => (r.ok ? r.holdings : [])),
    unpriced: results.reduce((s, r) => s + (r.ok ? r.unpriced : 0), 0),
    chains: results.map((r) => (r.ok ? { chain: r.c, ok: true } : { chain: r.c, ok: false, error: r.error })),
  };
}

/**
 * Priced holdings for one public address, largest first, capped at 50.
 * `chain` narrows an EVM read to one network; it must agree with the address
 * shape. Throws 400 for a malformed address, 502 when no chain could be read.
 */
export async function readWalletHoldings(address, { chain, fetchImpl = fetch, timeoutMs = 15000, env = {} } = {}) {
  const a = typeof address === 'string' ? address.trim() : '';
  const kind = addressKind(a);
  if (!kind) throw badRequest('address must be a Solana address (base58) or an EVM address (0x + 40 hex)');
  const want = typeof chain === 'string' && chain.trim() ? chain.trim().toLowerCase() : null;
  if (want === 'solana' && kind !== 'solana') throw badRequest('chain "solana" needs a base58 Solana address');
  if (want && want !== 'solana' && want !== 'evm' && !Object.hasOwn(EVM_EXPLORERS, want)) {
    throw badRequest(`chain must be solana, evm, or one of ${Object.keys(EVM_EXPLORERS).join(', ')}`);
  }
  if (want && want !== 'solana' && kind !== 'evm') throw badRequest(`chain "${want}" needs a 0x EVM address`);

  let read;
  try {
    read = kind === 'solana'
      ? await readSolana(a, { fetchImpl, timeoutMs, env })
      : await readEvm(a, want && want !== 'evm' ? want : null, { fetchImpl, timeoutMs });
  } catch (err) {
    throw Object.assign(new Error(`could not read balances for ${a}: ${err instanceof Error ? err.message : err}`), { status: 502 });
  }

  const sorted = read.holdings.filter((h) => h.usd >= MIN_USD).sort((x, y) => y.usd - x.usd);
  const dust = read.holdings.length - sorted.length;
  return {
    address: a,
    kind,
    chains: read.chains,
    holdings: sorted.slice(0, MAX_POSITIONS),
    omitted: Math.max(0, sorted.length - MAX_POSITIONS) + dust,
    unpriced: read.unpriced,
  };
}
