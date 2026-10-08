// /api/agents/:id/solana/guard — the Self-Defending Wallet control surface.
//
// Owner-only. Reads the wallet's behavioral baseline + anomaly timeline, lets the
// owner tune sensitivity / set a safe-sweep address, and provides one-tap
// adjudication of a freeze: APPROVE (unfreeze + teach the baseline so it won't
// re-trip) or DENY (keep frozen). The scoring + freeze themselves happen inline on
// the spend path (api/_lib/agent-trade-guards.js → anomaly-events.js); this
// endpoint is the owner's window into, and control over, that system.
//
// GET   → config + baseline + open flags + paginated timeline
// PUT   → update config (sensitivity | enabled | safe_address | clear_learned)   [CSRF]
// POST  → adjudicate { event_id, action: approve|deny|mark_swept } | { action: unfreeze }  [CSRF]

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { setSpendLimits, getSpendLimits, validateSolanaAddress } from '../_lib/agent-trade-guards.js';
import { SENSITIVITY_PRESETS, getAnomalyConfig } from '../_lib/wallet-anomaly.js';
import {
	listAnomalyEvents, listOpenFlags, getAnomalyEvent, setAnomalyStatus,
	loadBaselineForDisplay, saveAnomalyConfig, teachFromApproval,
} from '../_lib/anomaly-events.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return { userId: bearer.userId };
	return null;
}

