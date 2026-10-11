// Per-agent token budgets: an hourly ceiling, a daily ceiling and a per-run
// ceiling on the tokens an agent's model calls may consume, enforced BEFORE the
// model is called, next to the dollar budget in inference-billing.js.
//
// How a call gets through:
//   1. assertTokenBudget reserves a quantum (the caller's estimate, else 1 token)
//      in every capped window with one conditional upsert per window
//      (tokens + reserved + quantum <= ceiling). Two calls racing for the last
//      token serialize on the row lock and exactly one is admitted.
//   2. The call runs.
//   3. settleTokenUsage books the real token count, releases the quantum, and
//      walks the 50 / 80 / 100 percent marks: 50 and 80 notify once per window
//      (spend_cap_alert), 100 pauses the agent (token_budget_paused).
//
// A refusal pauses the agent exactly once per window: the pause is stamped on
// agent_identities.meta.token_budget.paused, the agent's status flips to
// 'stopped' and its autopilot off, the owner is notified, and one "extend once"
// approval is opened (source 'token_budget', venue 'token_budget', never
// auto-approved). Approving it raises that window's ceiling by the extension
// and resumes the agent; a second extension for the same window is refused.
// The owner can also resume by hand (resumeTokenBudget), which succeeds only
// when capacity exists again, so a resume never readmits a call that the next
// gate would refuse.
//
// Storage: ceilings, pause, extensions and alert latches on
// agent_identities.meta.token_budget and meta.spend_alerts; counters in
// agent_token_usage (migration 20261010173000_agent_token_budgets.sql).
// Schema of meta.token_budget:
//   { hourly_tokens, daily_tokens, per_run_tokens, updated_at,
//     paused: { window, key, at, limit, used, approval_id, stopped_agent },
//     extensions: { [window]: { key, extra_tokens, approval_id, at } } }
// Schema of meta.spend_alerts: { [cap]: { key, sent: [50, 80], at } } where cap
// is 'tokens:hour' | 'tokens:day' | 'tokens:run' | 'usd:daily' | 'usd:monthly'.

import { sql } from './db.js';
import { insertNotification } from './notify.js';
import { logAudit } from './audit.js';

export const TOKEN_WINDOWS = Object.freeze(['hour', 'day', 'run']);
export const TOKEN_BUDGET_FIELDS = Object.freeze({ hour: 'hourly_tokens', day: 'daily_tokens', run: 'per_run_tokens' });
export const ALERT_THRESHOLDS = Object.freeze([50, 80]);
export const MAX_TOKENS_PER_CAP = 1_000_000_000;
export const MIN_EXTENSION_TOKENS = 1_000;
const RUN_WINDOW_TTL_MS = 6 * 60 * 60 * 1000;

export class TokenBudgetError extends Error {
	constructor(status, code, message, detail = {}) {
		super(message);
		this.name = 'TokenBudgetError';
		this.status = status;
		this.code = code;
		this.detail = detail;
		this.expose = true;
	}
}

// ── caps ──────────────────────────────────────────────────────────────────────

function capValue(v, field) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0 || n !== Math.floor(n)) {
		throw new TokenBudgetError(400, 'invalid_token_budget', `tokenBudget.${field} must be a whole number of tokens greater than zero, or null for no cap.`);
	}
	if (n > MAX_TOKENS_PER_CAP) {
		throw new TokenBudgetError(400, 'invalid_token_budget', `tokenBudget.${field} cannot exceed ${MAX_TOKENS_PER_CAP.toLocaleString('en-US')} tokens.`);
	}
	return n;
}

/**
 * Validate an owner-supplied cap object. `null` clears every cap. Accepts the
 * API field names (hourly / daily / per_run) and the stored ones.
 * @returns {{ hourly_tokens: number|null, daily_tokens: number|null, per_run_tokens: number|null }|null}
 */
export function normalizeTokenBudget(raw) {
	if (raw === null) return null;
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		throw new TokenBudgetError(400, 'invalid_token_budget', 'tokenBudget must be an object like { hourly: 50000, daily: 500000, per_run: 20000 }, or null.');
	}
	const out = {
		hourly_tokens: capValue(raw.hourly ?? raw.hourly_tokens, 'hourly'),
		daily_tokens: capValue(raw.daily ?? raw.daily_tokens, 'daily'),
		per_run_tokens: capValue(raw.per_run ?? raw.per_run_tokens ?? raw.perRun, 'per_run'),
	};
	if (out.hourly_tokens != null && out.daily_tokens != null && out.hourly_tokens > out.daily_tokens) {
		throw new TokenBudgetError(400, 'invalid_token_budget', 'tokenBudget.hourly cannot exceed tokenBudget.daily.');
	}
	if (out.hourly_tokens == null && out.daily_tokens == null && out.per_run_tokens == null) return null;
	return out;
}

