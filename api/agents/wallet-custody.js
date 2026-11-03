// Owner-side custody of an agent's own Solana key.
//
//   POST /api/agents/:id/wallet/export/challenge  { method }            start a re-authentication
//   POST /api/agents/:id/wallet/export/grant      { method, proof }     prove it, receive a single-use grant
//   POST /api/agents/:id/wallet/export            { confirm_export, reauth_grant, client_public_key }
//   POST /api/agents/:id/wallet/export/rotate     { preview } | { confirm_rotate, expected_address }
//   GET  /api/agents/:id/wallet/history?range=24h|7d|30d&network=
//
// The export response is ciphertext only (api/_lib/custody/export-seal.js): the
// browser holds the only key that opens it, then encrypts the result to a
// passphrase that never leaves the page. Nothing here logs or returns the
// secret. "Rotate after export" generates a fresh platform key and sweeps SOL and
// every token balance to it before the old key is replaced.

import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { sql } from '../_lib/db.js';
import { cors, json, method, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { recordCustodyEvent } from '../_lib/agent-trade-guards.js';
import { logAudit } from '../_lib/audit.js';
import { generateSolanaAgentWallet, recoverSolanaAgentKeypair } from '../_lib/agent-wallet.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import { cacheSet } from '../_lib/cache.js';
import { CustodyHttpError, loadOwnedAgent, requirePrincipal } from '../_lib/custody/auth.js';
import { answerCustody, readCustodyBody } from '../_lib/custody/http.js';
import { assertClientPublicKey, sealForClient, SEAL_VERSION } from '../_lib/custody/export-seal.js';
import { completeReauth, consumeReauthGrant, startReauth } from '../_lib/custody/reauth.js';

const RANGES = Object.freeze({ '24h': 24, '7d': 24 * 7, '30d': 24 * 30 });
const SOL_FEE_RESERVE_LAMPORTS = 10_000n;

const networkOf = (value) => (value === 'devnet' ? 'devnet' : 'mainnet');

async function requireOwnerSession(req, res, id, scope) {
	const principal = await requirePrincipal(req, scope);
	const agent = await loadOwnedAgent(id, principal.userId);
	return { principal, agent };
}

function requireBrowser(principal) {
	if (principal.via !== 'session') {
		throw new CustodyHttpError(403, 'session_required', 'Key export needs you signed in to the three.ws site. API keys and OAuth tokens cannot do it.');
	}
}

function requireKey(agent) {
	const m = agent.meta || {};
	if (!m.solana_address || !m.encrypted_solana_secret) {
		throw new CustodyHttpError(409, 'key_missing', 'This agent has no platform-held Solana key to export.');
	}
	return m;
}

async function handleChallenge(req, res, id) {
	const { principal } = await requireOwnerSession(req, res, id, 'wallet:write');
	const rl = await limits.custodyExport(principal.userId);
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, principal.userId))) return;
	const body = await readCustodyBody(req);
	const out = await startReauth({ principal, purpose: 'export_key', method: String(body.method || '') });
	return json(res, 200, { data: out }, { 'cache-control': 'no-store' });
}

async function handleGrant(req, res, id) {
	const { principal } = await requireOwnerSession(req, res, id, 'wallet:write');
	const rl = await limits.custodyExport(principal.userId);
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, principal.userId))) return;
	const body = await readCustodyBody(req);
	const out = await completeReauth({
		principal, purpose: 'export_key', method: String(body.method || ''),
		proof: body.proof && typeof body.proof === 'object' ? body.proof : {},
	});
	return json(res, 200, { data: out }, { 'cache-control': 'no-store' });
}

