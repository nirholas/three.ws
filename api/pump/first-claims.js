// GET /api/pump/first-claims?sinceMinutes=60&limit=50
//       OR ?sinceTs=<unix-seconds>&limit=50
//
// Returns { items: [...] } where each item is:
//   { creator, mint, signature, lamports, ts }
//
// "First-time" = creator has no observed claim before sinceTs in the
// wider lookback window scanned this request (in-memory dedupe, no DB).
//
// Primary data source: PUMPFUN_BOT_URL (pumpfun-claims-bot MCP).
// Fallback: Solana RPC limited scan (best-effort, up to 200 signatures).
//
// Auth: none — read-only public feed. Rate-limited by IP.

import bs58 from 'bs58';
import { cors, json, method, error, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getConnection } from '../_lib/pump.js';
import { filterFirstClaims } from '../../src/pump/first-claims.js';

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Anchor 8-byte discriminators for fee-claim instructions (hex).
const CLAIM_DISCS = new Set([
	'e8f5c2eeeada3a59', // collect_coin_creator_fee
	'7a027f010ebf0caf', // collect_creator_fee
	'a537817004b3ca28', // distribute_creator_fees
]);

// Scan 8× the request window to surface prior claimers.
const LOOKBACK_MULT = 8;

// ── Named export used by api/pump-fun-mcp.js ──────────────────────────────

/**
 * Scan for first-time fee claims, apply dedupe, return items array.
 * @param {{ sinceTs: number, limit: number }} opts
 * @returns {Promise<Array<{creator,mint,signature,lamports,ts}>>}
 */
export async function scanFirstClaims({ sinceTs, limit }) {
	const lim = Math.max(1, Math.min(50, limit));
	const lookbackTs = sinceTs - Math.max(3600, (Math.floor(Date.now() / 1000) - sinceTs) * LOOKBACK_MULT);
	let allClaims;
	if (process.env.PUMPFUN_BOT_URL) {
		allClaims = await _fetchFromBot(lookbackTs, lim * LOOKBACK_MULT);
	} else {
		allClaims = await _fetchFromRpc(lookbackTs, lim * LOOKBACK_MULT);
	}
	return filterFirstClaims(allClaims, sinceTs, lim);
}

// ── HTTP handler ──────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 50));

	let sinceTs;
	if (url.searchParams.has('sinceTs')) {
		sinceTs = Number(url.searchParams.get('sinceTs'));
	} else {
		const sinceMinutes = Math.max(1, Math.min(1440, Number(url.searchParams.get('sinceMinutes')) || 60));
		sinceTs = Math.floor(Date.now() / 1000) - sinceMinutes * 60;
	}

	if (!Number.isFinite(sinceTs) || sinceTs <= 0) {
		return error(res, 400, 'validation_error', 'invalid sinceTs');
	}

	const items = await scanFirstClaims({ sinceTs, limit });
	return json(res, 200, { items });
});

// ── Bot-backed path ────────────────────────────────────────────────────────

async function _fetchFromBot(lookbackTs, maxItems) {
	// Try a dedicated first-claims tool first, then fall back to recent claims.
	const r = await _botCall('getFirstClaims', { sinceTs: lookbackTs, limit: maxItems });
	if (r.ok) return _normalise(r.data);

	const r2 = await _botCall('getRecentClaims', { limit: maxItems });
	if (r2.ok) return _normalise(r2.data);

	return [];
}

async function _botCall(tool, args) {
	const url = process.env.PUMPFUN_BOT_URL;
	if (!url) return { ok: false };
	const headers = { 'content-type': 'application/json', accept: 'application/json' };
	if (process.env.PUMPFUN_BOT_TOKEN) headers.authorization = `Bearer ${process.env.PUMPFUN_BOT_TOKEN}`;
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	try {
		const resp = await fetch(url.replace(/\/$/, ''), {
			method: 'POST',
			headers,
			signal: ctrl.signal,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: tool, arguments: args || {} },
			}),
		});
		if (!resp.ok) return { ok: false, error: `bot ${resp.status}` };
		const j = await resp.json();
		if (j.error) return { ok: false, error: j.error.message || 'rpc error' };
		const data = j.result?.structuredContent ?? j.result?.content ?? j.result;
		const items = Array.isArray(data) ? data : (data?.items ?? []);
		return { ok: true, data: items };
	} catch (err) {
		return { ok: false, error: err?.message || 'fetch failed' };
	} finally {
		clearTimeout(t);
	}
}

