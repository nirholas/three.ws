// /api/agents/:id/signer: how an agent's fund-moving actions are signed.
//
//   GET    /api/agents/:id/signer           the mode, the external key, the session, recent external txs
//   PUT    /api/agents/:id/signer           { mode: 'platform' | 'external' | 'session', ... }
//   DELETE /api/agents/:id/signer/session   end the session key, return the on-chain revoke to sign
//
// Modes and their contract live in api/_lib/custody/signing.js. A mode change
// away from `session` ends the session at once and returns the owner-signed
// revoke transaction, so the on-chain approval disappears too.

import { sql } from '../_lib/db.js';
import { cors, json, method, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { recordCustodyEvent } from '../_lib/agent-trade-guards.js';
import { logAudit } from '../_lib/audit.js';
import { loadOwnedAgent, requirePrincipal } from '../_lib/custody/auth.js';
import { answerCustody, readCustodyBody } from '../_lib/custody/http.js';
import { clientError } from '../_lib/custody/builders.js';
import { listExternalTxs, publicExternalTx, requirePubkey } from '../_lib/custody/external-tx.js';
import { beginSessionGrant, endSession } from '../_lib/custody/session.js';
import { SIGNER_MODES, getAgentSigner, primaryLinkedSolanaWallet, publicSigner } from '../_lib/custody/signing.js';

async function ownerKey(body, userId) {
	const named = body.pubkey ?? body.external_pubkey ?? body.signer_pubkey;
	if (named) return requirePubkey(named, 'pubkey');
	const linked = await primaryLinkedSolanaWallet(userId);
	if (!linked) throw clientError('signer_pubkey_required', 'Name the wallet that will sign (pubkey), or link a Solana wallet to your account.');
	return linked;
}

async function view(agentId, userId) {
	const row = await getAgentSigner(agentId);
	const recent = (await listExternalTxs(userId, { agentId, limit: 10 })).map(publicExternalTx);
	return { ...publicSigner(row), recent_external_txs: recent };
}

async function writeMode(agentId, userId, mode, externalPubkey) {
	await sql`
		INSERT INTO agent_signers (agent_id, user_id, mode, external_pubkey, updated_at)
		VALUES (${agentId}, ${userId}, ${mode}, ${externalPubkey}, now())
		ON CONFLICT (agent_id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			mode = EXCLUDED.mode,
			external_pubkey = COALESCE(EXCLUDED.external_pubkey, agent_signers.external_pubkey),
			updated_at = now()
	`;
}

/** End a live session (if any) and return its revoke transaction. */
async function closeSession(agentId, userId) {
	const current = await getAgentSigner(agentId);
	if (!current.session_pubkey || !['active', 'pending'].includes(current.session_status || '')) return null;
	return endSession({ agentId, userId });
}

async function recordModeChange(agentId, userId, from, to, req, extra = {}) {
	await recordCustodyEvent({
		agentId, userId, eventType: 'signer_mode_change', category: 'custody', reason: `${from}_to_${to}`, status: 'ok',
		meta: { from, to, ...extra },
	}).catch(() => {});
	logAudit({ userId, action: 'custody.signer_mode', resourceId: agentId, meta: { from, to, ...extra }, req });
}

async function setMode(req, agentId, principal) {
	const body = await readCustodyBody(req);
	const mode = String(body.mode || '').trim().toLowerCase();
	if (!SIGNER_MODES.includes(mode)) throw clientError('invalid_parameter', `mode must be one of ${SIGNER_MODES.join(', ')}`);
	const before = await getAgentSigner(agentId);

	if (mode === 'session') {
		const owner = await ownerKey(body, principal.userId);
		const prepared = await beginSessionGrant({ agentId, userId: principal.userId, owner, body });
		await recordModeChange(agentId, principal.userId, before.mode || 'platform', 'session_pending', req, { owner });
		return { status: 202, data: { ...(await view(agentId, principal.userId)), prepared } };
	}

	const revoke = await closeSession(agentId, principal.userId);
	if (mode === 'external') {
		const pubkey = await ownerKey(body, principal.userId);
		await writeMode(agentId, principal.userId, 'external', pubkey);
	} else {
		await writeMode(agentId, principal.userId, 'platform', null);
	}
	await recordModeChange(agentId, principal.userId, before.mode || 'platform', mode, req, { revoked_session: Boolean(revoke) });
	return { status: 200, data: { ...(await view(agentId, principal.userId)), ...(revoke ? { prepared: revoke } : {}) } };
}

async function endSessionRoute(req, agentId, principal) {
	const revoke = await endSession({ agentId, userId: principal.userId });
	if (!revoke) throw clientError('no_session', 'This agent has no session key to end.', 404);
	const current = await getAgentSigner(agentId);
	await writeMode(agentId, principal.userId, 'external', current.external_pubkey || null);
	await recordModeChange(agentId, principal.userId, 'session', 'external', req, { revoked_session: true });
	return { status: 200, data: { ...(await view(agentId, principal.userId)), prepared: revoke } };
}

export default async function handler(req, res, id, action) {
	if (cors(req, res, { methods: 'GET,PUT,DELETE,OPTIONS', credentials: true })) return;
	const isSession = action === 'session';
	if (action && !isSession) return json(res, 404, { error: 'not_found', error_description: 'unknown signer route' });
	if (!method(req, res, isSession ? ['DELETE'] : ['GET', 'PUT'])) return;

	return answerCustody(res, async () => {
		const write = req.method !== 'GET';
		const principal = await requirePrincipal(req, write ? 'wallet:write' : 'wallet:read');
		await loadOwnedAgent(id, principal.userId);
		const rl = write ? await limits.custodyWrite(principal.userId) : await limits.walletRead(principal.userId);
		if (!rl.success) return rateLimited(res, rl);
		if (write && principal.via === 'session' && !(await requireCsrf(req, res, principal.userId))) return;

		if (req.method === 'GET') return json(res, 200, { data: await view(id, principal.userId) }, { 'cache-control': 'no-store' });
		const out = isSession ? await endSessionRoute(req, id, principal) : await setMode(req, id, principal);
		return json(res, out.status, { data: out.data }, { 'cache-control': 'no-store' });
	});
}
