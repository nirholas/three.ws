// The v1 automation object: one trigger, one action, one guarded execution path.
//
// An automation is a row in agent_automations. Its trigger is evaluated here,
// by the per-minute sweep (api/cron/agent-automations.js) or, for tips, inline
// from the tip-recording path. Its action runs through the platform engine that
// already owns that kind of work:
//
//   agent_prompt      → a v1 run (api/_lib/agents-v1/runs.js), driven by the run cron
//   swap | transfer   → a backing wallet intent (trigger 'on_automation') executed by
//   notify              fireIntentForAutomation, so spending inherits the intent
//                       engine's freeze check, spend policy, per-intent caps and the
//                       idempotent custody claim exactly as the wallet UI's rules do
//
// Existing wallet intents and pump alert rules are listed alongside as the same
// object (source 'wallet_intent' / 'alert_rule') and can be deleted through it.
// A stopped agent (agent_identities.status) never fires.

import { CronExpressionParser } from 'cron-parser';
import { sql } from '../db.js';
import { apiError } from './http.js';
import {
	createIntent,
	deleteIntent,
	fireIntentForAutomation,
	listIntents,
	normalizeIntent,
} from '../wallet-intents.js';
import { fetchTokenPriceUsd } from '../market/token-market.js';
import { getSolanaAddressBalances } from '../agent-wallet.js';
import { recentPumpLaunches } from '../pump-launch-feed.js';
import { fetchRecentTrades } from '../pump-alert-runner.js';
import { solPriceUsd } from '../sol-price.js';
import { resolveSolanaRecipient } from '../../../src/solana/sns.js';

export const TRIGGER_TYPES = Object.freeze([
	'price_threshold',
	'schedule',
	'balance_below',
	'tip_received',
	'launch_matching',
	'graduation',
	'whale_buy',
]);
export const ACTION_TYPES = Object.freeze(['agent_prompt', 'swap', 'transfer', 'notify']);
const SPEND_ACTIONS = new Set(['swap', 'transfer']);
// Event triggers default to a cooldown so a busy market cannot start a run per
// event; schedule/price/balance are already edge- or period-bounded.
const DEFAULT_COOLDOWN_MIN = { launch_matching: 15, graduation: 15, whale_buy: 15, tip_received: 0 };
const MIN_SCHEDULE_GAP_MS = 5 * 60 * 1000;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_PER_AGENT = 50;

function bad(code, message, details = null) {
	return apiError(400, code, message, details);
}

function posNumber(v, name, { min = 0, exclusive = true, max = Number.MAX_SAFE_INTEGER } = {}) {
	const n = Number(v);
	if (!Number.isFinite(n) || (exclusive ? n <= min : n < min) || n > max) {
		throw bad('invalid_parameter', `${name} must be a number ${exclusive ? 'greater than' : 'of at least'} ${min}.`, { parameter: name });
	}
	return n;
}

function mintParam(v, name) {
	if (typeof v !== 'string' || !BASE58_RE.test(v.trim())) {
		throw bad('invalid_parameter', `${name} must be a Solana mint address.`, { parameter: name });
	}
	return v.trim();
}

/** Validate a 5-field cron expression and refuse cadences tighter than five minutes. */
export function validateCron(expr) {
	if (typeof expr !== 'string' || expr.trim().split(/\s+/).length !== 5) {
		throw bad('invalid_cron', 'schedule.cron must be a 5-field cron expression in UTC, e.g. "0 13 * * *".');
	}
	let it;
	try {
		it = CronExpressionParser.parse(expr.trim(), { currentDate: new Date(), tz: 'UTC' });
	} catch (err) {
		throw bad('invalid_cron', `schedule.cron is not valid: ${err.message}`);
	}
	const a = it.next().toDate().getTime();
	const b = it.next().toDate().getTime();
	if (b - a < MIN_SCHEDULE_GAP_MS) throw bad('invalid_cron', 'schedule.cron may fire at most once every 5 minutes.');
	return expr.trim();
}

