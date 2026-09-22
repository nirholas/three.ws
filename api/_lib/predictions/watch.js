// Market watches: `market_price` alert rules on one outcome of one market.
//
// A watch is a row in pump_alert_rules (kind 'market_price') so it rides the
// alert system that already exists: the monitor cron evaluates it
// (api/_lib/pump-alert-runner.js), delivery goes to in-app, webhook and
// Telegram (api/_lib/alert-delivery.js), and the rules are listed and edited on
// the notifications settings like every other alert. The rule fires once when
// the side's implied probability crosses the threshold, then re-arms only after
// it crosses back.

import { sql } from '../db.js';
import { randomToken } from '../crypto.js';
import { getVenue, DEFAULT_VENUE, sideProbability } from './index.js';
import { PredictionError } from './engine.js';

const MAX_WATCHES_PER_USER = 50;
const DEFAULT_COOLDOWN_S = 900;
const TELEGRAM_RE = /^(-?\d{1,32}|@[a-zA-Z0-9_]{4,64})$/;

/** Validate a watch request. Pure. Returns the normalized fields or throws PredictionError. */
export function parseWatch(body) {
	const b = body && typeof body === 'object' ? body : {};
	const marketId = typeof b.market_id === 'string' ? b.market_id.trim() : '';
	if (!marketId || marketId.length > 128) throw new PredictionError('invalid_market', 'market_id is required.');
	const side = String(b.side || 'yes').toLowerCase();
	if (side !== 'yes' && side !== 'no') throw new PredictionError('invalid_side', 'side must be "yes" or "no".');
	const direction = String(b.direction || '').toLowerCase();
	if (direction !== 'above' && direction !== 'below') throw new PredictionError('invalid_direction', 'direction must be "above" or "below".');
	const threshold = Number(b.threshold);
	if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
		throw new PredictionError('invalid_threshold', 'threshold is an implied probability strictly between 0 and 1 (0.65 means 65%).');
	}
	const cooldown = b.cooldown_seconds == null ? DEFAULT_COOLDOWN_S : Math.round(Number(b.cooldown_seconds));
	if (!Number.isFinite(cooldown) || cooldown < 60 || cooldown > 86_400) throw new PredictionError('invalid_cooldown', 'cooldown_seconds must be between 60 and 86400.');
	const telegram = b.telegram_chat ? String(b.telegram_chat).trim() : null;
	if (telegram && !TELEGRAM_RE.test(telegram)) throw new PredictionError('invalid_telegram', 'telegram_chat must be a numeric chat id or @username.');
	const webhook = b.webhook_url ? String(b.webhook_url).trim() : null;
	if (webhook && (!/^https:\/\//i.test(webhook) || webhook.length > 2048)) throw new PredictionError('invalid_webhook', 'webhook_url must be an https URL.');
	const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 80) : null;
	return { marketId, side, direction, threshold: Math.round(threshold * 10_000) / 10_000, cooldown, telegram, webhook, label };
}

function serializeWatch(row, market = null) {
	const outcome = market?.outcomes?.find((o) => o.side === row.target_side) || null;
	const current = market ? sideProbability(market, row.target_side) : null;
	return {
		id: row.id,
		market_id: row.target_market,
		side: row.target_side,
		direction: row.direction,
		threshold: Number(row.threshold),
		label: row.label || null,
		enabled: row.enabled,
		cooldown_seconds: row.cooldown_seconds,
		delivery: { in_app: row.deliver_in_app, telegram_chat: row.telegram_chat || null, webhook_url: row.webhook_url || null },
		last_fired_at: row.last_fired_at || null,
		created_at: row.created_at,
		market: market ? { id: market.id, title: market.title, event_id: market.event_id, status: market.status, side_label: outcome?.label || null } : null,
		current_probability: current,
	};
}

export async function createWatch({ agentId, userId, body }) {
	const w = parseWatch(body);
	const venue = getVenue(DEFAULT_VENUE);
	const market = await venue.getMarket(w.marketId);
	const [{ count }] = await sql`SELECT count(*)::int AS count FROM pump_alert_rules WHERE user_id = ${userId}`;
	if (count >= MAX_WATCHES_PER_USER) throw new PredictionError('limit_reached', `You can have at most ${MAX_WATCHES_PER_USER} alert rules. Remove one first.`, 409);
	const outcome = market.outcomes.find((o) => o.side === w.side);
	const label = w.label || `${market.title}: ${outcome?.label || w.side} ${w.direction} ${Math.round(w.threshold * 100)}%`.slice(0, 80);
	const [row] = await sql`
		INSERT INTO pump_alert_rules
			(user_id, kind, target_market, target_side, direction, threshold, target_agent_scope,
			 deliver_in_app, webhook_url, webhook_secret, telegram_chat, cooldown_seconds, enabled, label)
		VALUES
			(${userId}, 'market_price', ${market.id}, ${w.side}, ${w.direction}, ${w.threshold}, ${agentId},
			 true, ${w.webhook}, ${w.webhook ? `whsec_${randomToken(24)}` : null}, ${w.telegram}, ${w.cooldown}, true, ${label})
		RETURNING id, target_market, target_side, direction, threshold, label, enabled, cooldown_seconds,
		          deliver_in_app, telegram_chat, webhook_url, created_at
	`;
	// Seed the crossing state from the price right now, so the monitor's next
	// tick fires on a genuine crossing instead of spending a tick learning which
	// side of the line the market started on.
	const now = sideProbability(market, w.side);
	if (now != null) {
		const side = now >= w.threshold ? 'over' : 'under';
		await sql`
			INSERT INTO pump_alert_rule_fires (rule_id, last_state, updated_at)
			VALUES (${row.id}, ${JSON.stringify({ side })}::jsonb, now())
			ON CONFLICT (rule_id) DO NOTHING
		`;
	}
	return serializeWatch({ ...row, last_fired_at: null }, market);
}

export async function listWatches({ agentId, userId }) {
	const rows = await sql`
		SELECT r.id, r.target_market, r.target_side, r.direction, r.threshold, r.label, r.enabled,
		       r.cooldown_seconds, r.deliver_in_app, r.telegram_chat, r.webhook_url, r.created_at,
		       f.last_fired_at
		FROM pump_alert_rules r
		LEFT JOIN pump_alert_rule_fires f ON f.rule_id = r.id
		WHERE r.user_id = ${userId} AND r.kind = 'market_price'
		  AND (${agentId}::uuid IS NULL OR r.target_agent_scope = ${agentId})
		ORDER BY r.created_at DESC
		LIMIT 100
	`;
	const venue = getVenue(DEFAULT_VENUE);
	const markets = new Map();
	await Promise.all([...new Set(rows.map((r) => r.target_market))].map(async (id) => {
		markets.set(id, await venue.getMarket(id).catch(() => null));
	}));
	return rows.map((r) => serializeWatch(r, markets.get(r.target_market)));
}

export async function deleteWatch({ userId, watchId }) {
	const rows = await sql`
		DELETE FROM pump_alert_rules
		WHERE id = ${watchId} AND user_id = ${userId} AND kind = 'market_price'
		RETURNING id
	`;
	if (!rows.length) throw new PredictionError('not_found', 'No watch with that id on your account.', 404);
	return { deleted: true, id: watchId };
}
