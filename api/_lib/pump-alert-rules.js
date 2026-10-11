// The pump alert rule store: list, create, update and delete a user's rules.
//
// One implementation behind both surfaces that write rules, the REST endpoints
// (api/alerts/rules.js, api/alerts/rules/[id].js) and the threews-agent MCP
// tools (alert_rule_create, alert_rule_list, alert_rule_delete), so a rule an
// agent creates is byte-for-byte the rule the dashboard would have created:
// same validation (api/alerts/_rules.js), same per-user cap, same webhook
// signing secret. The rules are evaluated by api/_lib/pump-alert-runner.js.

import { sql } from './db.js';
import { parse } from './validate.js';
import { randomToken } from './crypto.js';
import {
	createRuleSchema, updateRuleSchema, validateUpdate, normalizeForKind, rulesMissingWebhookSecret, serializeRule,
} from '../alerts/_rules.js';

export const MAX_RULES_PER_USER = 50;

/** A designed failure with the HTTP status the REST surface answers with. */
export class AlertRuleError extends Error {
	constructor(code, message, status = 400, issues = undefined) {
		super(message);
		this.code = code;
		this.status = status;
		if (issues) this.issues = issues;
	}
}

const newSecret = () => `whsec_${randomToken(24)}`;

/**
 * Every rule the user owns (or just one), newest first, with its last fire and
 * the five most recent delivery attempts. Heals any webhook rule that is
 * missing its signing secret before returning it.
 */
export async function listAlertRules(userId, { ruleId = null } = {}) {
	const rows = await sql`
		SELECT r.id, r.kind, r.target_mint, r.target_agent, r.target_market, r.target_side,
		       r.direction, r.threshold, r.filters,
		       r.deliver_in_app, r.webhook_url, r.webhook_secret, r.telegram_chat,
		       r.cooldown_seconds, r.enabled, r.label, r.created_at, r.updated_at,
		       f.last_fired_at,
		       coalesce(fail.cnt, 0) AS recent_failures,
		       coalesce(rd.deliveries, '[]'::json) AS recent_deliveries
		FROM pump_alert_rules r
		LEFT JOIN pump_alert_rule_fires f ON f.rule_id = r.id
		LEFT JOIN LATERAL (
			SELECT count(*)::int AS cnt
			FROM pump_alert_deliveries d
			WHERE d.rule_id = r.id AND d.ok = false AND d.created_at > now() - interval '24 hours'
		) fail ON true
		LEFT JOIN LATERAL (
			SELECT json_agg(json_build_object('channel', s.channel, 'ok', s.ok, 'detail', s.detail, 'at', s.created_at) ORDER BY s.created_at DESC) AS deliveries
			FROM (
				SELECT channel, ok, detail, created_at
				FROM pump_alert_deliveries d2
				WHERE d2.rule_id = r.id
				ORDER BY created_at DESC
				LIMIT 5
			) s
		) rd ON true
		WHERE r.user_id = ${userId}
		  AND (${ruleId}::uuid IS NULL OR r.id = ${ruleId}::uuid)
		ORDER BY r.created_at DESC
	`;
	await healWebhookSecrets(rows);
	return rows.map(serializeRule);
}

/**
 * Back-fill a signing secret for any listed rule that has a webhook but none,
 * mutating the rows in place so the caller serializes the healed value. Those
 * rules deliver unsigned webhooks until this runs, and the list response is
 * where the user reads the secret to configure verification on their receiver.
 * Costs nothing in the normal case: the scan is in-memory and issues no query
 * unless a rule is actually missing its secret.
 */
async function healWebhookSecrets(rows) {
	for (const row of rulesMissingWebhookSecret(rows)) {
		const [updated] = await sql`
			UPDATE pump_alert_rules SET webhook_secret = ${newSecret()}, updated_at = now()
			WHERE id = ${row.id} AND webhook_secret IS NULL
			RETURNING webhook_secret, updated_at
		`;
		if (updated) {
			row.webhook_secret = updated.webhook_secret;
			row.updated_at = updated.updated_at;
		}
	}
}

async function assertAgentExists(agentId) {
	const [agent] = await sql`SELECT 1 AS ok FROM agent_identities WHERE id = ${agentId}`;
	if (!agent) throw new AlertRuleError('validation_error', 'target_agent does not exist');
}