/** The stored token budget on an agent's meta, or null when the agent has no cap. */
export function getTokenBudget(meta) {
	const b = meta?.token_budget;
	if (!b || typeof b !== 'object') return null;
	const caps = {
		hourly_tokens: Number.isFinite(Number(b.hourly_tokens)) && b.hourly_tokens > 0 ? Number(b.hourly_tokens) : null,
		daily_tokens: Number.isFinite(Number(b.daily_tokens)) && b.daily_tokens > 0 ? Number(b.daily_tokens) : null,
		per_run_tokens: Number.isFinite(Number(b.per_run_tokens)) && b.per_run_tokens > 0 ? Number(b.per_run_tokens) : null,
	};
	if (caps.hourly_tokens == null && caps.daily_tokens == null && caps.per_run_tokens == null) return null;
	return {
		...caps,
		updated_at: b.updated_at || null,
		paused: b.paused && typeof b.paused === 'object' ? b.paused : null,
		extensions: b.extensions && typeof b.extensions === 'object' ? b.extensions : {},
	};
}

export function capFor(budget, window) {
	return budget?.[TOKEN_BUDGET_FIELDS[window]] ?? null;
}

/** The window's key at `now`: the UTC hour, the UTC day, or the run id. */
export function tokenWindowKey(window, { now = new Date(), runId = null } = {}) {
	if (window === 'run') return runId ? String(runId) : null;
	const iso = now.toISOString();
	return window === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}

/** When the window rolls over (null for a run, which ends when the run does). */
export function nextTokenReset(window, now = new Date()) {
	if (window === 'hour') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1)).toISOString();
	if (window === 'day') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
	return null;
}

/** The ceiling in force for a window: its cap plus a granted extension for this same key. */
export function ceilingFor(budget, window, key) {
	const cap = capFor(budget, window);
	if (cap == null) return null;
	const ext = budget.extensions?.[window];
	const extra = ext && ext.key === key ? Number(ext.extra_tokens) || 0 : 0;
	return cap + extra;
}

/** The default size of a one-time extension: half the cap, never under MIN_EXTENSION_TOKENS. */
export function defaultExtensionTokens(cap) {
	return Math.max(MIN_EXTENSION_TOKENS, Math.ceil(Number(cap) / 2));
}

function windowsOf(budget, { now = new Date(), runId = null } = {}) {
	const out = [];
	for (const window of TOKEN_WINDOWS) {
		const cap = capFor(budget, window);
		if (cap == null) continue;
		const key = tokenWindowKey(window, { now, runId });
		if (!key) continue;
		out.push({ window, key, cap, ceiling: ceilingFor(budget, window, key), resets_at: nextTokenReset(window, now) });
	}
	return out;
}

