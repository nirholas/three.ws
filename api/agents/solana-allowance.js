// Owner-funded agent budgets enforced on-chain by the Solana Subscriptions and
// Allowances program. Dispatched from api/agents/solana-wallet.js with the
// `allowance` action. Docs: docs/agent-allowance-budgets.md
//
// The owner keeps funds in their own wallet. The server only ever PREPARES the
// owner's transactions (create, revoke) and returns them unsigned; the owner
// signs in their own wallet. The agent pulls with its custodial key, and only
// after the live on-chain remaining amount has cleared the guard ceiling.
//
//   GET  /allowance[?network=]                list allowances with live status
//   POST /allowance { op: 'prepare', mint, amount, expiresInDays, kind?, ... }
//   POST /allowance { op: 'confirm', signature, delegationPda, nonce, ... }
//   POST /allowance { op: 'revoke', id }      unsigned revoke tx for the owner
//   POST /allowance { op: 'revoked', id, signature }   record a confirmed revoke
//   POST /allowance { op: 'pull', id, amount }         agent pulls within the cap

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { recoverSolanaAgentKeypair } from '../_lib/agent-wallet.js';
import { solanaConnection } from '../_lib/agent-pumpfun.js';
import { confirmOrThrow } from '../_lib/solana/confirm.js';
import { logAudit } from '../_lib/audit.js';
import { recordCustodyEvent } from '../_lib/agent-trade-guards.js';
import {
	AllowanceError,
	prepareCreateAllowance,
	prepareRevokeAllowance,
	readAllowance,
	checkAllowancePull,
	buildSignedPull,
	describeProgramFailure,
	recurringEnabled,
} from '../_lib/onchain-allowance.js';
import { listAllowances, getAllowance, recordAllowance, markRevoked, checkAgentAllowanceSpend } from '../_lib/onchain-allowance-store.js';

const NETWORKS = new Set(['mainnet', 'devnet']);
const MAX_EXPIRY_DAYS = 365;
const ERROR_STATUS = {
	invalid_request: 400,
	feature_disabled: 403,
	mint_not_found: 404,
	allowance_not_found: 404,
	mint_unsupported: 422,
};

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	assertBearerMaySpend(bearer, req);
	return { userId: bearer.userId };
}