function normalizeTrigger(t) {
	if (!t || typeof t !== 'object') throw bad('missing_parameter', 'trigger is required.', { parameter: 'trigger' });
	const type = String(t.type || '');
	if (!TRIGGER_TYPES.includes(type)) {
		throw bad('invalid_trigger', `trigger.type must be one of: ${TRIGGER_TYPES.join(', ')}.`);
	}
	const out = { type };
	switch (type) {
		case 'price_threshold':
			out.mint = mintParam(t.mint, 'trigger.mint');
			if (!['above', 'below'].includes(t.operator)) throw bad('invalid_parameter', 'trigger.operator must be "above" or "below".');
			out.operator = t.operator;
			out.priceUsd = posNumber(t.priceUsd, 'trigger.priceUsd');
			break;
		case 'schedule':
			out.cron = validateCron(t.cron);
			break;
		case 'balance_below':
			out.thresholdSol = posNumber(t.thresholdSol, 'trigger.thresholdSol');
			break;
		case 'tip_received':
			out.minSol = t.minSol == null ? 0 : posNumber(t.minSol, 'trigger.minSol', { exclusive: false });
			break;
		case 'launch_matching':
			if (t.creator != null) out.creator = mintParam(t.creator, 'trigger.creator');
			if (t.maxMcapUsd != null) out.maxMcapUsd = posNumber(t.maxMcapUsd, 'trigger.maxMcapUsd');
			if (t.minMcapUsd != null) out.minMcapUsd = posNumber(t.minMcapUsd, 'trigger.minMcapUsd');
			if (!out.creator && out.maxMcapUsd == null) {
				throw bad('invalid_trigger', 'launch_matching needs a creator address, a maxMcapUsd, or both.');
			}
			break;
		case 'graduation':
			if (t.mint != null) out.mint = mintParam(t.mint, 'trigger.mint');
			break;
		case 'whale_buy':
			out.mint = mintParam(t.mint, 'trigger.mint');
			out.minSol = posNumber(t.minSol, 'trigger.minSol');
			break;
	}
	const cd = t.cooldownMinutes ?? DEFAULT_COOLDOWN_MIN[type] ?? 0;
	out.cooldownMinutes = posNumber(cd, 'trigger.cooldownMinutes', { exclusive: false, max: 10_080 });
	return out;
}

function normalizeAction(a, trigger) {
	if (!a || typeof a !== 'object') throw bad('missing_parameter', 'action is required.', { parameter: 'action' });
	const type = String(a.type || '');
	if (!ACTION_TYPES.includes(type)) throw bad('invalid_action', `action.type must be one of: ${ACTION_TYPES.join(', ')}.`);
	const out = { type };
	switch (type) {
		case 'agent_prompt': {
			const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
			if (!prompt) throw bad('missing_parameter', 'action.prompt is required.', { parameter: 'action.prompt' });
			if (prompt.length > 2000) throw bad('invalid_parameter', 'action.prompt must be at most 2000 characters.');
			out.prompt = prompt;
			if (a.maxSteps != null) {
				const n = Number(a.maxSteps);
				if (!Number.isInteger(n) || n < 1 || n > 30) throw bad('invalid_parameter', 'action.maxSteps must be an integer from 1 to 30.');
				out.maxSteps = n;
			}
			if (a.budgetCreditsUsd != null) out.budgetCreditsUsd = posNumber(a.budgetCreditsUsd, 'action.budgetCreditsUsd', { exclusive: false, max: 100 });
			break;
		}
		case 'swap': {
			const fromEvent = trigger.type === 'launch_matching' || trigger.type === 'graduation';
			if (a.mint != null) out.mint = mintParam(a.mint, 'action.mint');
			else if (!fromEvent) throw bad('missing_parameter', 'action.mint is required for a swap.', { parameter: 'action.mint' });
			else out.mintFromEvent = true;
			out.amountSol = posNumber(a.amountSol, 'action.amountSol', { max: 1000 });
			out.slippagePct = a.slippagePct == null ? 5 : posNumber(a.slippagePct, 'action.slippagePct', { max: 50 });
			break;
		}
		case 'transfer':
			if (typeof a.destination !== 'string' || !a.destination.trim()) {
				throw bad('missing_parameter', 'action.destination is required for a transfer.', { parameter: 'action.destination' });
			}
			out.destination = a.destination.trim();
			out.amountSol = posNumber(a.amountSol, 'action.amountSol', { max: 1000 });
			break;
		case 'notify':
			out.message = typeof a.message === 'string' && a.message.trim() ? a.message.trim().slice(0, 280) : null;
			break;
	}
	return out;
}

