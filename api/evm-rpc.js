// Browser-safe EVM JSON-RPC proxy.
//
// Browser code used to talk to keyless public EVM hosts directly, led by
// eth.llamarpc.com, a host the server-side failover (api/_lib/evm/rpc.js)
// already demotes as a known-bad keyless endpoint. This proxy lets the browser
// inherit that server chain instead: an explicit RPC_URL_<chainId> override,
// then Alchemy where keyed, then the curated public tail, rotating on failure.
//
// Usage from browser:
//   POST /api/evm-rpc?chainId=8453   with a JSON-RPC body (single or batch)
//
// Hardening mirrors api/solana-rpc.js: per-IP and global rate limits (the chain
// may front a keyed, paid upstream), a read-only method allowlist so an
// anonymous caller can neither broadcast nor drain quota with scans, and a
// batch cap so one POST cannot fan out into hundreds of upstream calls.

import { cors, method, wrap, readJson, error, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { CHAIN_BY_ID } from './_lib/erc8004-chains.js';
import { evmRpcEndpoints } from './_lib/evm/rpc.js';

// Read-only methods a browser provider needs for contract reads, balances,
// receipts and fee estimation. Nothing that broadcasts (eth_sendRawTransaction)
// and nothing that filters or subscribes (eth_newFilter, eth_subscribe).
export const ALLOWED_METHODS = new Set([
	'eth_call',
	'eth_getBalance',
	'eth_blockNumber',
	'eth_getLogs',
	'eth_getTransactionReceipt',
	'eth_getTransactionByHash',
	'eth_chainId',
	'eth_estimateGas',
	'eth_getCode',
	'eth_getStorageAt',
	'net_version',
	'eth_gasPrice',
	'eth_feeHistory',
	'eth_maxPriorityFeePerGas',
	'eth_getBlockByNumber',
]);

const MAX_BATCH = 10;
const ENDPOINT_TIMEOUT_MS = 10_000;
const MAX_LOG_BLOCK_SPAN = 2000;
const MAX_CALL_PARAMS = 2;

const HEX_QTY = /^0x[0-9a-fA-F]{1,16}$/;

// eth_getLogs is the one read whose upstream cost scales with its arguments, so
// it must name a contract (or one block hash) and a bounded numeric block span.
function logsReason(params) {
	const f = Array.isArray(params) ? params[0] : null;
	if (!f || typeof f !== 'object') return 'malformed_request';
	if (f.blockHash !== undefined) return /^0x[0-9a-fA-F]{64}$/.test(f.blockHash) ? null : 'malformed_request';
	if (!f.address || (Array.isArray(f.address) && (f.address.length === 0 || f.address.length > 10))) {
		return 'logs_scope_required';
	}
	if (!HEX_QTY.test(f.fromBlock ?? '') || !HEX_QTY.test(f.toBlock ?? '')) return 'logs_range_too_large';
	const span = BigInt(f.toBlock) - BigInt(f.fromBlock);
	if (span < 0n || span > BigInt(MAX_LOG_BLOCK_SPAN)) return 'logs_range_too_large';
	return null;
}

/** True when the chain id is one the server failover table knows. */
export function isKnownChainId(chainId) {
	return Number.isInteger(chainId) && chainId > 0 && Boolean(CHAIN_BY_ID[chainId]);
}

// Validate one or a batch of JSON-RPC payloads. Returns an error code string,
// or null when every entry is a well-formed call to an allowlisted method.
export function rejectReason(body) {
	const entries = Array.isArray(body) ? body : [body];
	if (entries.length === 0) return 'empty_request';
	if (entries.length > MAX_BATCH) return 'batch_too_large';
	for (const e of entries) {
		if (!e || typeof e !== 'object') return 'malformed_request';
		if (typeof e.method !== 'string') return 'malformed_request';
		if (!ALLOWED_METHODS.has(e.method)) return 'method_not_allowed';
		if (e.method === 'eth_getLogs') {
			const r = logsReason(e.params);
			if (r) return r;
		}
		if (e.method === 'eth_call' && Array.isArray(e.params) && e.params.length > MAX_CALL_PARAMS) {
			return 'params_not_allowed';
		}
	}
	return null;
}

// A response body counts as usable only when it is a JSON-RPC envelope: an
// object carrying `jsonrpc` (or an `id` plus `result`/`error`), or an array of
// them. Keyless Ankr answers HTTP 200 with a bare {"error":"Unauthorized..."}
// string, which must rotate rather than reach an ethers/viem parser.
function isJsonRpcEnvelope(parsed, batch) {
	const one = (v) =>
		v && typeof v === 'object' && !Array.isArray(v) &&
		(v.jsonrpc === '2.0' || ('id' in v && ('result' in v || (v.error && typeof v.error === 'object'))));
	if (batch) return Array.isArray(parsed) && parsed.every(one);
	return one(parsed);
}

/**
 * POST the JSON-RPC body to each endpoint in order until one answers with a
 * well-formed envelope. Network errors, timeouts, non-2xx statuses and
 * non-envelope bodies rotate to the next endpoint. Resolves to the raw
 * response text of the first good endpoint; throws when every endpoint failed.
 *
 * @param {string[]} urls
 * @param {object|object[]} body
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ text: string, url: string }>}
 */
export async function forwardWithRotation(urls, body, { fetchImpl = fetch, timeoutMs = ENDPOINT_TIMEOUT_MS } = {}) {
	const batch = Array.isArray(body);
	const payload = JSON.stringify(body);
	let lastErr = null;
	for (const url of urls) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const res = await fetchImpl(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: payload,
				signal: ctrl.signal,
			});
			if (!res.ok) throw new Error(`http_${res.status}`);
			const text = await res.text();
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch {
				throw new Error('non_json_body');
			}
			if (!isJsonRpcEnvelope(parsed, batch)) throw new Error('not_jsonrpc_envelope');
			return { text, url };
		} catch (e) {
			lastErr = e instanceof Error ? e : new Error(String(e));
		} finally {
			clearTimeout(timer);
		}
	}
	throw new Error(`evm-rpc: all ${urls.length} endpoints failed (${lastErr?.message || 'no endpoints'})`);
}