function windowLabel(window) {
	return window === 'hour' ? 'hourly' : window === 'day' ? 'daily' : 'per-run';
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// ── counters ───────────────────────────────────────────────────────────────────

/**
 * Reserve `quantum` tokens in one window if the ceiling allows it. One
 * statement, so concurrent reservations serialize on the row and the ceiling
 * is never crossed by two admits that each saw room.
 * @returns {Promise<{ tokens: number, reserved: number }|null>} null when refused
 */
export async function reserveTokens({ agentId, window, key, ceiling, quantum }) {
	if (quantum > ceiling) return null;
	const rows = await sql`
		INSERT INTO agent_token_usage (agent_id, "window", window_key, tokens, reserved, calls)
		VALUES (${agentId}, ${window}, ${key}, 0, ${quantum}, 0)
		ON CONFLICT (agent_id, "window", window_key) DO UPDATE
		SET reserved = agent_token_usage.reserved + ${quantum}, updated_at = now()
		WHERE agent_token_usage.tokens + agent_token_usage.reserved + ${quantum} <= ${ceiling}
		RETURNING tokens, reserved
	`;
	const row = rows[0];
	return row ? { tokens: Number(row.tokens), reserved: Number(row.reserved) } : null;
}

/** Hand a reservation back (a call that never reached the model). */
export async function releaseTokens({ agentId, window, key, quantum }) {
	await sql`
		UPDATE agent_token_usage
		SET reserved = GREATEST(reserved - ${quantum}, 0), updated_at = now()
		WHERE agent_id = ${agentId} AND "window" = ${window} AND window_key = ${key}
	`;
}

async function usageRow(agentId, window, key) {
	const [row] = await sql`
		SELECT tokens, reserved, calls FROM agent_token_usage
		WHERE agent_id = ${agentId} AND "window" = ${window} AND window_key = ${key}
	`;
	return { tokens: Number(row?.tokens || 0), reserved: Number(row?.reserved || 0), calls: Number(row?.calls || 0) };
}

// ── the gate ───────────────────────────────────────────────────────────────────

function refusal(agent, w, used, { paused = false, approvalId = null } = {}) {
	const label = windowLabel(w.window);
	const extendPath = `/api/agents/${agent.id}/token-budget/extend`;
	return new TokenBudgetError(
		429,
		paused ? 'token_budget_paused' : 'token_budget_exhausted',
		paused
			? `${agent.name || 'This agent'} is paused: it reached its ${label} token ceiling (${fmt(used)} of ${fmt(w.ceiling)} tokens). Resume it with POST /api/agents/${agent.id}/token-budget/resume, extend the ceiling once with POST ${extendPath}, or raise it with PUT /api/agents/${agent.id}/token-budget.`
			: `${agent.name || 'This agent'} reached its ${label} token ceiling (${fmt(used)} of ${fmt(w.ceiling)} tokens) and was paused. Extend the ceiling once with POST ${extendPath}, raise it with PUT /api/agents/${agent.id}/token-budget, or wait for the window to reset.`,
		{
			agent_id: agent.id,
			window: w.window,
			window_key: w.key,
			limit_tokens: w.cap,
			ceiling_tokens: w.ceiling,
			used_tokens: used,
			resets_at: w.resets_at,
			retry_after_seconds: w.resets_at ? Math.max(1, Math.ceil((new Date(w.resets_at).getTime() - Date.now()) / 1000)) : null,
			approval_id: approvalId,
			recover: {
				resume: { method: 'POST', path: `/api/agents/${agent.id}/token-budget/resume` },
				extend_once: { method: 'POST', path: extendPath, body: { window: w.window, extra_tokens: defaultExtensionTokens(w.cap) }, approval_id: approvalId },
				raise: { method: 'PUT', path: `/api/agents/${agent.id}/token-budget`, body: { [TOKEN_BUDGET_FIELDS[w.window]]: w.cap * 2 } },
				spend_page: `/spend?agent=${agent.id}`,
			},
		},
	);
}

/**
 * Refuse a model call that would cross one of the agent's token ceilings, else
 * reserve the caller's estimate (default 1 token) in every capped window.
 *
 * @param {{ userId: string, agent: { id: string, name?: string, meta?: object }|null, runId?: string|null, expectedTokens?: number }} p
 * @returns {Promise<{ budget: object|null, reservation: { quantum: number, windows: Array<{window: string, key: string}> }|null }>}
 * @throws {TokenBudgetError} 429 token_budget_exhausted | token_budget_paused
 */
export async function assertTokenBudget({ userId, agent = null, runId = null, expectedTokens = 0 }) {
	const budget = getTokenBudget(agent?.meta);
	if (!budget) return { budget: null, reservation: null };
	const now = new Date();
	const windows = windowsOf(budget, { now, runId });

	if (budget.paused) {
		const p = budget.paused;
		const live = windows.find((w) => w.window === p.window);
		// A pause whose window has rolled over clears itself: the owner asked
		// for a ceiling per hour or day, not a permanent stop.
		if (live && live.key === p.key) {
			const used = (await usageRow(agent.id, p.window, p.key)).tokens;
			throw refusal(agent, live, used, { paused: true, approvalId: p.approval_id || null });
		}
		if (live || p.window === 'run') await clearPause(agent.id, p);
	}

	const quantum = Math.max(1, Math.floor(Number(expectedTokens) || 0));
	const held = [];
	for (const w of windows) {
		const r = await reserveTokens({ agentId: agent.id, window: w.window, key: w.key, ceiling: w.ceiling, quantum });
		if (r) {
			held.push({ window: w.window, key: w.key });
			continue;
		}
		for (const h of held) await releaseTokens({ agentId: agent.id, window: h.window, key: h.key, quantum });
		const used = (await usageRow(agent.id, w.window, w.key)).tokens;
		const { approvalId } = await pauseForTokenBudget({ agent, userId, window: w, used });
		throw refusal(agent, w, used, { approvalId });
	}
	return { budget, reservation: { quantum, windows: held } };
}

/** Release an earlier reservation when the call never reached the model. */
export async function releaseTokenReservation(agentId, reservation) {
	if (!reservation?.windows?.length) return;
	for (const h of reservation.windows) {
		await releaseTokens({ agentId, window: h.window, key: h.key, quantum: reservation.quantum }).catch(() => {});
	}
}

// ── settlement + alerts ────────────────────────────────────────────────────────

/**
 * Book a finished call's real token count in every capped window, release its
 * reservation, and raise the 50 / 80 / 100 percent marks. Safe to call for an
 * agent with no token budget (a no-op) and never throws: billing already
 * happened, so a counter problem is logged, not surfaced.
 */
export async function settleTokenUsage({ agentId, runId = null, inputTokens = 0, outputTokens = 0, reservedTokens = 1 }) {
	if (!agentId) return null;
	try {
		const [agent] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} LIMIT 1`;
		const budget = getTokenBudget(agent?.meta);
		if (!budget) return null;
		const tokens = Math.max(0, Math.floor(Number(inputTokens) || 0) + Math.floor(Number(outputTokens) || 0));
		const quantum = Math.max(0, Math.floor(Number(reservedTokens) || 0));
		const out = [];
		for (const w of windowsOf(budget, { runId })) {
			const [row] = await sql`
				INSERT INTO agent_token_usage (agent_id, "window", window_key, tokens, reserved, calls)
				VALUES (${agentId}, ${w.window}, ${w.key}, ${tokens}, 0, 1)
				ON CONFLICT (agent_id, "window", window_key) DO UPDATE
				SET tokens = agent_token_usage.tokens + ${tokens},
				    reserved = GREATEST(agent_token_usage.reserved - ${quantum}, 0),
				    calls = agent_token_usage.calls + 1,
				    updated_at = now()
				RETURNING tokens
			`;
			const used = Number(row?.tokens || 0);
			out.push({ window: w.window, key: w.key, used, ceiling: w.ceiling });
			await raiseTokenMarks({ agent, userId: agent.user_id, w, used });
		}
		return out;
	} catch (err) {
		console.warn('[token-budgets] settle failed', err?.message);
		return null;
	}
}

async function raiseTokenMarks({ agent, userId, w, used }) {
	const pct = w.ceiling > 0 ? (used / w.ceiling) * 100 : 0;
	if (pct >= 100) {
		await pauseForTokenBudget({ agent, userId, window: w, used });
		return;
	}
	await notifyCapMarks({ agent, userId, cap: `tokens:${w.window}`, key: w.key, pct, limit: w.ceiling, used, unit: 'tokens', window: w.window, resetsAt: w.resets_at });
}

/**
 * Record that `threshold` percent of `cap` was crossed for window `key`, exactly
 * once: the latch lives on meta.spend_alerts[cap] and resets when the key moves.
 * @returns {Promise<boolean>} true the first time, false on every repeat
 */
export async function latchSpendAlert({ agentId, cap, key, threshold }) {
	const path = `spend_alerts.${cap}`;
	const at = new Date().toISOString();
	const rows = await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(
			COALESCE(meta, '{}'::jsonb) || jsonb_build_object('spend_alerts', COALESCE(meta -> 'spend_alerts', '{}'::jsonb)),
			string_to_array(${path}, '.'),
			jsonb_build_object(
				'key', ${key}::text,
				'at', ${at}::text,
				'sent', CASE
					WHEN COALESCE(meta #>> string_to_array(${path + '.key'}, '.'), '') = ${key}
					THEN COALESCE(meta #> string_to_array(${path + '.sent'}, '.'), '[]'::jsonb) || to_jsonb(${threshold}::int)
					ELSE jsonb_build_array(${threshold}::int)
				END
			),
			true
		), updated_at = now()
		WHERE id = ${agentId}
		  AND NOT (
			COALESCE(meta #>> string_to_array(${path + '.key'}, '.'), '') = ${key}
			AND COALESCE(meta #> string_to_array(${path + '.sent'}, '.'), '[]'::jsonb) @> to_jsonb(${threshold}::int)
		  )
		RETURNING id
	`;
	return rows.length > 0;
}

/**
 * Notify the owner once per window for every threshold `pct` has crossed,
 * collapsing a jump over several marks into one message for the highest.
 */
export async function notifyCapMarks({ agent, userId, cap, key, pct, limit, used, unit, window, resetsAt = null }) {
	let highest = null;
	for (const t of ALERT_THRESHOLDS) {
		if (pct < t) continue;
		if (await latchSpendAlert({ agentId: agent.id, cap, key, threshold: t })) highest = t;
	}
	if (highest == null) return null;
	const kind = cap.startsWith('usd:') ? 'usd' : 'tokens';
	await insertNotification(userId, 'spend_cap_alert', {
		agent_id: agent.id,
		agent_name: agent.name || null,
		cap: kind,
		window,
		threshold: highest,
		pct: Math.round(pct),
		limit,
		used: kind === 'usd' ? Math.round(used * 1e6) / 1e6 : used,
		unit,
		resets_at: resetsAt,
		link: `/spend?agent=${agent.id}`,
	}).catch((e) => console.warn('[token-budgets] alert notify failed', e?.message));
	logAudit({ userId, action: 'spend_cap_alert', resourceId: agent.id, meta: { cap, window, threshold: highest, pct: Math.round(pct), limit, used } });
	return highest;
}

/**
 * The dollar caps' 50 and 80 percent marks, fired after a charge lands. The
 * 100 percent mark for dollars is the existing inference_budget_exhausted
 * refusal, so this never duplicates it.
 */
export async function usdCapAlerts({ userId, agentId }) {
	if (!agentId) return;
	try {
		const { getInferenceBudget, agentInferenceSpend, windowKeys } = await import('./inference-billing.js');
		const [agent] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} LIMIT 1`;
		const budget = getInferenceBudget(agent?.meta);
		if (!budget) return;
		const spend = await agentInferenceSpend(agentId);
		const keys = windowKeys();
		const checks = [
			{ window: 'daily', limit: budget.daily_usd, used: spend.today_usd, key: keys.day },
			{ window: 'monthly', limit: budget.monthly_usd, used: spend.month_usd, key: keys.month },
		];
		for (const c of checks) {
			if (c.limit == null || !(c.limit > 0)) continue;
			const pct = (c.used / c.limit) * 100;
			if (pct >= 100) continue;
			await notifyCapMarks({ agent, userId: userId || agent.user_id, cap: `usd:${c.window}`, key: c.key, pct, limit: c.limit, used: c.used, unit: 'usd', window: c.window });
		}
	} catch (err) {
		console.warn('[token-budgets] usd cap alerts failed', err?.message);
	}
}

// ── pause, resume, extend ──────────────────────────────────────────────────────

async function stopAgent(agentId) {
	try {
		await sql`
			UPDATE agent_identities
			SET status = 'stopped', status_changed_at = now(),
			    meta = jsonb_set(meta, '{token_budget,paused,stopped_agent}', 'true'::jsonb, true)
			WHERE id = ${agentId} AND status = 'running'
		`;
		return true;
	} catch (err) {
		if (err?.code === '42703') return false;
		throw err;
	}
}

async function setRunning(agentId) {
	try {
		const rows = await sql`
			UPDATE agent_identities SET status = 'running', status_changed_at = now(), updated_at = now()
			WHERE id = ${agentId} AND status = 'stopped' RETURNING id
		`;
		return rows.length > 0;
	} catch (err) {
		if (err?.code === '42703') return false;
		throw err;
	}
}

async function clearPause(agentId, paused) {
	await sql`
		UPDATE agent_identities
		SET meta = COALESCE(meta, '{}'::jsonb) #- '{token_budget,paused}', updated_at = now()
		WHERE id = ${agentId} AND COALESCE(meta #>> '{token_budget,paused,key}', '') = ${String(paused?.key || '')}
	`;
	if (paused?.stopped_agent) await setRunning(agentId);
}

function extensionTtlMs(w) {
	if (!w.resets_at) return RUN_WINDOW_TTL_MS;
	return Math.max(60_000, new Date(w.resets_at).getTime() - Date.now());
}

/**
 * The once-per-window pause: stamp it, stop the agent, open the extend-once
 * approval, notify the owner. A repeat for the same window changes nothing.
 * @returns {Promise<{ paused: boolean, approvalId: string|null }>}
 */
export async function pauseForTokenBudget({ agent, userId, window: w, used }) {
	const stamp = { window: w.window, key: w.key, at: new Date().toISOString(), limit: w.cap, ceiling: w.ceiling, used, approval_id: null, stopped_agent: false };
	const [won] = await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(
			jsonb_set(COALESCE(meta, '{}'::jsonb), '{token_budget,paused}', ${JSON.stringify(stamp)}::jsonb, true),
			'{autopilot,enabled}', 'false'::jsonb, COALESCE(meta ? 'autopilot', false)
		), updated_at = now()
		WHERE id = ${agent.id} AND meta ? 'token_budget'
		  AND NOT (COALESCE(meta #>> '{token_budget,paused,window}', '') = ${w.window} AND COALESCE(meta #>> '{token_budget,paused,key}', '') = ${w.key})
		RETURNING id
	`;
	if (!won) {
		const [row] = await sql`SELECT meta #>> '{token_budget,paused,approval_id}' AS approval_id FROM agent_identities WHERE id = ${agent.id}`;
		return { paused: false, approvalId: row?.approval_id || null };
	}
	const stopped = await stopAgent(agent.id);
	const ownerId = userId || agent.user_id;
	const approval = await openExtensionApproval({ agent, userId: ownerId, w, used }).catch((e) => {
		console.warn('[token-budgets] extension approval failed', e?.message);
		return null;
	});
	const approvalId = approval?.request?.id || null;
	if (approvalId) {
		await sql`
			UPDATE agent_identities SET meta = jsonb_set(meta, '{token_budget,paused,approval_id}', ${JSON.stringify(approvalId)}::jsonb, true)
			WHERE id = ${agent.id} AND COALESCE(meta #>> '{token_budget,paused,key}', '') = ${w.key}
		`;
	}
	await latchSpendAlert({ agentId: agent.id, cap: `tokens:${w.window}`, key: w.key, threshold: 100 });
	await insertNotification(ownerId, 'token_budget_paused', {
		agent_id: agent.id,
		agent_name: agent.name || null,
		window: w.window,
		limit_tokens: w.cap,
		ceiling_tokens: w.ceiling,
		used_tokens: used,
		resets_at: w.resets_at,
		automations_stopped: stopped,
		approval_id: approvalId,
		link: `/spend?agent=${agent.id}`,
	}).catch((e) => console.warn('[token-budgets] pause notify failed', e?.message));
	logAudit({ userId: ownerId, action: 'token_budget_paused', resourceId: agent.id, meta: { window: w.window, key: w.key, limit: w.cap, ceiling: w.ceiling, used, approval_id: approvalId } });
	return { paused: true, approvalId };
}

async function openExtensionApproval({ agent, userId, w, used, extraTokens = null, deliver = true }) {
	const { createApprovalRequest } = await import('./approvals.js');
	const extra = Math.max(MIN_EXTENSION_TOKENS, Math.floor(Number(extraTokens) || defaultExtensionTokens(w.cap)));
	const label = windowLabel(w.window);
	return createApprovalRequest({
		userId,
		agentId: agent.id,
		requesterRole: 'agent',
		source: 'token_budget',
		sourceRef: `${agent.id}:${w.window}:${w.key}`,
		actionType: 'token_budget_extend',
		venue: 'token_budget',
		payload: { agent_id: agent.id, window: w.window, window_key: w.key, extra_tokens: extra, cap_tokens: w.cap },
		summary: `${agent.name || 'Your agent'} reached its ${label} token ceiling (${fmt(used)} of ${fmt(w.ceiling)} tokens). Extend it once by ${fmt(extra)} tokens for this ${w.window === 'run' ? 'run' : w.window}?`,
		amount: extra,
		asset: 'tokens',
		chain: 'none',
		network: 'none',
		recipientLabel: agent.name || 'Agent',
		riskNotes: ['Model calls admitted by the extension still bill credits at the usual rate.', 'The extension applies to this window only and cannot be granted twice.'],
		gateReason: `token ceiling: ${label}`,
		idempotencyKey: `token_budget:${agent.id}:${w.window}:${w.key}`,
		ttlMs: extensionTtlMs(w),
		autoApprovable: false,
		deliver,
	});
}

/**
 * Apply an approved extension: raise the window's ceiling once and resume the
 * agent. Executor for approval source 'token_budget' (api/_lib/approvals.js).
 */
export async function executeTokenBudgetExtension(row) {
	const p = row?.payload || {};
	const window = String(p.window || '');
	const key = String(p.window_key || '');
	const extra = Math.floor(Number(p.extra_tokens) || 0);
	if (!TOKEN_WINDOWS.includes(window) || !key || extra <= 0 || !p.agent_id) {
		return { status: 'error', note: 'The extension payload is malformed.' };
	}
	const ext = { key, extra_tokens: extra, approval_id: row.id, at: new Date().toISOString() };
	const path = `token_budget.extensions.${window}`;
	const [agent] = await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(
			jsonb_set(COALESCE(meta, '{}'::jsonb), '{token_budget,extensions}', COALESCE(meta #> '{token_budget,extensions}', '{}'::jsonb), true),
			string_to_array(${path}, '.'), ${JSON.stringify(ext)}::jsonb, true
		), updated_at = now()
		WHERE id = ${p.agent_id} AND user_id = ${row.user_id} AND meta ? 'token_budget'
		  AND COALESCE(meta #>> string_to_array(${path + '.key'}, '.'), '') <> ${key}
		RETURNING id, user_id, name, meta
	`;
	if (!agent) {
		const [existing] = await sql`SELECT id, meta FROM agent_identities WHERE id = ${p.agent_id} AND user_id = ${row.user_id}`;
		if (!existing) return { status: 'error', note: 'The agent no longer exists.' };
		if (!existing.meta?.token_budget) return { status: 'skipped', note: 'The token budget was removed before the extension applied.' };
		return { status: 'skipped', note: `This ${windowLabel(window)} window was already extended once.` };
	}
	const paused = agent.meta?.token_budget?.paused;
	if (paused && paused.window === window && paused.key === key) await clearPause(agent.id, paused);
	logAudit({ userId: row.user_id, action: 'token_budget_extended', resourceId: agent.id, meta: { window, key, extra_tokens: extra, approval_id: row.id } });
	return { status: 'ok', note: `Extended the ${windowLabel(window)} ceiling by ${fmt(extra)} tokens for this window and resumed the agent.` };
}

/**
 * The owner's resume button. Succeeds only when every capped window has room
 * again (the hour rolled over, the ceiling was raised or extended); otherwise
 * 409 still_capped with the choices, so a resume never readmits a call the
 * next gate would refuse.
 */
export async function resumeTokenBudget({ userId, agent, req = null }) {
	const budget = getTokenBudget(agent?.meta);
	if (!budget) return { resumed: false, paused: null, note: 'This agent has no token budget.' };
	if (!budget.paused) {
		const running = await setRunning(agent.id);
		return { resumed: running, paused: null, note: running ? 'The agent is running again.' : 'The agent was not paused by a token ceiling.' };
	}
	const p = budget.paused;
	const now = new Date();
	const live = windowsOf(budget, { now, runId: p.window === 'run' ? p.key : null }).find((w) => w.window === p.window);
	if (live && live.key === p.key) {
		const { tokens } = await usageRow(agent.id, p.window, p.key);
		if (tokens >= live.ceiling) {
			const err = refusal(agent, live, tokens, { paused: true, approvalId: p.approval_id || null });
			throw new TokenBudgetError(409, 'still_capped', `${agent.name || 'This agent'} is still at its ${windowLabel(p.window)} token ceiling (${fmt(tokens)} of ${fmt(live.ceiling)} tokens), so resuming would pause it again on the next call. Extend the ceiling once, raise it, or wait until ${live.resets_at || 'the run ends'}.`, err.detail);
		}
	}
	await clearPause(agent.id, p);
	const running = await setRunning(agent.id);
	logAudit({ userId, action: 'token_budget_resumed', resourceId: agent.id, meta: { window: p.window, key: p.key }, req });
	return { resumed: true, paused: null, note: running ? 'The agent is running again.' : 'The pause was cleared.' };
}

/**
 * The owner's extend-once button. Every extension is an approval row: an open
 * request for the window is approved, else one is created and approved in the
 * same call, so the audit trail reads the same whether the owner clicked a
 * notification or this endpoint.
 */
export async function extendTokenBudgetOnce({ userId, agent, window, extraTokens = null, req = null }) {
	const budget = getTokenBudget(agent?.meta);
	if (!budget) throw new TokenBudgetError(404, 'no_token_budget', 'This agent has no token budget to extend.');
	const win = TOKEN_WINDOWS.includes(window) ? window : budget.paused?.window;
	if (!win) throw new TokenBudgetError(400, 'invalid_window', 'window must be hour, day or run.');
	const cap = capFor(budget, win);
	if (cap == null) throw new TokenBudgetError(400, 'no_cap_for_window', `This agent has no ${windowLabel(win)} token cap.`);
	const runId = win === 'run' ? budget.paused?.window === 'run' ? budget.paused.key : null : null;
	if (win === 'run' && !runId) throw new TokenBudgetError(400, 'no_paused_run', 'A per-run ceiling can only be extended while a run is paused on it.');
	const w = windowsOf(budget, { runId }).find((x) => x.window === win);
	if (budget.extensions?.[win]?.key === w.key) {
		throw new TokenBudgetError(409, 'already_extended', `This ${windowLabel(win)} window was already extended once by ${fmt(budget.extensions[win].extra_tokens)} tokens. Raise the cap instead, or wait for the window to reset.`, { extension: budget.extensions[win] });
	}
	const extra = extraTokens == null ? null : Math.floor(Number(extraTokens));
	if (extra != null && (!Number.isFinite(extra) || extra < MIN_EXTENSION_TOKENS || extra > MAX_TOKENS_PER_CAP)) {
		throw new TokenBudgetError(400, 'invalid_extension', `extra_tokens must be a whole number between ${fmt(MIN_EXTENSION_TOKENS)} and ${fmt(MAX_TOKENS_PER_CAP)}.`);
	}
	const { tokens } = await usageRow(agent.id, win, w.key);
	const opened = await openExtensionApproval({ agent, userId, w, used: tokens, extraTokens: extra, deliver: false });
	const { decideApproval, effectiveStatus } = await import('./approvals.js');
	const row = opened.request;
	if (effectiveStatus(row) !== 'pending') {
		return { approval_id: row.id, status: effectiveStatus(row), idempotent: true };
	}
	const out = await decideApproval({ userId, id: row.id, decision: 'approve', payloadHash: row.payload_hash, via: 'web', req });
	return { approval_id: row.id, status: out?.request?.status || out?.status || 'approved', result: out?.request?.result || out?.result || null, extra_tokens: Number(row.payload?.extra_tokens) || extra };
}

/**
 * Replace the agent's token caps. A pause that the new caps clear is lifted
 * and the agent restarted, mirroring resumeAfterBudgetChange for dollars.
 * @returns {Promise<{ budget: object|null, resumed: boolean }>}
 */
export async function setTokenBudget({ userId, agent, budget: raw, req = null }) {
	const caps = normalizeTokenBudget(raw);
	const previous = getTokenBudget(agent?.meta);
	const stored = caps
		? { ...caps, updated_at: new Date().toISOString(), extensions: previous?.extensions || {}, ...(previous?.paused ? { paused: previous.paused } : {}) }
		: null;
	const [row] = await sql`
		UPDATE agent_identities
		SET meta = CASE
			WHEN ${stored == null} THEN (COALESCE(meta, '{}'::jsonb) - 'token_budget')
			ELSE jsonb_set(COALESCE(meta, '{}'::jsonb), '{token_budget}', ${JSON.stringify(stored)}::jsonb, true)
		END, updated_at = now()
		WHERE id = ${agent.id} AND user_id = ${userId}
		RETURNING id, user_id, name, meta
	`;
	if (!row) throw new TokenBudgetError(404, 'not_found', 'agent not found');
	let resumed = false;
	if (previous?.paused) {
		if (!stored) {
			resumed = previous.paused.stopped_agent ? await setRunning(agent.id) : false;
		} else {
			const fresh = getTokenBudget(row.meta);
			const p = fresh.paused;
			const live = windowsOf(fresh, { runId: p.window === 'run' ? p.key : null }).find((w) => w.window === p.window);
			const { tokens } = live ? await usageRow(agent.id, p.window, p.key) : { tokens: 0 };
			if (!live || live.key !== p.key || tokens < live.ceiling) {
				await clearPause(agent.id, p);
				resumed = true;
			}
		}
	}
	logAudit({ userId, action: 'token_budget_set', resourceId: agent.id, meta: { budget: caps, resumed }, req });
	const [after] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agent.id}`;
	return { budget: await tokenBudgetStatus({ agent: after }), resumed };
}

/** The read model for the API and the spend page. */
export async function tokenBudgetStatus({ agent, runId = null }) {
	const budget = getTokenBudget(agent?.meta);
	if (!budget) return null;
	const now = new Date();
	const windows = [];
	for (const w of windowsOf(budget, { now, runId })) {
		const u = await usageRow(agent.id, w.window, w.key);
		const pct = w.ceiling > 0 ? Math.min(999, Math.round((u.tokens / w.ceiling) * 1000) / 10) : 0;
		windows.push({
			window: w.window,
			key: w.key,
			limit_tokens: w.cap,
			extension_tokens: w.ceiling - w.cap,
			ceiling_tokens: w.ceiling,
			used_tokens: u.tokens,
			reserved_tokens: u.reserved,
			calls: u.calls,
			pct,
			exhausted: u.tokens >= w.ceiling,
			resets_at: w.resets_at,
			alerts: alertsFor(agent.meta, `tokens:${w.window}`, w.key),
		});
	}
	return {
		hourly_tokens: budget.hourly_tokens,
		daily_tokens: budget.daily_tokens,
		per_run_tokens: budget.per_run_tokens,
		updated_at: budget.updated_at,
		paused: budget.paused
			? { ...budget.paused, resets_at: nextTokenReset(budget.paused.window, now), extendable: budget.extensions?.[budget.paused.window]?.key !== budget.paused.key }
			: null,
		extensions: budget.extensions || {},
		windows,
	};
}

/** The thresholds already announced for a cap's current window, from the latch. */
export function alertsFor(meta, cap, key) {
	const a = meta?.spend_alerts?.[cap];
	if (!a || a.key !== key) return [];
	return (Array.isArray(a.sent) ? a.sent : []).map(Number).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
}

/** Sweep counters whose window ended more than two days ago. */
export async function pruneTokenUsage({ olderThanDays = 2 } = {}) {
	const rows = await sql`
		DELETE FROM agent_token_usage
		WHERE updated_at < now() - make_interval(days => ${olderThanDays})
		RETURNING agent_id
	`;
	return rows.length;
}
