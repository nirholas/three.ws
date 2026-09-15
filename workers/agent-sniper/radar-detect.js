// agent-sniper — pre-launch radar on-chain precursor detection.
//
// Pure parsers + bounded RPC reads that turn a watched wallet's raw transaction
// history into launch PRECURSORS:
//
//   (a) create   — the watched wallet itself submitted a pump.fun create
//                  instruction. The mint is one of the instruction's accounts, so
//                  we know the coin at block-0 (or before it indexes on the feed).
//   (b) funding  — the watched wallet sent SOL to a brand-new wallet with little
//                  history. That fresh wallet is the classic separate deploy
//                  wallet; the radar then watches IT for the create that follows.
//
// Everything here reads REAL chain data (Helius RPC when keyed, else the platform
// Solana RPC) — never fabricated. Parsers are exported and unit-tested against
// jsonParsed transaction fixtures.

import bs58 from 'bs58';
import {
	PUMP_PROGRAM_ID,
	CREATE_DISCRIMINATOR,
	CREATE_V2_DISCRIMINATOR,
} from '../../api/_lib/solana/programs.js';
import { rpcEndpoint } from '../../api/_lib/pump-intel/enrich.js';

const RPC_TIMEOUT_MS = 8_000;
const WSOL = 'So11111111111111111111111111111111111111112';
const NON_DEST = new Set([
	'11111111111111111111111111111111', // System Program
	WSOL,
	PUMP_PROGRAM_ID,
]);

// ── low-level RPC (bounded, never depends on the public endpoint alone) ──────
async function rpc(endpoint, method, params) {
	const r = await fetch(endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
	});
	if (!r.ok) {
		const e = new Error(`rpc ${method} ${r.status}`);
		e.status = r.status;
		throw e;
	}
	const body = await r.json();
	if (body.error) throw new Error(`rpc ${method}: ${body.error.message || body.error.code}`);
	return body.result;
}

export function radarEndpoint(network = 'mainnet') {
	return rpcEndpoint(network);
}

/**
 * Signatures for an address newer than `untilSig` (exclusive), newest-first as
 * the RPC returns them. Bounded to one page — the radar polls fast, so a watched
 * wallet won't produce more than a page of activity between ticks.
 * @returns {Promise<Array<{ signature, blockTime, err }>>}
 */
export async function fetchNewSignatures(address, { endpoint, untilSig = null, limit = 25 } = {}) {
	const params = [address, { limit: Math.max(1, Math.min(50, limit)) }];
	if (untilSig) params[1].until = untilSig;
	const page = await rpc(endpoint, 'getSignaturesForAddress', params);
	return Array.isArray(page) ? page : [];
}

/** Lifetime signature count for a wallet (one page is enough to call it fresh). */
export async function walletHistoryCount(address, { endpoint, freshMax = 12 } = {}) {
	const page = await rpc(endpoint, 'getSignaturesForAddress', [address, { limit: freshMax + 1 }]);
	const total = Array.isArray(page) ? page.length : 0;
	return { total, fresh: total <= freshMax };
}

/** jsonParsed transaction for a signature. */
export async function fetchTransaction(signature, { endpoint }) {
	return rpc(endpoint, 'getTransaction', [
		signature,
		{ encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' },
	]);
}

// ── pure parsers ─────────────────────────────────────────────────────────────

function keyToStr(k) {
	return typeof k === 'string' ? k : k?.pubkey || String(k ?? '');
}

function allInstructions(tx) {
	const msg = tx?.transaction?.message;
	const outer = Array.isArray(msg?.instructions) ? msg.instructions : [];
	const inner = [];
	for (const set of tx?.meta?.innerInstructions || []) {
		for (const ix of set?.instructions || []) inner.push(ix);
	}
	return [...outer, ...inner];
}

/**
 * Find a pump.fun create instruction and return the minted coin address.
 *
 * jsonParsed leaves the pump program's instructions un-parsed: `{ programId,
 * accounts:[pubkey], data:<base58> }`. We match the 8-byte create discriminator
 * on the decoded data, then read the mint — the FIRST account of a pump create
 * instruction. Returns null when the tx contains no pump create.
 *
 * @param {object} tx  jsonParsed getTransaction result
 * @returns {{ mint: string, variant: 'create'|'create_v2' }|null}
 */
export function parseCreateMint(tx) {
	if (!tx || tx?.meta?.err) return null;
	for (const ix of allInstructions(tx)) {
		const programId = ix.programId || keyToStr(ix.program);
		if (programId !== PUMP_PROGRAM_ID) continue;
		if (!ix.data || typeof ix.data !== 'string') continue;
		let bytes;
		try { bytes = bs58.decode(ix.data); } catch { continue; }
		if (bytes.length < 8) continue;
		const head = Buffer.from(bytes.subarray(0, 8));
		const variant = head.equals(CREATE_V2_DISCRIMINATOR) ? 'create_v2'
			: head.equals(CREATE_DISCRIMINATOR) ? 'create' : null;
		if (!variant) continue;
		const accounts = Array.isArray(ix.accounts) ? ix.accounts.map(keyToStr) : [];
		const mint = accounts[0];
		if (mint && mint.length >= 32) return { mint, variant };
	}
	return null;
}

/**
 * SOL outflows from `fromWallet` to other accounts in this tx (system transfer,
 * transferChecked, createAccount, createAccountWithSeed). The classic deploy-
 * funding move: a creator sends rent+buy SOL to a fresh wallet, which then mints.
 *
 * @param {object} tx          jsonParsed getTransaction result
 * @param {string} fromWallet  the watched wallet
 * @returns {Array<{ destination: string, lamports: number }>}
 */
export function parseFundingTransfers(tx, fromWallet) {
	if (!tx || tx?.meta?.err || !fromWallet) return [];
	const out = [];
	const seen = new Set();
	for (const ix of allInstructions(tx)) {
		const p = ix?.parsed;
		const isSystem = ix.program === 'system' || ix.programId === '11111111111111111111111111111111';
		if (!p || !isSystem) continue;
		const t = p.type;
		if (t !== 'transfer' && t !== 'transferChecked' && t !== 'createAccount' && t !== 'createAccountWithSeed') continue;
		const info = p.info || {};
		const src = info.source || info.from;
		const dest = info.destination || info.newAccount;
		const lamports = Number(info.lamports);
		if (src !== fromWallet || !dest || dest === fromWallet) continue;
		if (NON_DEST.has(dest)) continue;
		if (!Number.isFinite(lamports) || lamports <= 0) continue;
		if (seen.has(dest)) {
			const prev = out.find((o) => o.destination === dest);
			if (prev) prev.lamports += lamports;
			continue;
		}
		seen.add(dest);
		out.push({ destination: dest, lamports });
	}
	return out;
}

/**
 * Classify one transaction made (or signed) by `watchedWallet` into precursors.
 * Pure — given the parsed tx, returns the precursor list without any I/O. The
 * orchestrator decides freshness of funded wallets and correlation separately.
 *
 * @returns {{ create: {mint,variant}|null, fundings: Array<{destination,lamports}> }}
 */
export function classifyTransaction(tx, watchedWallet) {
	return {
		create: parseCreateMint(tx),
		fundings: parseFundingTransfers(tx, watchedWallet),
	};
}