function _normalise(items) {
	return (items || [])
		.map((x) => ({
			creator: String(x.claimerWallet || x.creator || x.wallet || ''),
			mint: String(x.tokenMint || x.mint || ''),
			signature: String(x.txSignature || x.tx_signature || x.signature || ''),
			lamports: Number(x.amountLamports || x.lamports || 0),
			ts: Number(x.timestamp || x.ts || 0),
		}))
		.filter((x) => x.creator && x.signature && x.ts > 0);
}

// ── Solana RPC fallback ────────────────────────────────────────────────────

async function _fetchFromRpc(lookbackTs, maxItems) {
	try {
		const connection = getConnection({ network: 'mainnet' });
		const { PublicKey } = await import('@solana/web3.js');
		const pk = new PublicKey(PUMP_PROGRAM);

		// Fetch recent signatures; filter by block time.
		const sigs = await connection.getSignaturesForAddress(pk, { limit: 200 });
		const inWindow = sigs.filter((s) => s.blockTime != null && s.blockTime >= lookbackTs && !s.err);
		if (inWindow.length === 0) return [];

		// Batch-fetch up to 30 transactions to stay within Vercel timeout.
		const toFetch = inWindow.slice(0, Math.min(30, maxItems * 2));
		const settled = await Promise.allSettled(
			toFetch.map((s) =>
				connection.getParsedTransaction(s.signature, {
					maxSupportedTransactionVersion: 0,
					commitment: 'confirmed',
				}),
			),
		);

		const claims = [];
		for (let i = 0; i < settled.length; i++) {
			if (settled[i].status !== 'fulfilled' || !settled[i].value) continue;
			const claim = _parseClaim(settled[i].value, toFetch[i].signature, toFetch[i].blockTime ?? 0);
			if (claim) claims.push(claim);
		}
		return claims;
	} catch {
		return [];
	}
}

function _parseClaim(tx, signature, ts) {
	if (tx?.meta?.err) return null;

	const ixs = tx?.transaction?.message?.instructions ?? [];
	const accountKeys = tx?.transaction?.message?.accountKeys ?? [];
	const pre = tx?.meta?.preBalances ?? [];
	const post = tx?.meta?.postBalances ?? [];

	for (const ix of ixs) {
		if (!ix.data || typeof ix.data !== 'string') continue;

		// Verify it's the PumpFun program.
		const progKey = accountKeys[ix.programIdIndex];
		const progId = progKey?.pubkey?.toString?.() ?? String(progKey ?? '');
		if (progId !== PUMP_PROGRAM) continue;

		// Match discriminator (first 8 bytes of base58-decoded data).
		let bytes;
		try {
			bytes = bs58.decode(ix.data);
		} catch {
			continue;
		}
		if (bytes.length < 8) continue;

		const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
		if (!CLAIM_DISCS.has(disc)) continue;

		// Creator = first account key (the signer).
		const creatorKey = accountKeys[0];
		const creator = creatorKey?.pubkey?.toString?.() ?? String(creatorKey ?? '');
		if (!creator) continue;

		// Lamports = largest positive balance delta (creator receives the fee).
		let lamports = 0;
		for (let i = 0; i < accountKeys.length; i++) {
			const delta = (post[i] ?? 0) - (pre[i] ?? 0);
			if (delta > lamports) lamports = delta;
		}

		// Mint: for distribute_creator_fees, it's embedded at bytes 16-48 (32-byte Pubkey).
		let mint = '';
		if (disc === 'a537817004b3ca28' && bytes.length >= 48) {
			try {
				mint = bs58.encode(bytes.slice(16, 48));
			} catch { /* leave empty */ }
		}

		return { creator, mint, signature, lamports, ts };
	}
	return null;
}