async function loadOwnedAgent(req, res, id) {
	const auth = await resolveAuth(req);
	if (!auth) { error(res, 401, 'unauthorized', 'sign in required'); return null; }
	const [row] = await sql`SELECT id, user_id, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) { error(res, 404, 'not_found', 'agent not found'); return null; }
	if (row.user_id !== auth.userId) { error(res, 403, 'forbidden', 'not your agent'); return null; }
	return { auth, meta: row.meta || {}, address: row.meta?.solana_address || null };
}

async function ownerWallets(userId) {
	const rows = await sql`SELECT address FROM user_wallets WHERE user_id = ${userId} AND chain_type = 'solana'`;
	return rows.map((r) => r.address);
}

function statusOf(row, live) {
	if (row.revokedAt) return 'revoked';
	if (!live) return 'closed';
	if (live.expired) return 'expired';
	if (BigInt(live.remaining) === 0n) return 'exhausted';
	return 'active';
}

function toRaw(humanAmount, decimals) {
	const s = String(humanAmount ?? '').trim();
	if (!/^\d+(\.\d+)?$/.test(s)) throw new AllowanceError('invalid_request', 'amount must be a positive decimal number');
	const [whole, frac = ''] = s.split('.');
	if (frac.length > decimals) throw new AllowanceError('invalid_request', `this token supports at most ${decimals} decimal places`);
	const raw = BigInt(whole + frac.padEnd(decimals, '0'));
	if (raw <= 0n) throw new AllowanceError('invalid_request', 'amount must be greater than zero');
	return raw;
}

async function mintDecimals(conn, mint) {
	const { getMint } = await import('@solana/spl-token');
	const { PublicKey } = await import('@solana/web3.js');
	const info = await conn.getAccountInfo(new PublicKey(mint), 'confirmed');
	if (!info) throw new AllowanceError('mint_not_found', 'that token mint does not exist on this network');
	return (await getMint(conn, new PublicKey(mint), 'confirmed', info.owner)).decimals;
}

async function present(row) {
	let live = null;
	let liveError = null;
	if (!row.revokedAt) {
		try {
			live = await readAllowance({ network: row.network, kind: row.kind, delegationPda: row.delegationPda });
		} catch (e) {
			liveError = e?.message || 'rpc error';
		}
	}
	const cap = BigInt(row.capRaw);
	const remaining = live ? BigInt(live.remaining) : 0n;
	return {
		...row,
		status: liveError ? 'unknown' : statusOf(row, live),
		remainingRaw: live ? remaining.toString() : null,
		spentRaw: live ? (cap > remaining ? cap - remaining : 0n).toString() : null,
		expired: live?.expired ?? false,
		liveError,
	};
}

export async function handleAllowance(req, res, id) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const owned = await loadOwnedAgent(req, res, id);
	if (!owned) return;
	const { auth, address } = owned;

	const rl = await limits.walletRead(auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://x');

	if (req.method === 'GET') {
		const network = url.searchParams.get('network') || 'mainnet';
		if (!NETWORKS.has(network)) return error(res, 400, 'invalid_request', 'network must be mainnet or devnet');
		const rows = await listAllowances(id, network, { includeRevoked: url.searchParams.get('history') === '1' });
		const conn = rows.length ? solanaConnection(network) : null;
		const decimalsByMint = new Map();
		for (const mint of new Set(rows.map((r) => r.mint))) {
			decimalsByMint.set(mint, await mintDecimals(conn, mint).catch(() => null));
		}
		const allowances = (await Promise.all(rows.map(present))).map((a) => ({ ...a, decimals: decimalsByMint.get(a.mint) ?? null }));
		return json(res, 200, { data: { network, agentAddress: address, recurringEnabled: recurringEnabled(), allowances } });
	}

	if (!(await requireCsrf(req, res, auth.userId))) return;
	let body;
	try {
		body = await readJson(req);
	} catch (e) {
		return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body');
	}
	const network = body?.network || 'mainnet';
	if (!NETWORKS.has(network)) return error(res, 400, 'invalid_request', 'network must be mainnet or devnet');

	try {
		switch (body?.op) {
			case 'prepare': return await opPrepare({ req, res, id, auth, address, body, network });
			case 'confirm': return await opConfirm({ req, res, id, auth, address, body, network });
			case 'revoke': return await opRevoke({ res, id, body });
			case 'revoked': return await opRevoked({ req, res, id, auth, body });
			case 'pull': return await opPull({ req, res, id, auth, owned, body });
			default: return error(res, 400, 'invalid_request', 'op must be prepare, confirm, revoke, revoked or pull');
		}
	} catch (e) {
		if (e instanceof AllowanceError) return error(res, ERROR_STATUS[e.code] || 400, e.code, e.message);
		throw e;
	}
}

async function opPrepare({ res, auth, address, body, network }) {
	if (!address) throw new AllowanceError('invalid_request', 'this agent has no Solana wallet yet');
	const owner = typeof body.owner === 'string' ? body.owner : '';
	if (!(await ownerWallets(auth.userId)).includes(owner)) {
		throw new AllowanceError('invalid_request', 'owner must be a Solana wallet linked to your account');
	}
	const days = Number(body.expiresInDays);
	if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
		throw new AllowanceError('invalid_request', `expiresInDays must be between 1 and ${MAX_EXPIRY_DAYS}`);
	}
	const conn = solanaConnection(network);
	const decimals = await mintDecimals(conn, body.mint);
	const amount = toRaw(body.amount, decimals);
	const kind = body.kind === 'recurring' ? 'recurring' : 'fixed';
	const prep = await prepareCreateAllowance({
		network,
		owner,
		delegatee: address,
		mint: body.mint,
		amount,
		expiryTs: Math.floor(Date.now() / 1000) + Math.round(days * 86400),
		kind,
		periodLengthS: kind === 'recurring' ? Number(body.periodLengthS) : undefined,
		connection: conn,
	});
	return json(res, 200, { data: { ...prep, amount: prep.amount.toString(), nonce: prep.nonce.toString(), decimals } });
}

async function opConfirm({ req, res, id, auth, address, body, network }) {
	const { signature, delegationPda } = body;
	if (typeof signature !== 'string' || typeof delegationPda !== 'string') {
		throw new AllowanceError('invalid_request', 'signature and delegationPda are required');
	}
	const kind = body.kind === 'recurring' ? 'recurring' : 'fixed';
	const conn = solanaConnection(network);
	await confirmOrThrow(conn, signature, 'confirmed').catch((e) => {
		throw new AllowanceError('invalid_request', `the create transaction did not confirm: ${e?.message || 'unknown error'}`);
	});
	const live = await readAllowance({ network, kind, delegationPda, connection: conn });
	if (!live) throw new AllowanceError('allowance_not_found', 'no allowance account exists at that address');
	if (live.delegatee !== address) throw new AllowanceError('invalid_request', 'that allowance does not delegate to this agent');
	if (!(await ownerWallets(auth.userId)).includes(live.owner)) {
		throw new AllowanceError('invalid_request', 'that allowance was not created by a wallet linked to your account');
	}
	const row = await recordAllowance({
		agentId: id,
		userId: auth.userId,
		network,
		kind,
		ownerWallet: live.owner,
		delegatee: live.delegatee,
		mint: live.mint,
		nonce: body.nonce ?? '0',
		delegationPda,
		capRaw: kind === 'recurring' ? live.capOnChain : live.remaining,
		expiryTs: live.expiryTs,
		periodLengthS: live.periodLengthS,
		createSignature: signature,
	});
	logAudit({ userId: auth.userId, action: 'custody.allowance_created', resourceId: id, meta: { delegationPda, mint: live.mint, cap: row.capRaw, network, signature }, req });
	return json(res, 200, { data: { allowance: await present(row) } });
}

async function opRevoke({ res, id, body }) {
	const row = await getAllowance(id, body.id);
	if (!row || row.revokedAt) throw new AllowanceError('allowance_not_found', 'no active allowance with that id');
	const prep = await prepareRevokeAllowance({ network: row.network, owner: row.ownerWallet, delegationPda: row.delegationPda });
	return json(res, 200, { data: { ...prep, id: row.id } });
}

async function opRevoked({ req, res, id, auth, body }) {
	const row = await getAllowance(id, body.id);
	if (!row) throw new AllowanceError('allowance_not_found', 'no allowance with that id');
	const live = await readAllowance({ network: row.network, kind: row.kind, delegationPda: row.delegationPda });
	if (live) throw new AllowanceError('invalid_request', 'that allowance is still open on chain; submit the revoke transaction first');
	const updated = await markRevoked(row.id, typeof body.signature === 'string' ? body.signature : null);
	logAudit({ userId: auth.userId, action: 'custody.allowance_revoked', resourceId: id, meta: { delegationPda: row.delegationPda, network: row.network, signature: body.signature || null }, req });
	return json(res, 200, { data: { allowance: await present(updated) } });
}

async function opPull({ req, res, id, auth, owned, body }) {
	const row = await getAllowance(id, body.id);
	if (!row || row.revokedAt) throw new AllowanceError('allowance_not_found', 'no active allowance with that id');
	let amount;
	try { amount = BigInt(body.amountRaw); } catch { throw new AllowanceError('invalid_request', 'amountRaw must be an integer string'); }

	// Hard ceiling first: nothing is built or signed when the program would refuse.
	const verdict = await checkAgentAllowanceSpend({ agentId: id, network: row.network, mint: row.mint, amount });
	const mine = verdict.allowance?.id === row.id ? verdict : await checkAllowancePull({ network: row.network, kind: row.kind, delegationPda: row.delegationPda, amount });
	if (!mine.allow) {
		await recordCustodyEvent({
			agentId: id, userId: auth.userId, eventType: 'blocked', category: 'allowance_pull', network: row.network,
			asset: row.mint, amountRaw: amount, reason: mine.code, status: 'blocked',
			meta: { allowanceId: row.id, detail: mine.detail ?? null },
		}).catch(() => {});
		return json(res, 422, { error: mine.code, error_description: mine.reason, data: { detail: mine.detail ?? null } });
	}

	if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network: row.network, context: 'allowance_pull' }))) return;
	if (!owned.meta.encrypted_solana_secret) throw new AllowanceError('invalid_request', 'this agent has no custodial Solana key to sign with');
	const agentKeypair = await recoverSolanaAgentKeypair(owned.meta.encrypted_solana_secret, {
		agentId: id, userId: auth.userId, reason: 'allowance_pull',
		meta: { allowanceId: row.id, mint: row.mint, network: row.network },
	});
	const conn = solanaConnection(row.network);
	const built = await buildSignedPull({ network: row.network, kind: row.kind, delegationPda: row.delegationPda, owner: row.ownerWallet, mint: row.mint, amount, agentKeypair, connection: conn });
	const sim = await conn.simulateTransaction(built.tx);
	if (sim.value.err) {
		const msg = describeProgramFailure(new Error(`${JSON.stringify(sim.value.err)}\n${(sim.value.logs || []).join('\n')}`));
		return error(res, 422, 'program_rejected', msg);
	}
	const signature = await conn.sendRawTransaction(built.tx.serialize(), { skipPreflight: false, maxRetries: 3 });
	await confirmOrThrow(conn, { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }, 'confirmed');
	await recordCustodyEvent({
		agentId: id, userId: auth.userId, eventType: 'allowance_pull', category: 'allowance_pull', network: row.network,
		asset: row.mint, amountRaw: amount, signature, reason: 'owner_funded_allowance', status: 'ok',
		meta: { allowanceId: row.id, delegationPda: row.delegationPda, owner: row.ownerWallet },
	}).catch((e) => console.warn('[allowance] custody record failed', e?.message));
	logAudit({ userId: auth.userId, action: 'custody.allowance_pull', resourceId: id, meta: { allowanceId: row.id, mint: row.mint, amountRaw: amount.toString(), signature, network: row.network }, req });
	return json(res, 200, { data: { signature, receiverAta: built.receiverAta, allowance: await present(row) } });
}
