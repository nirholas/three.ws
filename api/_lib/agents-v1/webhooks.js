// v1 webhooks: endpoints, the delivery log, test pings and replays.
//
// A developer registers an HTTPS endpoint and picks events (run.finished,
// automation.fired, message.received, approval.needed, plus the account-level
// ones in EVENT_TYPES). Every event becomes one webhook_deliveries row per
// endpoint that the durable queue in api/_lib/webhook-dispatch.js posts,
// retries with backoff, and logs attempt by attempt. These functions are the
// v1 face over that queue; the dashboard's /api/developer/webhooks routes read
// the same tables.
//
// Signing follows the Standard Webhooks scheme (`webhook-id`,
// `webhook-timestamp`, `webhook-signature` over `${id}.${timestamp}.${body}`),
// so the official verifier libraries accept it; signatureHeader in
// api/_lib/webhook-dispatch.js documents the two signatures it carries.

import { sql } from '../db.js';
import { getDevSubscription } from '../dev-plans/subscription.js';
import {
	EVENT_TYPES,
	TEST_EVENT_TYPE,
	MAX_ATTEMPTS,
	RETRY_SCHEDULE_MS,
	newWebhookSecret,
	replayDelivery,
	selectEventTypes,
	sendTestEvent,
	webhookUrlProblem,
} from '../webhook-dispatch.js';
import { apiError, intParam, page, requireUuid, strParam } from './http.js';
import { loadOwnedAgent } from './agents.js';

const DELIVERY_STATUSES = ['pending', 'delivering', 'succeeded', 'failed'];

// Events scoped to one agent: an endpoint narrowed to an agent receives only
// these, and only for that agent. The rest are account-level.
export const AGENT_EVENT_TYPES = Object.freeze(['run.finished', 'automation.fired', 'message.received', 'approval.needed']);

export function serializeWebhook(w) {
	return {
		id: w.id,
		url: w.url,
		description: w.description || null,
		events: w.events || [],
		agentId: w.agent_id || null,
		active: w.active,
		disabledReason: w.disabled_reason || null,
		consecutiveFailures: w.consecutive_failures ?? 0,
		lastSuccessAt: w.last_success_at || null,
		lastFailureAt: w.last_failure_at || null,
		createdAt: w.created_at,
		updatedAt: w.updated_at || null,
	};
}

/** A delivery row. Legacy rows (status NULL, one row per attempt) read as one finished attempt. */
export function serializeDelivery(d, { withPayload = false } = {}) {
	const legacyOk = d.status_code >= 200 && d.status_code < 300;
	const status = d.status || (legacyOk ? 'succeeded' : 'failed');
	const attempts = Array.isArray(d.attempts) && d.attempts.length
		? d.attempts
		: d.status
			? []
			: [{ n: d.attempt, at: d.created_at, status_code: d.status_code, error: d.error, duration_ms: null }];
	const out = {
		id: d.id,
		webhookId: d.webhook_id,
		eventId: d.event_id,
		eventType: d.event_type,
		status,
		attemptCount: Number(d.attempt || 0),
		maxAttempts: MAX_ATTEMPTS,
		attempts: attempts.map((a) => ({
			n: a.n ?? null,
			at: a.at,
			statusCode: a.status_code ?? null,
			error: a.error ?? null,
			durationMs: a.duration_ms ?? null,
			...(withPayload ? { responseBody: a.response_body ?? null } : {}),
		})),
		statusCode: d.status_code ?? null,
		error: d.error || null,
		nextAttemptAt: d.next_attempt_at || null,
		deliveredAt: d.delivered_at || null,
		durationMs: d.duration_ms ?? null,
		replayOf: d.replay_of || null,
		createdAt: d.created_at,
		updatedAt: d.updated_at || null,
	};
	if (withPayload) {
		out.payload = typeof d.payload === 'string' ? JSON.parse(d.payload) : d.payload;
		out.responseBody = d.response_body ?? null;
	}
	return out;
}

/** The event catalog a developer subscribes from. */
export function eventCatalog() {
	return {
		events: EVENT_TYPES.map((type) => ({ type, agentScoped: AGENT_EVENT_TYPES.includes(type) })),
		testEvent: TEST_EVENT_TYPE,
		retrySchedule: RETRY_SCHEDULE_MS.map((ms) => Math.round(ms / 1000)),
		maxAttempts: MAX_ATTEMPTS,
		signature: {
			scheme: 'standard-webhooks',
			headers: ['webhook-id', 'webhook-timestamp', 'webhook-signature'],
			signedContent: '${webhook-id}.${webhook-timestamp}.${body}',
			algorithm: 'HMAC-SHA256 keyed by the base64-decoded secret after "whsec_", base64, prefixed "v1,"',
			secretFormat: 'whsec_ followed by base64',
			note: 'The header lists two space-separated v1 signatures; accept the request when any one matches. The second is the original three.ws signature (base64url HMAC keyed by the whole whsec_ string) kept for receivers built before the switch.',
		},
	};
}