async function handleExport(req, res, id) {
	const { principal, agent } = await requireOwnerSession(req, res, id, 'wallet:write');
	requireBrowser(principal);
	const rl = await limits.custodyExport(principal.userId);
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, principal.userId))) return;
	const body = await readCustodyBody(req);
	if (body.confirm_export !== true) {
		throw new CustodyHttpError(400, 'confirmation_required', 'Send confirm_export: true to export this key. Anyone holding it controls the wallet.');
	}
	const meta = requireKey(agent);
	assertClientPublicKey(body.client_public_key);
	await consumeReauthGrant({ userId: principal.userId, purpose: 'export_key', token: body.reauth_grant });

	const keypair = await recoverSolanaAgentKeypair(meta.encrypted_solana_secret, {
		agentId: id, userId: principal.userId, reason: 'key_export', custodyOverride: true,
	});
	const address = keypair.publicKey.toBase58();
	if (address !== meta.solana_address) {
		throw new CustodyHttpError(409, 'key_mismatch', 'The stored key does not match this wallet address, so it cannot be exported safely.');
	}
	const sealed = sealForClient(keypair.secretKey, body.client_public_key, { agentId: id, address });
	keypair.secretKey.fill(0);

	await recordCustodyEvent({
		agentId: id, userId: principal.userId, eventType: 'export', category: 'custody', reason: 'owner_key_export', status: 'ok',
		meta: { address, seal_version: SEAL_VERSION },
	});
	logAudit({ userId: principal.userId, action: 'custody.key_export', resourceId: id, meta: { address }, req });
	return json(res, 200, { data: { address, sealed, shown_once: true } }, { 'cache-control': 'no-store' });
}

async function readHoldings(conn, address) {
	const owner = new PublicKey(address);
	const lamports = BigInt(await conn.getBalance(owner, 'confirmed'));
	const tokens = [];
	for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
		const resp = await conn.getParsedTokenAccountsByOwner(owner, { programId });
		for (const { account } of resp.value) {
			const info = account.data?.parsed?.info;
			if (info && BigInt(info.tokenAmount?.amount || '0') > 0n) {
				tokens.push({ mint: info.mint, amount_raw: info.tokenAmount.amount, ui_amount: info.tokenAmount.uiAmount });
			}
		}
	}
	return { lamports, tokens };
}

