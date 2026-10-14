// Solana Transaction V1 observatory and pre-sign inspector.
//
// GET  /api/solana/atomic                     -> live feature-gate status
// GET  /api/solana/atomic?signature=<sig>     -> fetch and inspect a confirmed tx
// POST /api/solana/atomic { transaction }     -> inspect base64 wire bytes offline
// POST /api/solana/atomic { signature, ... }  -> same as the GET signature path
//
// A pump.fun transaction's inspection also carries `events`: every decoded
// Pump/PumpSwap/PumpFees event in that transaction, oldest first (see
// decodeTransactionEvents). A `create` transaction additionally carries
// `replay`: the earliest trades on that mint since launch, paged backward
// with `before` because getSignaturesForAddress has no forward cursor (see
// firstTradesAfterCreate).

import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import {
	TX_V1_FEATURE_ADDRESS,
	decodeFeatureActivationSlot,
	inspectWireTransaction,
} from '../_lib/solana/transaction-v1.js';
import { decodeTransactionEvents } from '../_lib/pump-events.js';
import { bondingProgressPct } from '../_lib/pump-bonding.js';

// Bounded cost for the replay feature: each page is one getSignaturesForAddress
// call (cheap), each trade found is one more getTransaction call (not cheap),
// so both the backward walk and the trade count stay capped regardless of what
// a caller asks for.
const REPLAY_PAGE_LIMIT = 1_000;
const REPLAY_PAGE_BUDGET = 5;
const REPLAY_TRADE_LIMIT_DEFAULT = 12;
const REPLAY_TRADE_LIMIT_MAX = 25;

function tradeStep(event, signature, blockTime) {
	const d = event.data;
	return {
		signature,
		blockTime: blockTime ?? null,
		side: d.isBuy ? 'buy' : 'sell',
		user: d.user,
		solAmountRaw: d.solAmount,
		tokenAmountRaw: d.tokenAmount,
		virtualSolReserves: d.virtualSolReserves,
		virtualTokenReserves: d.virtualTokenReserves,
		realSolReserves: d.realSolReserves,
		realTokenReserves: d.realTokenReserves,
		curveProgressPct: bondingProgressPct(d.realTokenReserves),
	};
}

/**
 * The earliest trades on `mint` since `createSignature`, walking
 * getSignaturesForAddress backward from `before` (or from now) because Solana
 * has no forward-from-a-point cursor. Bounded by REPLAY_PAGE_BUDGET pages; a
 * caller that gets `hasMore: true` back pages deeper with `nextBefore`.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} mint
 * @param {string} createSignature
 * @param {{limit?: number, before?: string}} [opts]
 */
