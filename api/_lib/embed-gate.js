// Token-gated 3D embeds — gate config storage, ownership checks, and the
// server-side SPL balance read. This is the "token-gate verifier" the comment
// atop embed-asset.js and api/embed/resolve.js promises: an embed asset
// (avatar or on-chain agent) can carry a gate row here, and resolve.js only
// hands back the real glbUrl once the caller proves — with a real Solana RPC
// read, never a client-reported number — they hold at least `min_amount` of
// `mint`.
//
// Canonical use: $THREE-holder-only avatars and rooms. `mint` is a runtime
// parameter (the coin-agnostic plumbing exception in CLAUDE.md) so any
// community can gate with their own SPL token — three.ws never hardcodes,
// markets, or recommends a mint other than $THREE as the default.
//
// Split from api/embed/gate-create.js and api/embed/gate-verify.js so the
// create_gated_embed MCP tool (api/_mcp/tools/embed.js) and the REST endpoints
// share one implementation instead of drifting.

import { sql } from './db.js';
import { solanaRpcEndpoints, noteRpcSpend } from './solana/connection.js';
import { ONCHAIN_RE, AVATAR_RE } from './embed-asset.js';
import { randomToken } from './crypto.js';

// The only coin three.ws promotes or ships as a default/example. Matches
// src/pump/three-token-data.js and src/three-gate.js.
export const DEFAULT_GATE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// Guard rails on a creator-set threshold — same ceiling world-gate.js uses for
// the same reason: bound a fat-fingered or hostile value to something a real
// SPL supply could plausibly hold.
const MAX_MIN_AMOUNT = 1e15;

/** Clamp an arbitrary input to a valid token threshold, or 0 when invalid. */
export function normalizeMinAmount(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(n, MAX_MIN_AMOUNT);
}

/** A trimmed mint string, or the $THREE default when none was supplied. */
export function normalizeMint(v) {
	const s = String(v ?? '').trim();
	return s || DEFAULT_GATE_MINT;
}

/** True when `balance` clears `minAmount` — the one comparison every caller must agree on. */
export function meetsGateThreshold(balance, minAmount) {
	return Number(balance) >= Number(minAmount);
}

/**
 * The active (non-revoked) gate for an embed asset, or null when the asset is
 * ungated. Both resolve.js (deciding whether to require a token) and
 * gate-verify.js (deciding what to check against) call this.
 */
export async function readEmbedGateByAsset(assetId) {
	const id = String(assetId || '').trim();
	if (!id) return null;
	const rows = await sql`
		select id, asset_id, owner_user_id, chain, mint, min_amount, created_at
		from embed_gates
		where asset_id = ${id} and revoked_at is null
		limit 1
	`;
	return rows[0] || null;
}

/** Read a gate by its own id (used to confirm a nonce/token still points at a live gate). */
export async function readEmbedGate(gateId) {
	const id = String(gateId || '').trim();
	if (!id) return null;
	const rows = await sql`
		select id, asset_id, owner_user_id, chain, mint, min_amount, created_at
		from embed_gates
		where id = ${id} and revoked_at is null
		limit 1
	`;
	return rows[0] || null;
}

/**
 * Create (or replace) the gate on an embed asset. Revokes any existing active
 * gate on the same asset first — a creator raising/lowering the requirement
 * gets a clean row, and every access token minted against the old gate id
 * stops verifying immediately (gate-verify.js checks the token's gateId is
 * still the asset's current gate).
 */
export async function createEmbedGate({ assetId, ownerUserId, mint, minAmount, chain = 'solana' }) {
	if (chain !== 'solana') {
		throw Object.assign(new Error('only solana SPL-token gating is supported'), { status: 400 });
	}
	const amount = normalizeMinAmount(minAmount);
	if (amount <= 0) {
		throw Object.assign(new Error('minAmount must be a positive number'), { status: 400 });
	}
	const resolvedMint = normalizeMint(mint);

	let gateId = '';
	while (gateId.length < 12) gateId += randomToken(16).replace(/[^A-Za-z0-9]/g, '');
	gateId = gateId.slice(0, 12);

	await sql`update embed_gates set revoked_at = now(), updated_at = now() where asset_id = ${assetId} and revoked_at is null`;
	await sql`
		insert into embed_gates (id, asset_id, owner_user_id, chain, mint, min_amount)
		values (${gateId}, ${assetId}, ${ownerUserId}, ${chain}, ${resolvedMint}, ${amount})
	`;

	return { gateId, assetId, ownerUserId, chain, mint: resolvedMint, minAmount: amount };
}