/**
 * Validate a create payload into `{ title, trigger, action, triggerOnce, limits }`.
 * Throws an ApiError with a stable code on bad input.
 */
export function normalizeAutomation(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const trigger = normalizeTrigger(r.trigger);
	const action = normalizeAction(r.action, trigger);
	const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 80) : defaultTitle(trigger, action);
	const limits = {};
	if (r.limits && typeof r.limits === 'object') {
		for (const k of ['perActionUsd', 'dailyUsd', 'totalUsd']) {
			if (r.limits[k] != null) limits[k] = posNumber(r.limits[k], `limits.${k}`);
		}
	}
	return { title, trigger, action, triggerOnce: r.triggerOnce === true, limits };
}

function defaultTitle(trigger, action) {
	const what = { agent_prompt: 'run the agent', swap: 'buy', transfer: 'send SOL', notify: 'notify me' }[action.type];
	const when = {
		price_threshold: `price ${trigger.operator} $${trigger.priceUsd}`,
		schedule: `on schedule ${trigger.cron}`,
		balance_below: `balance below ${trigger.thresholdSol} SOL`,
		tip_received: 'on a tip',
		launch_matching: 'on a matching launch',
		graduation: 'on a graduation',
		whale_buy: `on a whale buy over ${trigger.minSol} SOL`,
	}[trigger.type];
	return `When ${when}, ${what}`.slice(0, 80);
}

/** The wallet-intent payload that executes a spend/notify action. */
function backingIntentPayload(a, title) {
	const limits = {
		per_action_usd: a.limits.perActionUsd ?? null,
		daily_usd: a.limits.dailyUsd ?? null,
		total_usd: a.limits.totalUsd ?? null,
	};
	const base = { title, trigger_type: 'on_automation', trigger_config: {}, limits };
	if (a.action.type === 'swap') {
		return {
			...base,
			action_type: 'buy',
			action_config: {
				mint: a.action.mint || null,
				mint_from_event: a.action.mintFromEvent === true,
				amount_sol: a.action.amountSol,
				slippage_pct: a.action.slippagePct,
			},
		};
	}
	if (a.action.type === 'transfer') {
		return { ...base, action_type: 'transfer', action_config: { destination: a.action.destination, amount_sol: a.action.amountSol } };
	}
	return { ...base, action_type: 'notify', action_config: { message: a.action.message, channel: 'email' } };
}

// ── serialization ────────────────────────────────────────────────────────────