async function firstTradesAfterCreate(connection, mint, createSignature, opts = {}) {
	const limit = Math.min(Math.max(1, Number(opts.limit) || REPLAY_TRADE_LIMIT_DEFAULT), REPLAY_TRADE_LIMIT_MAX);
	const mintKey = new PublicKey(mint);
	let cursor = opts.before || undefined;
	const collected = [];
	let reachedCreate = false;

	for (let page = 0; page < REPLAY_PAGE_BUDGET; page++) {
		const sigs = await connection.getSignaturesForAddress(mintKey, { limit: REPLAY_PAGE_LIMIT, before: cursor });
		if (!sigs.length) break;
		const createIdx = sigs.findIndex((s) => s.signature === createSignature);
		if (createIdx !== -1) {
			collected.push(...sigs.slice(0, createIdx));
			reachedCreate = true;
			break;
		}
		collected.push(...sigs);
		cursor = sigs[sigs.length - 1].signature;
	}

	// getSignaturesForAddress answers newest first; the earliest trades sit at
	// the tail of what we collected walking backward.
	const chronological = collected.filter((s) => !s.err).reverse();
	const earliest = chronological.slice(0, limit);

	const trades = [];
	for (const s of earliest) {
		const rpc = await connection._rpcRequest('getTransaction', [
			s.signature,
			{ encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
		]);
		const logs = rpc?.result?.meta?.logMessages;
		if (!logs) continue;
		for (const event of decodeTransactionEvents(logs)) {
			if (event.type === 'trade' && event.data.mint === mint) {
				trades.push(tradeStep(event, s.signature, rpc.result.blockTime ?? s.blockTime ?? null));
			}
		}
	}

	return { trades, reachedCreate, nextBefore: reachedCreate ? null : cursor || null };
}

function isSignature(value) {
	if (!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(value)) return false;
	try {
		return bs58.decode(value).length === 64;
	} catch {
		return false;
	}
}

async function liveStatus(connection) {
	const [account, slot] = await Promise.all([
		connection.getAccountInfo(new PublicKey(TX_V1_FEATURE_ADDRESS), 'confirmed'),
		connection.getSlot('confirmed'),
	]);
	const activationSlot = account ? decodeFeatureActivationSlot(account.data) : null;
	return {
		cluster: 'mainnet-beta',
		feature: 'txv1',
		featureAddress: TX_V1_FEATURE_ADDRESS,
		active: activationSlot !== null && Number(slot) >= Number(activationSlot),
		activationSlot,
		currentSlot: slot,
		legacyLimitBytes: 1_232,
		v1LimitBytes: 4_096,
	};
}

async function inspectSignature(connection, signature, opts = {}) {
	const rpc = await connection._rpcRequest('getTransaction', [
		signature,
		{ encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
	]);
	if (rpc.error) throw Object.assign(new Error(rpc.error.message || 'Solana RPC rejected the request'), { upstream: true });
	if (!rpc.result) return null;

	const encoded = rpc.result.transaction?.[0];
	if (typeof encoded !== 'string') {
		throw Object.assign(new Error('Solana RPC returned an unsupported transaction encoding'), { upstream: true });
	}
	const inspection = inspectWireTransaction(encoded);
	const consumed = rpc.result.meta?.computeUnitsConsumed ?? null;
	const events = decodeTransactionEvents(rpc.result.meta?.logMessages || []).map((e) => {
		if (e.type === 'create' || e.type === 'trade') return { ...e, curveProgressPct: bondingProgressPct(e.data.realTokenReserves) };
		if (e.type === 'complete') return { ...e, curveProgressPct: 100 };
		return e;
	});

	let replay = null;
	const createEvent = events.find((e) => e.type === 'create');
	if (createEvent) {
		const mint = createEvent.data.mint;
		try {
			const { trades, reachedCreate, nextBefore } = await firstTradesAfterCreate(connection, mint, signature, {
				limit: opts.tradeLimit,
				before: opts.before,
			});
			replay = { mint, creator: createEvent.data.creator, trades, hasMore: !reachedCreate, nextBefore, error: null };
		} catch (err) {
			replay = { mint, creator: createEvent.data.creator, trades: [], hasMore: true, nextBefore: null, error: err.message };
		}
	}

	return {
		...inspection,
		signature,
		cluster: 'mainnet-beta',
		events,
		replay,
		confirmation: {
			slot: rpc.result.slot,
			blockTime: rpc.result.blockTime ?? null,
			success: rpc.result.meta?.err == null,
			error: rpc.result.meta?.err ?? null,
			feeLamports: rpc.result.meta?.fee ?? null,
			computeUnitsConsumed: consumed,
			computeUtilizationPct:
				consumed !== null && inspection.budget.computeUnitLimit
					? Math.round((Number(consumed) / Number(inspection.budget.computeUnitLimit)) * 1_000) / 10
					: null,
		},
		explorerUrl: `https://solscan.io/tx/${signature}`,
	};
}

export default wrap(async function atomicHandler(req, res) {
	if (cors(req, res, { origins: '*', methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const [ipLimit, globalLimit] = await Promise.all([
		limits.cryptoDataIp(clientIp(req)),
		limits.cryptoDataGlobal(),
	]);
	if (!ipLimit.success || !globalLimit.success) {
		return error(res, 429, 'rate_limited', 'too many requests - retry shortly');
	}

	const connection = solanaConnection({ network: 'mainnet' });

	if (req.method === 'POST') {
		let body;
		try {
			body = await readJson(req, 16_384);
		} catch (err) {
			return error(res, err.status || 400, 'invalid_json', err.message);
		}

		const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
		if (signature) {
			if (!isSignature(signature)) {
				return error(res, 400, 'invalid_signature', 'signature must be a base58 Solana transaction signature');
			}
			return respondWithSignature(res, connection, signature, { before: body.before, tradeLimit: body.tradeLimit });
		}

		try {
			const inspection = inspectWireTransaction(body.transaction);
			res.setHeader('cache-control', 'no-store');
			return json(res, 200, { inspection });
		} catch (err) {
			return error(res, err.status || 400, 'invalid_transaction', err.message);
		}
	}

	const url = new URL(req.url, 'http://atomic.local');
	const signature = (url.searchParams.get('signature') || '').trim();

	if (!signature) {
		try {
			const status = await liveStatus(connection);
			res.setHeader('cache-control', 'public, s-maxage=15, stale-while-revalidate=45');
			return json(res, 200, { status });
		} catch (err) {
			console.error('[solana/atomic] status lookup failed:', err?.message);
			return error(res, 502, 'upstream_error', 'Solana mainnet status is temporarily unavailable');
		}
	}

	if (!isSignature(signature)) {
		return error(res, 400, 'invalid_signature', 'signature must be a base58 Solana transaction signature');
	}

	return respondWithSignature(res, connection, signature, {
		before: url.searchParams.get('before') || undefined,
		tradeLimit: url.searchParams.get('tradeLimit') || undefined,
	});
});

async function respondWithSignature(res, connection, signature, opts) {
	try {
		const inspection = await inspectSignature(connection, signature, opts);
		if (!inspection) return error(res, 404, 'not_found', 'transaction was not found on Solana mainnet');
		res.setHeader('cache-control', opts.before ? 'no-store' : 'public, s-maxage=3600, stale-while-revalidate=86400');
		return json(res, 200, { inspection });
	} catch (err) {
		console.error('[solana/atomic] transaction lookup failed:', err?.message);
		return error(res, err.upstream ? 502 : 400, err.upstream ? 'upstream_error' : 'invalid_transaction', err.message);
	}
}