/**
 * Remove the gate from an embed asset, turning it back into an open embed.
 * Every access token minted against the revoked gate stops verifying at once,
 * for the same reason a replaced gate's do. Returns how many rows were revoked
 * (0 when the asset had no active gate).
 */
export async function revokeEmbedGate(assetId) {
	const rows = await sql`
		update embed_gates set revoked_at = now(), updated_at = now()
		where asset_id = ${assetId} and revoked_at is null
		returning id
	`;
	return rows.length;
}

/**
 * Does `userId` own the underlying asset well enough to gate it?
 *   - avatar:<uuid>       → avatars.owner_id === userId
 *   - <chainId>:<agentId> → the on-chain agent's `owner` (0x address) matches
 *                            one of the user's linked EVM wallets
 * Returns { ok:true } or { ok:false, reason: 'not_found' | 'not_owner' | 'invalid_asset' }.
 */
export async function checkAssetOwnership(assetId, userId) {
	const spec = String(assetId || '').trim();

	const onchain = spec.match(ONCHAIN_RE);
	if (onchain) {
		const chainId = parseInt(onchain[1], 10);
		const agentId = parseInt(onchain[2], 10);
		const rows = await sql`
			select owner from erc8004_agents_index
			where active = true and chain_id = ${chainId} and agent_id = ${agentId}
			limit 1
		`;
		if (!rows.length) return { ok: false, reason: 'not_found' };
		const owner = String(rows[0].owner || '').toLowerCase();
		const linked = await sql`
			select 1 from user_wallets
			where user_id = ${userId} and chain_type = 'evm' and lower(address) = ${owner}
			limit 1
		`;
		return linked.length ? { ok: true } : { ok: false, reason: 'not_owner' };
	}

	const avatar = spec.match(AVATAR_RE);
	if (avatar) {
		const rows = await sql`
			select owner_id from avatars where id = ${avatar[1]} and deleted_at is null limit 1
		`;
		if (!rows.length) return { ok: false, reason: 'not_found' };
		return rows[0].owner_id === userId ? { ok: true } : { ok: false, reason: 'not_owner' };
	}

	return { ok: false, reason: 'invalid_asset' };
}

// ── On-chain SPL balance read ────────────────────────────────────────────────

// Solana RPC calls are cheap reads but not free — bound how many endpoints a
// single balance check will try before giving up, so a fully-down provider
// chain fails in a few seconds instead of hanging on 8+ endpoints.
const MAX_ENDPOINTS_TRIED = 4;
const RPC_TIMEOUT_MS = 8000;

/**
 * Real, server-side SPL token balance for `walletAddress` in `mint` — never
 * trust a client-reported number. Rotates across the same priority-ordered
 * endpoint list solanaConnection() uses (Helius → Alchemy → dRPC → keyless
 * public fallbacks) so a single provider outage doesn't fail the gate.
 * @returns {Promise<number>} the uiAmount balance (0 when the wallet holds none)
 */
export async function getSplTokenBalance(walletAddress, mint) {
	const endpoints = solanaRpcEndpoints('mainnet').slice(0, MAX_ENDPOINTS_TRIED);
	let lastErr = null;
	for (const url of endpoints) {
		try {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'getTokenAccountsByOwner',
				params: [walletAddress, { mint }, { encoding: 'jsonParsed' }],
			});
			noteRpcSpend(url, body);
			const resp = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
				body,
			});
			if (!resp.ok) {
				lastErr = new Error(`solana rpc ${resp.status}`);
				continue;
			}
			const data = await resp.json();
			if (data.error) {
				lastErr = new Error(data.error.message || JSON.stringify(data.error));
				continue;
			}
			const accounts = data.result?.value || [];
			return accounts.reduce(
				(sum, a) => sum + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0),
				0,
			);
		} catch (err) {
			lastErr = err;
		}
	}
	throw lastErr || new Error('all solana rpc endpoints failed');
}