export default wrap(async function handler(req, res) {
	// Same posture as /api/solana-rpc: public, unauthenticated, method-allowlisted,
	// open to any origin so statically hosted three.ws surfaces can use it. The
	// per-IP and global rate limits below are the abuse control.
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const [ipRl, globalRl] = await Promise.all([limits.evmRpcIp(ip), limits.evmRpcGlobal()]);
	if (!ipRl.success || !globalRl.success) {
		return rateLimited(res, ipRl, 'too many RPC requests');
	}

	const url = new URL(req.url, 'http://x');
	const chainId = Number(url.searchParams.get('chainId'));
	if (!isKnownChainId(chainId)) {
		return error(res, 400, 'unknown_chain', 'chainId is missing or not a supported EVM chain');
	}

	let body;
	try {
		body = await readJson(req, 200_000);
	} catch (e) {
		return error(res, e.status || 400, 'bad_body', 'failed to read JSON body');
	}

	const reason = rejectReason(body);
	if (reason) {
		const msg =
			reason === 'method_not_allowed'
				? 'this RPC method is not permitted through the proxy (read-only methods only)'
				: reason === 'batch_too_large'
					? `batch exceeds ${MAX_BATCH} requests`
					: reason === 'logs_scope_required'
						? 'eth_getLogs needs an address or blockHash'
						: reason === 'logs_range_too_large'
							? `eth_getLogs needs numeric fromBlock/toBlock spanning at most ${MAX_LOG_BLOCK_SPAN} blocks`
							: reason === 'params_not_allowed'
								? 'eth_call accepts at most a call object and a block tag'
								: 'malformed JSON-RPC request';
		return error(res, reason === 'method_not_allowed' ? 403 : 400, reason, msg);
	}

	// The first token was charged above; a batch fans out into one upstream call
	// per entry, so charge the rest individually.
	const entryCount = Array.isArray(body) ? body.length : 1;
	for (let i = 1; i < entryCount; i++) {
		const extra = await limits.evmRpcIp(ip);
		if (!extra.success) return rateLimited(res, extra, 'too many RPC requests');
	}

	const endpoints = evmRpcEndpoints(chainId);
	if (endpoints.length === 0) {
		return error(res, 502, 'no_upstream', `no RPC endpoint configured for chain ${chainId}`);
	}

	let forwarded;
	try {
		forwarded = await forwardWithRotation(endpoints, body);
	} catch {
		return error(res, 502, 'upstream_error', 'every rpc upstream for this chain failed');
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(forwarded.text);
});