/** Validate and insert one rule. Throws AlertRuleError on a refusal. */
export async function createAlertRule(userId, input) {
	const body = normalizeForKind(parse(createRuleSchema, input || {}));
	if (body.target_agent) await assertAgentExists(body.target_agent);

	const [{ count }] = await sql`SELECT count(*)::int AS count FROM pump_alert_rules WHERE user_id = ${userId}`;
	if (count >= MAX_RULES_PER_USER) {
		throw new AlertRuleError('limit_reached', `you can have at most ${MAX_RULES_PER_USER} alert rules`, 409);
	}

	// A per-rule signing secret whenever a webhook is configured, so the
	// receiver can verify the webhook-signature header.
	const webhookSecret = body.webhook_url ? newSecret() : null;

	const [row] = await sql`
		INSERT INTO pump_alert_rules
			(user_id, kind, target_mint, target_agent, target_market, target_side, direction,
			 threshold, filters, deliver_in_app,
			 webhook_url, webhook_secret, telegram_chat, cooldown_seconds, enabled, label)
		VALUES
			(${userId}, ${body.kind}, ${body.target_mint || null}, ${body.target_agent || null},
			 ${body.target_market || null}, ${body.target_side || null}, ${body.direction || null},
			 ${body.threshold ?? null}, ${body.filters ? JSON.stringify(body.filters) : null}::jsonb,
			 ${body.deliver_in_app}, ${body.webhook_url || null},
			 ${webhookSecret}, ${body.telegram_chat || null}, ${body.cooldown_seconds},
			 ${body.enabled}, ${body.label || null})
		RETURNING id, kind, target_mint, target_agent, target_market, target_side, direction,
		          threshold, filters, deliver_in_app,
		          webhook_url, webhook_secret, telegram_chat, cooldown_seconds, enabled,
		          label, created_at, updated_at
	`;
	return serializeRule({ ...row, last_fired_at: null, recent_failures: 0, recent_deliveries: [] });
}

/** Merge a partial update over the user's rule. Returns null when it is not theirs. */
export async function updateAlertRule(userId, ruleId, patchInput) {
	const [current] = await sql`
		SELECT id, kind, target_mint, target_agent, target_market, target_side, direction,
		       threshold, filters, deliver_in_app,
		       webhook_url, webhook_secret, telegram_chat, cooldown_seconds, enabled, label
		FROM pump_alert_rules
		WHERE id = ${ruleId} AND user_id = ${userId}
	`;
	if (!current) return null;

	const patch = parse(updateRuleSchema, patchInput || {});
	const result = validateUpdate(current, patch);
	if (!result.ok) throw new AlertRuleError('validation_error', result.message, 400, result.issues);
	const next = result.value;
	if (next.target_agent && next.target_agent !== current.target_agent) await assertAgentExists(next.target_agent);

	// Webhook secret lifecycle: mint one when a webhook is newly configured,
	// drop it when the webhook is removed, otherwise keep the existing secret.
	let webhookSecret = current.webhook_secret;
	if (!next.webhook_url) webhookSecret = null;
	else if (!current.webhook_url || !current.webhook_secret) webhookSecret = newSecret();

	await sql`
		UPDATE pump_alert_rules SET
			kind             = ${next.kind},
			target_mint      = ${next.target_mint || null},
			target_agent     = ${next.target_agent || null},
			target_market    = ${next.target_market || null},
			target_side      = ${next.target_side || null},
			direction        = ${next.direction || null},
			threshold        = ${next.threshold ?? null},
			filters          = ${next.filters ? JSON.stringify(next.filters) : null}::jsonb,
			deliver_in_app   = ${next.deliver_in_app},
			webhook_url      = ${next.webhook_url || null},
			webhook_secret   = ${webhookSecret},
			telegram_chat    = ${next.telegram_chat || null},
			cooldown_seconds = ${next.cooldown_seconds},
			enabled          = ${next.enabled},
			label            = ${next.label || null},
			updated_at       = now()
		WHERE id = ${ruleId} AND user_id = ${userId}
	`;
	// The row can be gone by now if a concurrent delete landed between the
	// update and this read; that is a plain "not there anymore".
	const [rule] = await listAlertRules(userId, { ruleId });
	return rule || null;
}

/** Delete the user's rule (its fires and delivery log cascade). Returns the id, or null. */
export async function deleteAlertRule(userId, ruleId) {
	const [row] = await sql`DELETE FROM pump_alert_rules WHERE id = ${ruleId} AND user_id = ${userId} RETURNING id`;
	return row ? row.id : null;
}
