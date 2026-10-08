// /api/agents/:id/recovery — social recovery & inheritance for a custodial agent
// wallet. Dispatched from api/agents/[id].js with the remaining path segments.
//
// Routes (all owner/guardian-gated, all writes CSRF-protected):
//   GET    /recovery                              status: config + roster + active process + dead-man
//   PUT    /recovery                              owner: set guardians/beneficiary/threshold/dead-man
//   POST   /recovery/checkin                      owner: "I'm here" — resets dead-man, aborts inheritance
//   GET    /recovery/requests                     owner: recent request history
//   POST   /recovery/requests                     guardian/beneficiary: open a recovery
//   POST   /recovery/requests/:rid/approve        guardian: approve
//   POST   /recovery/requests/:rid/decline        guardian: decline
//   POST   /recovery/requests/:rid/confirm        guardian/beneficiary: confirm an inheritance
//   POST   /recovery/requests/:rid/cancel         owner (reject) or requester (withdraw)
//   POST   /recovery/requests/:rid/complete       finalize a ready recovery → transfer ownership
//   POST   /recovery/inheritance/arm              beneficiary/guardian: arm the dead-man once eligible

import { getSessionUser, authenticateBearer, extractBearer, assertBearerMaySpend } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import {
	getRecoveryConfig, effectiveThreshold, listGuardians, setGuardiansAndConfig,
	getOwnerActivity, deadManStatus, getActiveRequest, decorateRequest, listRequests,
	createRecoveryRequest, recordVote, cancelRequest, completeIfReady, ownerCheckIn,
	armInheritance, confirmInheritance, resolveUserHandle, isUuid, MAX_GUARDIANS,
} from '../_lib/agent-recovery.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return { userId: bearer.userId };
	return null;
}

function sendErr(res, e) {
	if (e && e.status) return error(res, e.status, e.code || 'error', e.message, e.detail ? { detail: e.detail } : undefined);
	console.error('[recovery] unexpected error', e?.message, e?.stack);
	return error(res, 500, 'server_error', 'something went wrong — no ownership was changed');
}