export function serializeAutomation(row) {
	return {
		id: row.id,
		agentId: row.agent_id,
		source: 'automation',
		title: row.title,
		trigger: row.trigger_config,
		action: row.action_config,
		triggerOnce: row.trigger_once,
		enabled: row.enabled,
		intentId: row.intent_id || null,
		stats: {
			fireCount: row.fire_count,
			lastFiredAt: row.last_fired_at,
			lastCheckedAt: row.last_checked_at,
			lastStatus: row.last_status,
			lastNote: row.last_note,
		},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

const INTENT_TRIGGER_NAMES = {
	on_schedule: 'schedule',
	on_balance_below: 'balance_below',
	on_tip_received: 'tip_received',
	on_launch_matching: 'launch_matching',
};
const INTENT_ACTION_NAMES = { buy: 'swap', snipe: 'swap', transfer: 'transfer', notify: 'notify' };

function serializeIntent(intent) {
	const { type: tType, ...tCfg } = intent.trigger;
	const { type: aType, ...aCfg } = intent.action;
	return {
		id: intent.id,
		agentId: intent.agent_id,
		source: 'wallet_intent',
		title: intent.title,
		trigger: { type: INTENT_TRIGGER_NAMES[tType] || tType, ...tCfg },
		action: { type: INTENT_ACTION_NAMES[aType] || aType, ...aCfg },
		triggerOnce: false,
		enabled: intent.enabled,
		intentId: intent.id,
		stats: {
			fireCount: intent.stats.fire_count,
			lastFiredAt: intent.stats.last_fired_at,
			lastCheckedAt: null,
			lastStatus: intent.stats.last_status,
			lastNote: intent.stats.last_note,
		},
		createdAt: intent.created_at,
		updatedAt: intent.updated_at,
	};
}

function serializeAlertRule(r) {
	const trigger =
		r.kind === 'graduation'
			? { type: 'graduation', mint: r.target_mint || undefined, agentId: r.target_agent || undefined }
			: r.kind === 'whale_buy'
				? { type: 'whale_buy', mint: r.target_mint, minSol: Number(r.threshold) }
				: r.kind === 'new_mint'
					? { type: 'new_mint', agentId: r.target_agent }
					: { type: 'market_cap_threshold', mint: r.target_mint, operator: r.kind === 'price_above' ? 'above' : 'below', marketCapUsd: Number(r.threshold) };
	const channels = [r.deliver_in_app && 'in_app', r.webhook_url && 'webhook', r.telegram_chat && 'telegram'].filter(Boolean);
	return {
		id: r.id,
		agentId: null,
		source: 'alert_rule',
		title: r.label,
		trigger: { ...trigger, cooldownMinutes: Math.round((r.cooldown_seconds || 0) / 60) },
		action: { type: 'notify', channels },
		triggerOnce: false,
		enabled: r.enabled,
		intentId: null,
		stats: { fireCount: null, lastFiredAt: r.last_fired_at || null, lastCheckedAt: null, lastStatus: null, lastNote: null },
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create an automation on an agent the caller owns. Spend actions need
 * `confirm: true`: the owner is authorizing future autonomous spending.
 */
export async function createAutomation({ agent, userId, body, source = 'api' }) {
	const a = normalizeAutomation(body);
	if (SPEND_ACTIONS.has(a.action.type) && body.confirm !== true) {
		throw apiError(400, 'confirmation_required', `A ${a.action.type} automation spends from the agent wallet on its own. Resend with "confirm": true to authorize it.`, {
			action: a.action,
			trigger: a.trigger,
		});
	}
	const [{ n }] = await sql`SELECT count(*)::int AS n FROM agent_automations WHERE agent_id = ${agent.id}`;
	if (n >= MAX_PER_AGENT) throw apiError(409, 'automation_limit', `An agent can hold at most ${MAX_PER_AGENT} automations.`);

	if (a.action.type === 'transfer') {
		const dest = await resolveSolanaRecipient(a.action.destination).catch(() => null);
		const address = dest?.address || (BASE58_RE.test(a.action.destination) ? a.action.destination : null);
		if (!address) throw bad('invalid_parameter', 'action.destination must be a Solana address or .sol name.', { parameter: 'action.destination' });
		a.action.destination = address;
	}

	let intentId = null;
	if (a.action.type !== 'agent_prompt') {
		const norm = normalizeIntent(backingIntentPayload(a, a.title));
		if (!norm.ok) throw bad(norm.error, norm.message);
		const intent = await createIntent(agent.id, userId, norm.intent, { sourceText: `v1 automation: ${a.title}` });
		intentId = intent.id;
	}
	const [row] = await sql`
		INSERT INTO agent_automations
			(agent_id, user_id, title, trigger_type, trigger_config, action_type, action_config, trigger_once, intent_id, source, last_checked_at)
		VALUES (
			${agent.id}, ${userId}, ${a.title}, ${a.trigger.type}, ${JSON.stringify(a.trigger)}::jsonb,
			${a.action.type}, ${JSON.stringify(a.action)}::jsonb, ${a.triggerOnce}, ${intentId}, ${source}, now()
		)
		RETURNING *
	`;
	return serializeAutomation(row);
}

/** Every automation on one agent: native rows plus the wallet intents not backing one. */
export async function listAgentAutomations(agentId) {
	const [rows, intents] = await Promise.all([
		sql`SELECT * FROM agent_automations WHERE agent_id = ${agentId} ORDER BY created_at DESC`,
		listIntents(agentId),
	]);
	const backing = new Set(rows.map((r) => r.intent_id).filter(Boolean));
	return [
		...rows.map(serializeAutomation),
		...intents.filter((i) => !backing.has(i.id)).map(serializeIntent),
	];
}

/** Every automation across the caller's agents, plus their account-level alert rules. */
export async function listUserAutomations(userId) {
	const [rows, intentRows, rules] = await Promise.all([
		sql`SELECT * FROM agent_automations WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 500`,
		sql`
			SELECT w.* FROM agent_wallet_intents w
			JOIN agent_identities i ON i.id = w.agent_id AND i.deleted_at IS NULL
			WHERE i.user_id = ${userId}
			ORDER BY w.created_at DESC LIMIT 500
		`,
		sql`
			SELECT r.*, f.last_fired_at FROM pump_alert_rules r
			LEFT JOIN pump_alert_rule_fires f ON f.rule_id = r.id
			WHERE r.user_id = ${userId}
			ORDER BY r.created_at DESC LIMIT 500
		`,
	]);
	const backing = new Set(rows.map((r) => r.intent_id).filter(Boolean));
	const standalone = new Set(intentRows.filter((w) => !backing.has(w.id)).map((w) => w.id));
	const agentIds = [...new Set(intentRows.filter((w) => standalone.has(w.id)).map((w) => w.agent_id))];
	const intents = (await Promise.all(agentIds.map((id) => listIntents(id)))).flat().filter((i) => standalone.has(i.id));
	return [
		...rows.map(serializeAutomation),
		...intents.map(serializeIntent),
		...rules.map(serializeAlertRule),
	];
}

/** Delete any automation-shaped object the caller owns, whatever its source. */
export async function deleteAutomation(userId, id) {
	const [row] = await sql`DELETE FROM agent_automations WHERE id = ${id} AND user_id = ${userId} RETURNING agent_id, intent_id`;
	if (row) {
		if (row.intent_id) await deleteIntent(row.agent_id, userId, row.intent_id);
		return { id, source: 'automation', deleted: true };
	}
	const [intent] = await sql`
		SELECT w.id, w.agent_id FROM agent_wallet_intents w
		JOIN agent_identities i ON i.id = w.agent_id
		WHERE w.id = ${id} AND i.user_id = ${userId}
	`;
	if (intent) {
		await deleteIntent(intent.agent_id, userId, id);
		return { id, source: 'wallet_intent', deleted: true };
	}
	const [rule] = await sql`DELETE FROM pump_alert_rules WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
	if (rule) return { id, source: 'alert_rule', deleted: true };
	throw apiError(404, 'not_found', 'No automation with that id.');
}

// ── evaluation ───────────────────────────────────────────────────────────────

function cooledDown(row, now) {
	const mins = Number(row.trigger_config?.cooldownMinutes || 0);
	if (!mins || !row.last_fired_at) return true;
	return now.getTime() - new Date(row.last_fired_at).getTime() >= mins * 60_000;
}

/** When a schedule automation is next due, from its last fire (or creation). */
export function nextScheduledAt(row) {
	const from = row.last_fired_at || row.created_at;
	const it = CronExpressionParser.parse(row.trigger_config.cron, { currentDate: new Date(from), tz: 'UTC' });
	return it.next().toDate();
}

/** Edge-triggered price check: fire when the price moves onto the target side. */
export function evaluatePriceThreshold(trigger, priceUsd, state = {}) {
	const side = priceUsd > trigger.priceUsd ? 'above' : priceUsd < trigger.priceUsd ? 'below' : state.side || null;
	const fire = side === trigger.operator && state.side !== trigger.operator;
	return { fire, state: { side, priceUsd } };
}

async function stamp(row, { fired, status, note, state }) {
	await sql`
		UPDATE agent_automations SET
			fire_count = fire_count + ${fired ? 1 : 0},
			last_fired_at = CASE WHEN ${fired} THEN now() ELSE last_fired_at END,
			last_checked_at = now(),
			last_status = COALESCE(${status}, last_status),
			last_note = COALESCE(${note ? String(note).slice(0, 280) : null}, last_note),
			state = COALESCE(${state ? JSON.stringify(state) : null}::jsonb, state),
			enabled = CASE WHEN ${fired} AND trigger_once THEN false ELSE enabled END,
			updated_at = now()
		WHERE id = ${row.id}
	`;
}

function eventSummary(event) {
	const parts = [];
	if (event.mint) parts.push(`mint ${event.mint}`);
	if (event.symbol) parts.push(`symbol ${event.symbol}`);
	if (event.priceUsd != null) parts.push(`price $${event.priceUsd}`);
	if (event.marketCapUsd != null) parts.push(`market cap $${Math.round(event.marketCapUsd)}`);
	if (event.amount_sol != null) parts.push(`${event.amount_sol} SOL`);
	if (event.balance_sol != null) parts.push(`balance ${event.balance_sol} SOL`);
	if (event.from) parts.push(`from ${event.from}`);
	if (event.signature) parts.push(`tx ${event.signature}`);
	return parts.join(', ');
}

/**
 * Fire one automation's action for an event. `key` makes the fire idempotent:
 * the same (automation, key) never executes twice.
 */
export async function fireAutomation(row, event, key) {
	const discriminator = `auto:${row.id}:${key}`;
	if (row.action_type === 'agent_prompt') {
		const { createRun } = await import('./runs.js');
		const context = eventSummary(event);
		const run = await createRun({
			agentId: row.agent_id,
			userId: row.user_id,
			goal: context ? `${row.action_config.prompt}\n\nTrigger: ${row.trigger_type} (${context}).` : row.action_config.prompt,
			maxSteps: row.action_config.maxSteps,
			budgetCreditsUsd: row.action_config.budgetCreditsUsd || 0,
			source: 'automation',
			automationId: row.id,
			triggerKey: key.slice(0, 200),
		});
		if (!run) return { fired: false, status: 'skipped', note: 'already ran for this event' };
		await stamp(row, { fired: true, status: 'run_started', note: `run ${run.id}` });
		return { fired: true, status: 'run_started', runId: run.id };
	}
	const res = await fireIntentForAutomation({
		agentId: row.agent_id,
		intentId: row.intent_id,
		discriminator,
		event,
	});
	const fired = res.status === 'ok' || res.status === 'notified';
	await stamp(row, { fired, status: res.status, note: res.note || res.signature || null });
	return { fired, status: res.status, note: res.note || null, signature: res.signature || null };
}

async function liveRows(types) {
	return sql`
		SELECT a.*, i.meta AS agent_meta
		FROM agent_automations a
		JOIN agent_identities i ON i.id = a.agent_id AND i.deleted_at IS NULL AND i.status = 'running'
		WHERE a.enabled = true AND a.trigger_type = ANY(${types})
		ORDER BY a.last_checked_at ASC NULLS FIRST
		LIMIT 500
	`;
}

/**
 * One sweep over every live automation with a polled trigger. Returns a tally
 * the cron logs. Errors in one automation never stop the rest.
 */
export async function runAutomationSweep({ now = new Date() } = {}) {
	const rows = await liveRows(['schedule', 'price_threshold', 'balance_below', 'launch_matching', 'graduation', 'whale_buy']);
	const summary = { scanned: rows.length, fired: 0, errors: 0, by_trigger: {} };
	if (!rows.length) return summary;

	const byType = (t) => rows.filter((r) => r.trigger_type === t);
	const tally = (t, r) => {
		summary.by_trigger[t] = (summary.by_trigger[t] || 0) + 1;
		if (r?.fired) summary.fired++;
	};
	const guard = async (row, fn) => {
		try {
			const r = await fn();
			tally(row.trigger_type, r);
		} catch (err) {
			summary.errors++;
			console.warn(`[automations] ${row.id} failed:`, err?.message || err);
			await stamp(row, { fired: false, status: 'error', note: err?.message || 'failed' }).catch(() => {});
		}
	};

	// schedule
	for (const row of byType('schedule')) {
		await guard(row, async () => {
			const due = nextScheduledAt(row);
			if (due > now) return null;
			return fireAutomation(row, {}, `sched:${due.toISOString()}`);
		});
	}

	// price_threshold: one price read per distinct mint
	const priceRows = byType('price_threshold');
	const prices = new Map();
	for (const mint of [...new Set(priceRows.map((r) => r.trigger_config.mint))].slice(0, 60)) {
		prices.set(mint, await fetchTokenPriceUsd(mint).catch(() => null));
	}
	for (const row of priceRows) {
		await guard(row, async () => {
			const price = prices.get(row.trigger_config.mint);
			if (price == null) return stamp(row, { fired: false, status: 'no_price', note: 'no live price for this mint' }).then(() => null);
			const verdict = evaluatePriceThreshold(row.trigger_config, price, row.state || {});
			if (!verdict.fire || !cooledDown(row, now)) {
				await stamp(row, { fired: false, status: null, note: null, state: verdict.state });
				return null;
			}
			await sql`UPDATE agent_automations SET state = ${JSON.stringify(verdict.state)}::jsonb WHERE id = ${row.id}`;
			return fireAutomation(row, { mint: row.trigger_config.mint, priceUsd: price }, `price:${now.toISOString().slice(0, 16)}`);
		});
	}

	// balance_below: once per UTC day while below the floor
	for (const row of byType('balance_below')) {
		await guard(row, async () => {
			const address = row.agent_meta?.solana_address;
			if (!address) return stamp(row, { fired: false, status: 'no_wallet', note: 'agent has no Solana wallet yet' }).then(() => null);
			const sol = Number((await getSolanaAddressBalances(address, 'mainnet'))?.sol);
			if (!Number.isFinite(sol) || sol >= row.trigger_config.thresholdSol) {
				await stamp(row, { fired: false, status: null, note: null, state: { balanceSol: sol } });
				return null;
			}
			if (!cooledDown(row, now)) return null;
			return fireAutomation(row, { balance_sol: sol }, `bal:${now.toISOString().slice(0, 10)}`);
		});
	}

	// launch_matching: one shared pull of recent launches
	const launchRows = byType('launch_matching');
	if (launchRows.length) {
		const launches = await recentPumpLaunches({ network: 'mainnet', limit: 60 }).catch(() => []);
		for (const row of launchRows) {
			await guard(row, async () => {
				const t = row.trigger_config;
				const since = row.state?.lastSeenAt || new Date(row.last_checked_at || row.created_at).getTime();
				const match = launches.find(
					(l) =>
						l.created_at != null &&
						l.created_at > since &&
						(!t.creator || l.creator === t.creator) &&
						(t.maxMcapUsd == null || (l.market_cap_usd != null && l.market_cap_usd <= t.maxMcapUsd)) &&
						(t.minMcapUsd == null || (l.market_cap_usd != null && l.market_cap_usd >= t.minMcapUsd)),
				);
				const newest = Math.max(since, ...launches.map((l) => l.created_at || 0));
				await stamp(row, { fired: false, status: null, note: null, state: { lastSeenAt: newest } });
				if (!match || !cooledDown(row, now)) return null;
				return fireAutomation(row, { mint: match.mint, symbol: match.symbol, marketCapUsd: match.market_cap_usd }, `launch:${match.mint}`);
			});
		}
	}

	// graduation: the persisted graduation feed
	const gradRows = byType('graduation');
	if (gradRows.length) {
		const grads = await sql`
			SELECT tx_signature, mint, symbol, market_cap_usd, seen_at FROM pumpfun_graduations
			WHERE seen_at > now() - interval '30 minutes' ORDER BY seen_at DESC LIMIT 200
		`;
		for (const row of gradRows) {
			await guard(row, async () => {
				const since = new Date(row.last_checked_at || row.created_at);
				const match = grads.find((g) => new Date(g.seen_at) > since && (!row.trigger_config.mint || g.mint === row.trigger_config.mint));
				await stamp(row, { fired: false, status: null, note: null });
				if (!match || !cooledDown(row, now)) return null;
				return fireAutomation(row, { mint: match.mint, symbol: match.symbol, marketCapUsd: match.market_cap_usd != null ? Number(match.market_cap_usd) : null, signature: match.tx_signature }, `grad:${match.mint}`);
			});
		}
	}

	// whale_buy: recent trades per distinct mint
	const whaleRows = byType('whale_buy');
	if (whaleRows.length) {
		const solPrice = await solPriceUsd().catch(() => 0);
		const trades = new Map();
		for (const mint of [...new Set(whaleRows.map((r) => r.trigger_config.mint))].slice(0, 60)) {
			trades.set(mint, await fetchRecentTrades(mint, solPrice).catch(() => []));
		}
		for (const row of whaleRows) {
			await guard(row, async () => {
				const since = new Date(row.last_checked_at || row.created_at);
				const hit = (trades.get(row.trigger_config.mint) || []).find(
					(t) => t.is_buy && t.sol_amount >= row.trigger_config.minSol && t.ts && t.ts > since,
				);
				await stamp(row, { fired: false, status: null, note: null });
				if (!hit || !cooledDown(row, now)) return null;
				return fireAutomation(row, { mint: row.trigger_config.mint, amount_sol: hit.sol_amount, from: hit.buyer, signature: hit.signature }, `whale:${hit.signature || hit.ts.toISOString()}`);
			});
		}
	}

	return summary;
}

/**
 * Fired from the tip-recording path with a freshly recorded, real tip.
 * @param {string} agentId
 * @param {{ signature?: string, amount_sol?: number|null, from?: string|null, network?: string }} tip
 */
export async function onAutomationTip(agentId, tip) {
	if (tip.network === 'devnet') return { fired: 0 };
	const rows = await sql`
		SELECT a.* FROM agent_automations a
		JOIN agent_identities i ON i.id = a.agent_id AND i.deleted_at IS NULL AND i.status = 'running'
		WHERE a.agent_id = ${agentId} AND a.enabled = true AND a.trigger_type = 'tip_received'
	`;
	let fired = 0;
	const now = new Date();
	for (const row of rows) {
		if ((tip.amount_sol ?? 0) < (row.trigger_config.minSol || 0) || !cooledDown(row, now)) continue;
		try {
			const r = await fireAutomation(row, { amount_sol: tip.amount_sol ?? null, from: tip.from || null, signature: tip.signature || null }, `tip:${tip.signature || now.toISOString()}`);
			if (r.fired) fired++;
		} catch (err) {
			console.warn(`[automations] tip fire ${row.id} failed:`, err?.message || err);
		}
	}
	return { fired };
}
