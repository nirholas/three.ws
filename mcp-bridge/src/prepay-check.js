// Optional pre-payment check (off unless MCP_BRIDGE_PREPAY_CHECK=1). Runs after the spending cap.
// Asks a check endpoint whether the seller's live 402 matches its listing. Contract:
//   - Base mainnet only; other networks are never checked.
//   - Hard timeout (MCP_BRIDGE_PREPAY_CHECK_TIMEOUT_MS, default 1500). Timeout, error or unknown answer = pay,
//     unless MCP_BRIDGE_PREPAY_CHECK_FAIL_CLOSED=1 (then timeout/error refuses; unknown answers still pay).
//   - Refuses only on a skip with a known reason code. Sends only the resource URL; no caller id or extra headers.
const DEFAULT_URL = 'https://api.402xagent.com/v1/products/endpoint-spot-check';
const SKIP_CODES = new Set(['price_mismatch', 'pay_to_mismatch', 'network_mismatch', 'asset_not_usdc', 'network_unsupported', 'ssrf_blocked', 'bad_challenge', 'ambiguous']);
const isBase = (n) => n === 'eip155:8453' || n === 'base';

export function buildPrepayCheckHook({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
	if (env.MCP_BRIDGE_PREPAY_CHECK !== '1') return undefined;
	const endpoint = env.MCP_BRIDGE_PREPAY_CHECK_URL || DEFAULT_URL;
	const timeoutMs = Number(env.MCP_BRIDGE_PREPAY_CHECK_TIMEOUT_MS) > 0 ? Number(env.MCP_BRIDGE_PREPAY_CHECK_TIMEOUT_MS) : 1500;
	const failClosed = env.MCP_BRIDGE_PREPAY_CHECK_FAIL_CLOSED === '1';
	return async ({ paymentRequired, selectedRequirements } = {}) => {
		const url = paymentRequired?.resource?.url;
		if (!url || !isBase(selectedRequirements?.network)) return undefined;
		const ac = new AbortController();
		let timer;
		const timedOut = new Promise((resolve) => {
			timer = setTimeout(() => { ac.abort(); resolve({ failed: `no answer within ${timeoutMs} ms` }); }, timeoutMs);
		});
		const asked = (async () => {
			const res = await fetchImpl(`${endpoint}?url=${encodeURIComponent(url)}`, { headers: { accept: 'application/json' }, signal: ac.signal });
			if (!res.ok) return { failed: `HTTP ${res.status}` };
			return { body: await res.json().catch(() => ({})) };
		})().catch((e) => ({ failed: String(e?.message || e) }));
		const r = await Promise.race([asked, timedOut]).finally(() => clearTimeout(timer));
		if (r.failed) return failClosed ? { abort: true, reason: `payment refused: pre-payment check failed (${r.failed}) and MCP_BRIDGE_PREPAY_CHECK_FAIL_CLOSED=1` } : undefined;
		const code = r.body?.reason_code;
		if (r.body?.verdict === 'skip' && SKIP_CODES.has(code)) {
			return { abort: true, reason: `payment refused: pre-payment check says skip (${code})${r.body.receipt_url ? ` — ${r.body.receipt_url}` : ''}` };
		}
		return undefined;
	};
}