async function ownedWebhook(userId, id) {
	requireUuid(id, 'webhook');
	const [row] = await sql`SELECT * FROM developer_webhooks WHERE id = ${id} AND user_id = ${userId}`;
	if (!row) throw apiError(404, 'not_found', 'No webhook with that id.');
	return row;
}

async function urlParam(raw) {
	const url = strParam(raw, { name: 'url', max: 2048, required: true });
	const problem = await webhookUrlProblem(url);
	if (problem) throw apiError(400, 'invalid_url', problem, { parameter: 'url' });
	return url;
}

function eventsParam(raw) {
	const selection = selectEventTypes(raw);
	if (selection.error) throw apiError(400, 'invalid_parameter', selection.error, { parameter: 'events', known: EVENT_TYPES });
	return selection.events;
}

async function agentParam(raw, userId) {
	if (raw == null || raw === '') return null;
	const id = requireUuid(raw, 'agent');
	await loadOwnedAgent(id, userId);
	return id;
}

function descriptionParam(raw) {
	if (raw == null) return null;
	if (typeof raw !== 'string') throw apiError(400, 'invalid_parameter', 'description must be a string.', { parameter: 'description' });
	return raw.trim().slice(0, 200) || null;
}

/** The caller's endpoints, newest first, keyset-paginated. */
export async function listWebhooks(userId, query) {
	const limit = intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 });
	let anchor = null;
	if (query.cursor) {
		requireUuid(query.cursor, 'cursor');
		[anchor] = await sql`SELECT created_at, id FROM developer_webhooks WHERE id = ${query.cursor} AND user_id = ${userId}`;
		if (!anchor) throw apiError(400, 'invalid_cursor', 'cursor must be a value returned in meta.nextCursor.', { parameter: 'cursor' });
	}
	const rows = await sql`
		SELECT * FROM developer_webhooks
		WHERE user_id = ${userId}
		  AND (${anchor?.created_at ?? null}::timestamptz IS NULL
		       OR (created_at, id) < (${anchor?.created_at ?? null}::timestamptz, ${anchor?.id ?? null}::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT ${limit + 1}
	`;
	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit);
	return page(items.map(serializeWebhook), { hasMore, nextCursor: hasMore ? items.at(-1).id : null });
}

/** Register an endpoint. The signing secret is returned once, here. */
export async function createWebhook(userId, body) {
	const url = await urlParam(body.url);
	const events = eventsParam(body.events);
	const agentId = await agentParam(body.agentId, userId);
	const description = descriptionParam(body.description);
	// The cap is the developer plan's (api/_lib/dev-plans/config.js).
	const [[{ n }], sub] = await Promise.all([
		sql`SELECT count(*)::int AS n FROM developer_webhooks WHERE user_id = ${userId}`,
		getDevSubscription(userId),
	]);
	if (n >= sub.plan.webhooks) {
		throw apiError(409, 'webhook_limit', `The ${sub.plan.name} plan allows ${sub.plan.webhooks} webhooks per account. Delete one first or upgrade at /developers.`);
	}
	const secret = newWebhookSecret();
	const [row] = await sql`
		INSERT INTO developer_webhooks (user_id, url, secret, events, description, agent_id)
		VALUES (${userId}, ${url}, ${secret}, ${events}, ${description}, ${agentId})
		RETURNING *
	`;
	return { ...serializeWebhook(row), secret };
}

/** One endpoint with its 7-day delivery tally. */
export async function getWebhook(userId, id) {
	const row = await ownedWebhook(userId, id);
	const [s] = await sql`
		SELECT count(*)::int AS total,
		       count(*) FILTER (WHERE status = 'succeeded' OR (status IS NULL AND status_code BETWEEN 200 AND 299))::int AS succeeded,
		       count(*) FILTER (WHERE status = 'failed' OR (status IS NULL AND (status_code IS NULL OR status_code >= 400)))::int AS failed,
		       count(*) FILTER (WHERE status IN ('pending', 'delivering'))::int AS pending,
		       max(created_at) AS last_delivery_at
		FROM webhook_deliveries
		WHERE webhook_id = ${row.id} AND created_at > now() - interval '7 days'
	`;
	return {
		...serializeWebhook(row),
		stats7d: { total: s.total, succeeded: s.succeeded, failed: s.failed, pending: s.pending, lastDeliveryAt: s.last_delivery_at },
	};
}

/**
 * Patch url, events, agentId, description or active. Re-enabling an endpoint
 * the failure breaker switched off clears the breaker.
 */