// Load the agent + the caller's relationship to it (owner / guardian / beneficiary).
async function loadContext(req, res, id) {
	const auth = await resolveAuth(req);
	if (!auth) { error(res, 401, 'unauthorized', 'sign in required'); return null; }
	const [agent] = await sql`SELECT id, user_id, name, meta, avatar_id, avatar_url FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!agent) { error(res, 404, 'not_found', 'agent not found'); return null; }
	const roles = await sql`SELECT role FROM agent_recovery_guardians WHERE agent_id = ${id} AND guardian_user_id = ${auth.userId} AND status = 'active'`;
	const roleSet = new Set(roles.map((r) => r.role));
	return {
		auth, agent,
		isOwner: agent.user_id === auth.userId,
		isGuardian: roleSet.has('guardian'),
		isBeneficiary: roleSet.has('beneficiary'),
		roleSet,
	};
}

// ── GET /recovery — status ─────────────────────────────────────────────────────
async function handleGetStatus(req, res, id, ctx) {
	const rl = await limits.walletRead(ctx.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	const { agent, isOwner, isGuardian, isBeneficiary } = ctx;
	// Only parties to the recovery graph (owner / guardian / beneficiary) may read.
	if (!isOwner && !isGuardian && !isBeneficiary) {
		return error(res, 403, 'forbidden', 'you are not part of this agent’s recovery circle');
	}

	const config = getRecoveryConfig(agent.meta);
	const guardians = await listGuardians(id);
	const guardianCount = guardians.filter((g) => g.role === 'guardian').length;
	const beneficiary = guardians.find((g) => g.role === 'beneficiary') || null;
	const activeRaw = await getActiveRequest(id);
	const active = activeRaw ? await decorateRequest(activeRaw, id) : null;

	// Dead-man status is computed from the owner's real activity — owner sees the
	// full picture; guardians/beneficiary see a redacted "is it armed" view.
	let deadMan = null;
	if (isOwner) {
		const { lastActiveAt, signals } = await getOwnerActivity(id, agent.user_id, agent.meta);
		deadMan = { ...deadManStatus(config, lastActiveAt), signals };
	} else {
		deadMan = { enabled: config.dead_man.enabled, inactivity_days: config.dead_man.inactivity_days, grace_days: config.dead_man.grace_days };
	}

	return json(res, 200, {
		data: {
			agent: { id: agent.id, name: agent.name, avatar_url: agent.avatar_url || null },
			viewer: { is_owner: isOwner, is_guardian: isGuardian, is_beneficiary: isBeneficiary, user_id: ctx.auth.userId },
			config: {
				threshold: config.threshold,
				effective_threshold: effectiveThreshold(config, guardianCount),
				dead_man: config.dead_man,
			},
			guardians: isOwner ? guardians : guardians.map((g) => ({ role: g.role, label: g.label, avatar_url: g.avatar_url, is_you: g.user_id === ctx.auth.userId })),
			guardian_count: guardianCount,
			beneficiary: beneficiary ? { label: beneficiary.label, avatar_url: beneficiary.avatar_url, is_you: beneficiary.user_id === ctx.auth.userId } : null,
			dead_man: deadMan,
			active_request: active,
			max_guardians: MAX_GUARDIANS,
		},
	});
}

// ── PUT /recovery — owner sets the circle ──────────────────────────────────────
async function handleSetConfig(req, res, id, ctx) {
	if (!ctx.isOwner) return error(res, 403, 'forbidden', 'only the owner can configure recovery');
	if (!(await requireCsrf(req, res, ctx.auth.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid body'); }

	// Resolve guardian + beneficiary handles → user ids. A bad handle is a clean
	// 400 with the offending value, never a silent drop.
	const guardianHandles = Array.isArray(body.guardians) ? body.guardians : [];
	if (guardianHandles.length > MAX_GUARDIANS) return error(res, 400, 'too_many_guardians', `at most ${MAX_GUARDIANS} guardians`);

	const guardianIds = [];
	const seen = new Set();
	for (const h of guardianHandles) {
		const u = await resolveUserHandle(h);
		if (!u) return error(res, 400, 'unknown_guardian', `no three.ws account found for “${String(h).slice(0, 60)}”`);
		if (u.id === ctx.auth.userId) return error(res, 400, 'self_guardian', 'you cannot be your own guardian');
		if (seen.has(u.id)) continue;
		seen.add(u.id);
		guardianIds.push(u.id);
	}

	let beneficiaryId = null;
	if (body.beneficiary) {
		const u = await resolveUserHandle(body.beneficiary);
		if (!u) return error(res, 400, 'unknown_beneficiary', `no three.ws account found for “${String(body.beneficiary).slice(0, 60)}”`);
		if (u.id === ctx.auth.userId) return error(res, 400, 'self_beneficiary', 'you cannot be your own beneficiary');
		beneficiaryId = u.id;
	}

	let threshold = undefined;
	if (body.threshold != null) {
		const t = Math.round(Number(body.threshold));
		if (!Number.isFinite(t) || t < 1) return error(res, 400, 'bad_threshold', 'threshold must be at least 1');
		if (t > guardianIds.length) return error(res, 400, 'bad_threshold', `threshold (${t}) cannot exceed the number of guardians (${guardianIds.length})`);
		threshold = t;
	}

	let deadMan = undefined;
	if (body.dead_man && typeof body.dead_man === 'object') {
		if (body.dead_man.enabled === true && !beneficiaryId) {
			return error(res, 400, 'dead_man_needs_beneficiary', 'the dead-man’s switch needs a beneficiary to inherit the agent');
		}
		deadMan = body.dead_man;
	}

	try {
		const result = await setGuardiansAndConfig({
			agentId: id, ownerId: ctx.auth.userId, guardianIds, beneficiaryId, threshold, deadMan, meta: ctx.agent.meta, req,
		});
		return json(res, 200, { data: { guardians: result.guardians, config: getRecoveryConfig({ recovery: result.config }) } });
	} catch (e) { return sendErr(res, e); }
}

// ── POST /recovery/checkin ─────────────────────────────────────────────────────
async function handleCheckin(req, res, id, ctx) {
	if (!ctx.isOwner) return error(res, 403, 'forbidden', 'only the owner can check in');
	if (!(await requireCsrf(req, res, ctx.auth.userId))) return;
	try {
		const r = await ownerCheckIn({ agentId: id, ownerId: ctx.auth.userId, req });
		return json(res, 200, { data: r });
	} catch (e) { return sendErr(res, e); }
}

// ── /recovery/requests ─────────────────────────────────────────────────────────
async function handleRequests(req, res, id, ctx, parts) {
	const rid = parts[5];
	const verb = parts[6];

	// POST /recovery/requests — open a recovery
	if (!rid) {
		if (req.method === 'GET') {
			if (!ctx.isOwner) return error(res, 403, 'forbidden', 'only the owner can list recovery history');
			const rl = await limits.auditLogRead(ctx.auth.userId);
			if (!rl.success) return rateLimited(res, rl);
			const items = await listRequests(id);
			return json(res, 200, { data: { items } });
		}
		if (!method(req, res, ['GET', 'POST'])) return;
		if (!(await requireCsrf(req, res, ctx.auth.userId))) return;
		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		let body = {};
		try { body = await readJson(req); } catch { body = {}; }
		try {
			const reqOut = await createRecoveryRequest({ agentId: id, requesterId: ctx.auth.userId, reason: body.reason, req });
			return json(res, 201, { data: reqOut });
		} catch (e) { return sendErr(res, e); }
	}

	if (!isUuid(rid)) return error(res, 404, 'not_found', 'recovery request not found');
	if (!method(req, res, ['POST'])) return;
	if (!(await requireCsrf(req, res, ctx.auth.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	try {
		if (verb === 'approve' || verb === 'decline') {
			const out = await recordVote({ agentId: id, requestId: rid, guardianId: ctx.auth.userId, decision: verb, req });
			return json(res, 200, { data: out });
		}
		if (verb === 'confirm') {
			const out = await confirmInheritance({ agentId: id, requestId: rid, actorId: ctx.auth.userId, req });
			return json(res, 200, { data: out });
		}
		if (verb === 'cancel') {
			// Owner cancelling = reject (the canonical "I'm here" abort). Requester
			// cancelling = withdraw. Anyone else may not cancel.
			const [reqRow] = await sql`SELECT requester_id FROM agent_recovery_requests WHERE id = ${rid} AND agent_id = ${id}`;
			if (!reqRow) return error(res, 404, 'not_found', 'recovery request not found');
			const byOwner = ctx.isOwner;
			const isRequester = reqRow.requester_id === ctx.auth.userId;
			if (!byOwner && !isRequester) return error(res, 403, 'forbidden', 'only the owner or the requester can cancel this');
			const out = await cancelRequest({ agentId: id, requestId: rid, actorId: ctx.auth.userId, byOwner, req });
			return json(res, 200, { data: out });
		}
		if (verb === 'complete') {
			// Completing transfers funds-control: must be the requester, the nominee,
			// or a guardian (anyone in the circle who can push the ready request over
			// the line). Server re-verifies readiness regardless of who calls.
			if (!ctx.isOwner && !ctx.isGuardian && !ctx.isBeneficiary) {
				const [reqRow] = await sql`SELECT requester_id, new_owner_id FROM agent_recovery_requests WHERE id = ${rid} AND agent_id = ${id}`;
				if (!reqRow || (reqRow.requester_id !== ctx.auth.userId && reqRow.new_owner_id !== ctx.auth.userId)) {
					return error(res, 403, 'forbidden', 'you are not part of this recovery');
				}
			}
			const out = await completeIfReady({ agentId: id, requestId: rid, actorId: ctx.auth.userId, req });
			return json(res, 200, { data: out });
		}
		return error(res, 404, 'not_found', 'unknown recovery action');
	} catch (e) { return sendErr(res, e); }
}

// ── POST /recovery/inheritance/arm ─────────────────────────────────────────────
async function handleInheritance(req, res, id, ctx, parts) {
	const verb = parts[5];
	if (verb !== 'arm') return error(res, 404, 'not_found', 'unknown inheritance action');
	if (!method(req, res, ['POST'])) return;
	// Only the beneficiary or a guardian may manually arm.
	if (!ctx.isGuardian && !ctx.isBeneficiary) return error(res, 403, 'forbidden', 'only a guardian or the beneficiary can arm inheritance');
	if (!(await requireCsrf(req, res, ctx.auth.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	try {
		const out = await armInheritance({ agentId: id, actorId: ctx.auth.userId, req });
		if (!out) return error(res, 409, 'not_eligible', 'inheritance can’t be armed yet — the owner is still active, there’s no beneficiary, or a process is already running');
		return json(res, 201, { data: out });
	} catch (e) { return sendErr(res, e); }
}

// ── dispatcher ─────────────────────────────────────────────────────────────────
export default async function handler(req, res, id, action, parts) {
	if (cors(req, res, { methods: 'GET,POST,PUT,OPTIONS', credentials: true })) return;

	const ctx = await loadContext(req, res, id);
	if (!ctx) return; // loadContext already sent the error

	// /recovery (no further segment) — config get/set
	if (!action) {
		if (req.method === 'GET') return handleGetStatus(req, res, id, ctx);
		if (req.method === 'PUT') return handleSetConfig(req, res, id, ctx);
		return method(req, res, ['GET', 'PUT']);
	}
	if (action === 'checkin') {
		if (!method(req, res, ['POST'])) return;
		return handleCheckin(req, res, id, ctx);
	}
	if (action === 'requests') return handleRequests(req, res, id, ctx, parts);
	if (action === 'inheritance') return handleInheritance(req, res, id, ctx, parts);
	return error(res, 404, 'not_found', 'unknown recovery resource');
}