async function handleRotate(req, res, id) {
	const { principal, agent } = await requireOwnerSession(req, res, id, 'wallet:write');
	requireBrowser(principal);
	const rl = await limits.custodyExport(principal.userId);
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, principal.userId))) return;
	const body = await readCustodyBody(req);
	const meta = requireKey(agent);
	const network = networkOf(body.network);
	const conn = solanaConnection({ network, commitment: 'confirmed' });

	let holdings;
	try {
		holdings = await readHoldings(conn, meta.solana_address);
	} catch (err) {
		throw Object.assign(new Error('Could not read the current wallet balance. Nothing was moved; try again.'), { status: 502, code: 'rpc_error', expose: true, cause: err });
	}

	if (body.confirm_rotate !== true) {
		return json(res, 200, {
			data: {
				preview: true,
				network,
				old_address: meta.solana_address,
				sol: Number(holdings.lamports) / 1e9,
				sol_after_fee: Number(holdings.lamports > SOL_FEE_RESERVE_LAMPORTS ? holdings.lamports - SOL_FEE_RESERVE_LAMPORTS : 0n) / 1e9,
				tokens: holdings.tokens,
				note: 'A new platform key is generated, every balance above is swept to it, then the exported key is retired. Anyone holding the old key sees an empty wallet.',
			},
		}, { 'cache-control': 'no-store' });
	}

	if (body.expected_address !== meta.solana_address) {
		throw new CustodyHttpError(409, 'stale_preview', 'The wallet changed since the preview. Review the preview again before rotating.');
	}

	const fresh = await generateSolanaAgentWallet();
	const oldKp = await recoverSolanaAgentKeypair(meta.encrypted_solana_secret, {
		agentId: id, userId: principal.userId, reason: 'rotate_after_export', custodyOverride: true,
		meta: { from: meta.solana_address, to: fresh.address, network },
	});
	const { sweepWalletToAddress } = await import('./solana-wallet.js');
	let swept;
	try {
		swept = await sweepWalletToAddress({ conn, fromKeypair: oldKp, toPubkey: new PublicKey(fresh.address), network });
	} catch (err) {
		throw Object.assign(new Error('Funds could not be fully moved to the new key. Your existing wallet is unchanged and still holds them. Try again.'), {
			status: 502, code: 'sweep_failed', expose: true, cause: err,
		});
	}

	const [current] = await sql`SELECT meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	const live = { ...(current?.meta || meta) };
	const history = Array.isArray(live.solana_wallet_history) ? live.solana_wallet_history : [];
	const next = {
		...live,
		solana_address: fresh.address,
		encrypted_solana_secret: fresh.encrypted_secret,
		solana_wallet_source: 'generated',
		solana_wallet_history: [...history, { address: meta.solana_address, replaced_at: new Date().toISOString(), reason: 'rotate_after_export', swept: true }].slice(-10),
	};
	delete next.solana_vanity_prefix;
	delete next.solana_vanity_suffix;
	await sql`UPDATE agent_identities SET meta = ${JSON.stringify(next)}::jsonb WHERE id = ${id}`;

	await recordCustodyEvent({
		agentId: id, userId: principal.userId, eventType: 'spend', category: 'key_rotation', network, asset: 'ALL', status: 'confirmed',
		signature: swept.signatures[swept.signatures.length - 1] || null, destination: fresh.address, reason: 'rotate_after_export',
		meta: { from: meta.solana_address, to: fresh.address, sol: swept.sol, tokens: swept.tokens, signatures: swept.signatures },
	}).catch(() => {});
	logAudit({ userId: principal.userId, action: 'custody.key_rotate', resourceId: id, meta: { from: meta.solana_address, to: fresh.address }, req });
	await cacheSet(`sol:bal:${meta.solana_address}:${network}`, null, 1).catch(() => {});
	await cacheSet(`sol:bal:${fresh.address}:${network}`, null, 1).catch(() => {});

	return json(res, 200, { data: { rotated: true, network, old_address: meta.solana_address, new_address: fresh.address, swept } }, { 'cache-control': 'no-store' });
}

/** Condense a series to its endpoints and extremes for the summary row. */
export function summarizeHistory(points) {
	if (!points.length) return { count: 0, first: null, last: null, change_usd: null, change_pct: null, min_usd: null, max_usd: null };
	const usd = points.map((p) => p.usd_total).filter((v) => v != null);
	const first = points[0];
	const last = points[points.length - 1];
	const change = first.usd_total != null && last.usd_total != null ? last.usd_total - first.usd_total : null;
	return {
		count: points.length,
		first: first.captured_at,
		last: last.captured_at,
		change_usd: change,
		change_pct: change != null && first.usd_total > 0 ? (change / first.usd_total) * 100 : null,
		min_usd: usd.length ? Math.min(...usd) : null,
		max_usd: usd.length ? Math.max(...usd) : null,
	};
}

export async function readBalanceHistory(agentId, { range = '24h', network = 'mainnet' } = {}) {
	const hours = RANGES[range];
	const rows = await sql`
		SELECT captured_at, address, lamports, usdc_raw, sol_usd, usd_total
		FROM agent_balance_history
		WHERE agent_id = ${agentId} AND network = ${network}
		  AND captured_at > now() - ${hours} * interval '1 hour'
		ORDER BY captured_at ASC
	`;
	const points = rows.map((r) => ({
		captured_at: new Date(r.captured_at).toISOString(),
		address: r.address,
		sol: r.lamports != null ? Number(r.lamports) / 1e9 : null,
		usdc: r.usdc_raw != null ? Number(r.usdc_raw) / 1e6 : null,
		sol_usd: r.sol_usd != null ? Number(r.sol_usd) : null,
		usd_total: r.usd_total != null ? Number(r.usd_total) : null,
	}));
	return { agent_id: agentId, network, range, interval: '1h', points, summary: summarizeHistory(points) };
}

async function handleHistory(req, res, id) {
	const { principal } = await requireOwnerSession(req, res, id, 'wallet:read');
	const rl = await limits.walletRead(principal.userId);
	if (!rl.success) return rateLimited(res, rl);
	const url = new URL(req.url, 'http://x');
	const range = url.searchParams.get('range') || '24h';
	if (!RANGES[range]) throw new CustodyHttpError(400, 'invalid_parameter', `range must be one of ${Object.keys(RANGES).join(', ')}`);
	const data = await readBalanceHistory(id, { range, network: networkOf(url.searchParams.get('network')) });
	return json(res, 200, { data }, { 'cache-control': 'private, max-age=60' });
}

/**
 * Dispatcher for /api/agents/:id/wallet/{export,history}.
 * @param {string} action  'export' | 'history'
 * @param {string[]} parts path segments; parts[5] is the export sub-step
 */
export default async function handler(req, res, id, action, parts = []) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	return answerCustody(res, async () => {
		if (action === 'history') {
			if (!method(req, res, ['GET'])) return;
			return handleHistory(req, res, id);
		}
		if (!method(req, res, ['POST'])) return;
		const step = parts[5];
		if (!step) return handleExport(req, res, id);
		if (step === 'challenge') return handleChallenge(req, res, id);
		if (step === 'grant') return handleGrant(req, res, id);
		if (step === 'rotate') return handleRotate(req, res, id);
		return json(res, 404, { error: 'not_found', error_description: 'unknown export step' });
	});
}