export async function updateWebhook(userId, id, body) {
	const row = await ownedWebhook(userId, id);
	const url = 'url' in body ? await urlParam(body.url) : row.url;
	const events = 'events' in body ? eventsParam(body.events) : row.events;
	const agentId = 'agentId' in body ? await agentParam(body.agentId, userId) : row.agent_id;
	const description = 'description' in body ? descriptionParam(body.description) : row.description;
	let active = row.active;
	if ('active' in body) {
		if (typeof body.active !== 'boolean') throw apiError(400, 'invalid_parameter', 'active must be true or false.', { parameter: 'active' });
		active = body.active;
	}
	const reenable = active && !row.active;
	const [next] = await sql`
		UPDATE developer_webhooks SET
			url = ${url}, events = ${events}, agent_id = ${agentId}, description = ${description}, active = ${active},
			consecutive_failures = CASE WHEN ${reenable} THEN 0 ELSE consecutive_failures END,
			disabled_reason = CASE WHEN ${reenable} THEN NULL ELSE disabled_reason END,
			updated_at = now()
		WHERE id = ${row.id}
		RETURNING *
	`;
	return serializeWebhook(next);
}

export async function deleteWebhook(userId, id) {
	const row = await ownedWebhook(userId, id);
	await sql`DELETE FROM developer_webhooks WHERE id = ${row.id}`;
	return { id: row.id, deleted: true };
}

/** Issue a new signing secret. The old one stops verifying immediately. */
export async function rotateWebhookSecret(userId, id) {
	const row = await ownedWebhook(userId, id);
	const secret = newWebhookSecret();
	const [next] = await sql`UPDATE developer_webhooks SET secret = ${secret}, updated_at = now() WHERE id = ${row.id} RETURNING *`;
	return { ...serializeWebhook(next), secret };
}

async function loadDelivery(id) {
	const [d] = await sql`SELECT * FROM webhook_deliveries WHERE id = ${id}`;
	return d;
}

/** Post a webhook.test ping now and return the delivery with its first attempt. */
export async function testWebhook(userId, id) {
	const row = await ownedWebhook(userId, id);
	if (!row.active) throw apiError(409, 'webhook_disabled', 'This webhook is switched off. Enable it, then send a test.');
	const deliveryId = await sendTestEvent(row);
	return serializeDelivery(await loadDelivery(deliveryId), { withPayload: true });
}

/** One endpoint's delivery log, newest first, filterable by status and event type. */
export async function listDeliveries(userId, webhookId, query) {
	const row = await ownedWebhook(userId, webhookId);
	const limit = intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 });
	const status = strParam(query.status, { name: 'status', max: 20 });
	if (status && !DELIVERY_STATUSES.includes(status)) {
		throw apiError(400, 'invalid_parameter', `status must be one of: ${DELIVERY_STATUSES.join(', ')}.`, { parameter: 'status' });
	}
	const eventType = strParam(query.eventType, { name: 'eventType', max: 64 });
	let anchor = null;
	if (query.cursor) {
		requireUuid(query.cursor, 'cursor');
		[anchor] = await sql`SELECT created_at, id FROM webhook_deliveries WHERE id = ${query.cursor} AND webhook_id = ${row.id}`;
		if (!anchor) throw apiError(400, 'invalid_cursor', 'cursor must be a value returned in meta.nextCursor.', { parameter: 'cursor' });
	}
	// A legacy row has status NULL; it counts as succeeded or failed by its HTTP code.
	const rows = await sql`
		SELECT * FROM webhook_deliveries
		WHERE webhook_id = ${row.id}
		  AND (${status}::text IS NULL
		       OR status = ${status}
		       OR (status IS NULL AND ${status} = 'succeeded' AND status_code BETWEEN 200 AND 299)
		       OR (status IS NULL AND ${status} = 'failed' AND (status_code IS NULL OR status_code >= 400)))
		  AND (${eventType}::text IS NULL OR event_type = ${eventType})
		  AND (${anchor?.created_at ?? null}::timestamptz IS NULL
		       OR (created_at, id) < (${anchor?.created_at ?? null}::timestamptz, ${anchor?.id ?? null}::uuid))
		ORDER BY created_at DESC, id DESC
		LIMIT ${limit + 1}
	`;
	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit);
	return page(items.map((d) => serializeDelivery(d)), { hasMore, nextCursor: hasMore ? items.at(-1).id : null });
}

async function ownedDelivery(userId, id) {
	requireUuid(id, 'delivery');
	const [d] = await sql`
		SELECT d.* FROM webhook_deliveries d
		JOIN developer_webhooks w ON w.id = d.webhook_id
		WHERE d.id = ${id} AND w.user_id = ${userId}
	`;
	if (!d) throw apiError(404, 'not_found', 'No delivery with that id.');
	return d;
}

/** One delivery with its payload and every attempt's response. */
export async function getDelivery(userId, id) {
	return serializeDelivery(await ownedDelivery(userId, id), { withPayload: true });
}

/** Re-send a delivery as a new row with the original event id and payload. */
export async function replayWebhookDelivery(userId, id) {
	const d = await ownedDelivery(userId, id);
	const [w] = await sql`SELECT active FROM developer_webhooks WHERE id = ${d.webhook_id}`;
	if (!w?.active) throw apiError(409, 'webhook_disabled', 'This webhook is switched off. Enable it, then replay.');
	const replayId = await replayDelivery(d);
	return serializeDelivery(await loadDelivery(replayId), { withPayload: true });
}