async function loadOwned(req, res, id) {
	const auth = await resolveAuth(req);
	if (!auth) { error(res, 401, 'unauthorized', 'sign in required'); return { error: true }; }
	const [row] = await sql`SELECT id, user_id, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) { error(res, 404, 'not_found', 'agent not found'); return { error: true }; }
	if (row.user_id !== auth.userId) { error(res, 403, 'forbidden', 'not your agent'); return { error: true }; }
	return { auth, meta: { ...(row.meta || {}) } };
}

// Public config shape — never leak internal allowlist contents back wholesale, but
// the owner SHOULD see what's been learned so they can audit it.
function publicConfig(cfg) {
	return {
		enabled: cfg.enabled,
		sensitivity: cfg.sensitivity,
		safe_address: cfg.safe_address,
		size_ceiling_usd: cfg.size_ceiling_usd,
		extra_hours: cfg.extra_hours,
		learned_destinations: cfg.allow_destinations.length,
		updated_at: cfg.updated_at,
	};
}

function eventOut(e) {
	return {
		id: String(e.id),
		network: e.network,
		category: e.category,
		asset: e.asset,
		usd: e.usd != null ? Number(e.usd) : null,
		destination: e.destination,
		score: e.score != null ? Number(e.score) : 0,
		decision: e.decision,
		critical: !!e.critical,
		sensitivity: e.sensitivity,
		factors: Array.isArray(e.factors) ? e.factors : [],
		summary: e.summary,
		status: e.status,
		hour_utc: e.hour_utc,
		swept: !!e.swept,
		adjudicated_at: e.adjudicated_at || null,
		created_at: e.created_at,
	};
}

export async function handleGuard(req, res, id) {
	if (cors(req, res, { methods: 'GET,PUT,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'POST'])) return;

	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	const { auth, meta } = owned;

	const rl = await limits.walletRead(auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	const config = getAnomalyConfig(meta);

	// ── GET — full guard state ──────────────────────────────────────────────────
	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://x');
		const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10) || 40));
		const beforeRaw = url.searchParams.get('before');
		const beforeId = beforeRaw && /^\d+$/.test(beforeRaw) ? beforeRaw : null;

		const [baseline, flags, events] = await Promise.all([
			loadBaselineForDisplay(id, meta).catch(() => null),
			listOpenFlags(id).catch(() => []),
			listAnomalyEvents(id, { limit, beforeId }).catch(() => []),
		]);
		const spendLimits = getSpendLimits(meta);
		const items = events.map(eventOut);
		const nextCursor = items.length === limit ? items[items.length - 1].id : null;

		return json(res, 200, {
			data: {
				config: publicConfig(config),
				presets: Object.values(SENSITIVITY_PRESETS),
				frozen: spendLimits.frozen,
				baseline,
				open_flags: flags.map(eventOut),
				timeline: { items, next_cursor: nextCursor },
			},
		});
	}

	// Mutations require CSRF — disarming the guard or unfreezing a wallet is exactly
	// as sensitive as editing the spend policy.
	if (!(await requireCsrf(req, res, auth.userId))) return;

	let body;
	try {
		body = await readJson(req);
	} catch (e) {
		return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body');
	}

	// ── PUT — tune config ───────────────────────────────────────────────────────
	if (req.method === 'PUT') {
		const patch = {};
		if ('enabled' in body) patch.enabled = body.enabled === true;
		if ('sensitivity' in body) {
			if (!SENSITIVITY_PRESETS[body.sensitivity]) {
				return error(res, 400, 'invalid_sensitivity', 'sensitivity must be relaxed, balanced, or strict');
			}
			patch.sensitivity = body.sensitivity;
		}
		if ('safe_address' in body) {
			if (body.safe_address === null || body.safe_address === '') {
				patch.safe_address = null;
			} else {
				const v = validateSolanaAddress(body.safe_address);
				if (!v.valid) return error(res, 400, 'invalid_address', 'safe_address is not a valid Solana address');
				if (!v.onCurve) return error(res, 400, 'invalid_address', 'safe_address looks like a program address (PDA); funds sent there could be unrecoverable');
				patch.safe_address = v.base58;
			}
		}
		// Reset everything the guard has learned (destinations / size ceiling / hours).
		if (body.clear_learned === true) {
			patch.allow_destinations = [];
			patch.size_ceiling_usd = null;
			patch.extra_hours = [];
		}
		const next = await saveAnomalyConfig(id, meta, patch);
		return json(res, 200, { data: { config: publicConfig(next) } });
	}

	// ── POST — adjudicate ───────────────────────────────────────────────────────
	const action = typeof body.action === 'string' ? body.action : '';

	// Generic unfreeze (owner override) — not tied to a specific flag.
	if (action === 'unfreeze') {
		await setSpendLimits(id, auth.userId, { frozen: false }, { req });
		// Clear any still-open flags as approved-by-unfreeze so the UI settles.
		await sql`UPDATE agent_anomaly_events SET status = 'approved', adjudicated_by = ${auth.userId}, adjudicated_at = now() WHERE agent_id = ${id} AND status = 'flagged'`;
		return json(res, 200, { data: { frozen: false, action: 'unfreeze' } });
	}

	const eventId = body.event_id != null && /^\d+$/.test(String(body.event_id)) ? String(body.event_id) : null;
	if (!eventId) return error(res, 400, 'bad_request', 'event_id is required');
	const evt = await getAnomalyEvent(id, eventId);
	if (!evt) return error(res, 404, 'not_found', 'anomaly event not found');

	if (action === 'approve') {
		// Teach the baseline so this exact pattern won't re-trip, then unfreeze.
		const next = await teachFromApproval(id, meta, { destination: evt.destination, usd: evt.usd, hour_utc: evt.hour_utc });
		await setSpendLimits(id, auth.userId, { frozen: false }, { req });
		await setAnomalyStatus(eventId, { status: 'approved', userId: auth.userId });
		return json(res, 200, { data: { frozen: false, action: 'approve', event_id: eventId, config: publicConfig(next) } });
	}

	if (action === 'deny') {
		// Confirmed bad: keep the wallet frozen, record the verdict.
		await setAnomalyStatus(eventId, { status: 'denied', userId: auth.userId });
		return json(res, 200, { data: { frozen: getSpendLimits(meta).frozen, action: 'deny', event_id: eventId } });
	}

	if (action === 'mark_swept') {
		// The owner used one-tap "sweep to safety" (a real audited withdraw, run
		// against the standard withdraw endpoint). Record it on the flag; keep frozen.
		await setAnomalyStatus(eventId, { status: 'denied', userId: auth.userId, swept: true });
		return json(res, 200, { data: { action: 'mark_swept', event_id: eventId, swept: true } });
	}

	return error(res, 400, 'bad_request', 'action must be approve, deny, mark_swept, or unfreeze');
}

export default handleGuard;
