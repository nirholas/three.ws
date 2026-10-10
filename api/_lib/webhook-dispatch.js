// Outgoing webhooks: a durable, signed, retried delivery queue for
// developer-registered endpoints.
//
// Signature (Standard Webhooks format):
//   webhook-id:        the event ID, stable across retries and replays
//   webhook-timestamp: unix epoch seconds of THIS attempt
//   webhook-signature: v1,{base64url HMAC-SHA256 of `${id}.${timestamp}.${body}`}
//
// Delivery model (migration 20261010170000_agent_webhook_queue.sql):
//   • Raising an event writes one webhook_deliveries row per matching endpoint
//     (status 'pending'), then attempts each one immediately, fire-and-forget.
//     Callers never wait on a receiver.
//   • A failed attempt is appended to the row's `attempts` log and the row is
//     rescheduled with backoff (RETRY_SCHEDULE_MS). The every-minute cron
//     (api/cron/webhook-deliveries.js) runs `sweepWebhookDeliveries`, which
//     posts whatever is due, so a retry survives a recycled process.
//   • A row is claimed with a lease before it is posted, so the inline attempt
//     and the sweep can never deliver the same row concurrently.
//   • An endpoint that keeps failing is switched off (DISABLE_AFTER_FAILURES).
//   • `replayDelivery` re-sends a past delivery as a new row linked through
//     `replay_of`, with the original event ID so receivers can deduplicate.

import { sql } from './db.js';
import { randomToken, hmacSha256 } from './crypto.js';
import { validatePublicUrl, resolvePublicHost, pinnedAgent, SsrfError } from './ssrf.js';

const DELIVERY_TIMEOUT_MS = 10_000;
const LEASE_SECONDS = 30;
const RESPONSE_BODY_MAX = 1024;

// Delay before attempt n+1, after attempt n failed. Eight attempts spread over
// roughly twelve hours, then the delivery is marked failed and can be replayed.
export const RETRY_SCHEDULE_MS = Object.freeze([
	30_000, // 30 s
	2 * 60_000, // 2 min
	10 * 60_000, // 10 min
	30 * 60_000, // 30 min
	60 * 60_000, // 1 h
	3 * 60 * 60_000, // 3 h
	8 * 60 * 60_000, // 8 h
]);
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

// Failed attempts in a row, with no success in the last 24 hours, before an
// endpoint is set inactive. Re-enable with PATCH { active: true }.
export const DISABLE_AFTER_FAILURES = 50;

const EVENT_TYPES = [
	'avatar.created',
	'avatar.updated',
	'avatar.deleted',
	'avatar.appearance.changed',
	'agent.created',
	'agent.updated',
	'agent.deleted',
	// Generation jobs. A forge job is asynchronous and can outlive the browser
	// that started it (see docs/forge-background-generation.md), so an
	// integrator who submits over the API has no way to learn the outcome
	// except by polling. These two events close that: they fire from the two
	// universal terminal writers in forge-store.js (materializeCreation and
	// markFailed), which every lane flows through, so a job that finishes on
	// the free browser lane, the x402 paid lane or the unattended finalizer
	// all deliver the same event exactly once.
	'forge.completed',
	'forge.failed',
	// Agent activity (the v1 agents API, docs/api-reference.md). Each carries
	// `agent_id`, so an endpoint narrowed to one agent only hears that agent.
	'run.finished', // a run reached completed, failed, cancelled or budget_exhausted
	'automation.fired', // an automation's trigger matched and its action ran
	'message.received', // a user message was added to an agent's thread
	'approval.needed', // an agent action is waiting for the owner's approval
];

// Sent only by POST /api/v1/webhooks/:id/test, to that one endpoint, whatever
// it subscribes to. Not subscribable.
export const TEST_EVENT_TYPE = 'webhook.test';

export { EVENT_TYPES };

/**
 * Resolve a caller-supplied event subscription into the list to store.
 *
 * Two failure modes this closes, both of which produced a webhook that looked
 * healthy in the dashboard and never fired:
 *
 *   - An unknown name (a typo like "avatar.create") was silently filtered out.
 *     It is an error now, and the caller gets the offending names back plus the
 *     full menu of valid ones.
 *   - An omitted or empty list became `[]`, i.e. subscribed to nothing, even
 *     though docs/developer-platform.md has always documented it as "all
 *     events". The documented contract wins.
 *
 * @param {unknown} raw - the request's `events` value.
 * @returns {{ events: string[] } | { error: string }}
 */
export function selectEventTypes(raw) {
	if (raw === undefined || raw === null) return { events: [...EVENT_TYPES] };
	if (!Array.isArray(raw)) return { error: 'events must be an array of event types' };
	const unknown = raw.filter((e) => !EVENT_TYPES.includes(e));
	if (unknown.length) {
		return {
			error: `unknown event type(s): ${unknown.join(', ')}. Valid types: ${EVENT_TYPES.join(', ')}`,
		};
	}
	const events = [...new Set(raw)];
	return { events: events.length ? events : [...EVENT_TYPES] };
}

/**
 * Loopback and plain-http receivers are refused in production. Outside it, the
 * operator can opt in with WEBHOOKS_ALLOW_PRIVATE_TARGETS=1 to point an
 * endpoint at a receiver on their own machine.
 */
export function privateTargetsAllowed() {
	return process.env.NODE_ENV !== 'production' && process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS === '1';
}

/** A fresh signing secret. */
export function newWebhookSecret() {
	return `whsec_${randomToken(24)}`;
}

/** A fresh event ID. */
export function newEventId() {
	return `evt_${randomToken(16)}`;
}

function envelope(eventId, eventType, data) {
	return { id: eventId, type: eventType, created_at: new Date().toISOString(), data };
}

/**
 * Raise an event for every matching endpoint the user owns.
 *
 * Resolves once the delivery rows are written; the HTTP attempts run in the
 * background. Never throws: a webhook outage must not fail the caller's work.
 *
 * @param {object} o
 * @param {string} o.userId
 * @param {string} o.eventType   one of EVENT_TYPES
 * @param {object} o.data
 * @param {string} [o.agentId]   the agent the event concerns; endpoints narrowed
 *                               to a different agent are skipped
 * @param {string} [o.eventId]   a deterministic ID, so raising the same event
 *                               twice delivers it once per endpoint
 * @returns {Promise<string[]>}  the delivery IDs written
 */
export async function dispatchWebhooks({ userId, eventType, data, agentId = null, eventId = null }) {
	if (!userId || !EVENT_TYPES.includes(eventType)) return [];
	const id = eventId || newEventId();
	const payload = envelope(id, eventType, data ?? {});
	let rows;
	try {
		rows = await sql`
			insert into webhook_deliveries
				(webhook_id, event_type, event_id, payload, attempt, status, next_attempt_at)
			select w.id, ${eventType}, ${id}, ${JSON.stringify(payload)}::jsonb, 0, 'pending', now()
			from developer_webhooks w
			where w.user_id = ${userId}
			  and w.active = true
			  and (w.events @> ARRAY[${eventType}]::text[] or cardinality(w.events) = 0)
			  and (w.agent_id is null or w.agent_id = ${agentId})
			on conflict (webhook_id, event_id) where status is not null and replay_of is null do nothing
			returning id
		`;
	} catch (err) {
		console.warn('[webhooks] enqueue failed:', eventType, err?.message);
		return [];
	}
	const ids = rows.map((r) => r.id);
	for (const deliveryId of ids) processDelivery(deliveryId).catch(() => {});
	return ids;
}

/**
 * Queue a `webhook.test` ping to one endpoint and attempt it now. Awaited, so
 * the caller can show the outcome.
 */
export async function sendTestEvent(webhook) {
	const id = newEventId();
	const payload = envelope(id, TEST_EVENT_TYPE, {
		webhook_id: webhook.id,
		message: 'This is a test delivery from three.ws. Verify its signature with your whsec_ secret.',
	});
	const [row] = await sql`
		insert into webhook_deliveries
			(webhook_id, event_type, event_id, payload, attempt, status, next_attempt_at)
		values (${webhook.id}, ${TEST_EVENT_TYPE}, ${id}, ${JSON.stringify(payload)}::jsonb, 0, 'pending', now())
		returning id
	`;
	await processDelivery(row.id);
	return row.id;
}

/**
 * Re-send a past delivery to its endpoint as a new delivery row. The event ID
 * and payload are the original's; the attempt history starts fresh.
 */
export async function replayDelivery(delivery) {
	const original = delivery.replay_of || delivery.id;
	const [row] = await sql`
		insert into webhook_deliveries
			(webhook_id, event_type, event_id, payload, attempt, status, next_attempt_at, replay_of)
		select webhook_id, event_type, event_id, payload, 0, 'pending', now(), ${original}
		from webhook_deliveries where id = ${delivery.id}
		returning id
	`;
	if (!row) return null;
	await processDelivery(row.id);
	return row.id;
}

/**
 * Post every due delivery. Called by the every-minute cron. Rows whose lease
 * expired (a worker died mid-attempt) go back to pending first.
 *
 * @returns {Promise<{ reclaimed: number, attempted: number, succeeded: number }>}
 */
export async function sweepWebhookDeliveries({ limit = 100, concurrency = 8, deadlineMs = 50_000 } = {}) {
	const started = Date.now();
	const reclaimed = await sql`
		update webhook_deliveries
		set status = 'pending', lease_until = null, updated_at = now()
		where status = 'delivering' and lease_until < now()
		returning id
	`;
	const due = await sql`
		select id from webhook_deliveries
		where status = 'pending' and next_attempt_at <= now()
		order by next_attempt_at
		limit ${limit}
	`;
	const queue = due.map((r) => r.id);
	let attempted = 0;
	let succeeded = 0;
	async function worker() {
		while (queue.length && Date.now() - started < deadlineMs) {
			const id = queue.shift();
			const outcome = await processDelivery(id).catch(() => null);
			if (!outcome) continue;
			attempted += 1;
			if (outcome.status === 'succeeded') succeeded += 1;
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
	return { reclaimed: reclaimed.length, attempted, succeeded };
}

/**
 * Claim one due delivery, post it, and record the attempt.
 * Returns null when the row was not claimable (not due, or another worker has it).
 */
export async function processDelivery(deliveryId) {
	const [row] = await sql`
		update webhook_deliveries d
		set status = 'delivering',
		    lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
		    updated_at = now()
		from developer_webhooks w
		where d.id = ${deliveryId}
		  and d.webhook_id = w.id
		  and d.status = 'pending'
		  and d.next_attempt_at <= now()
		returning d.id, d.event_id, d.event_type, d.payload, d.attempt,
		          w.id as webhook_id, w.url, w.secret, w.active
	`;
	if (!row) return null;

	if (!row.active) {
		const attempt = { at: new Date().toISOString(), status_code: null, error: 'endpoint_disabled', duration_ms: 0 };
		await sql`
			update webhook_deliveries
			set status = 'failed', error = 'endpoint_disabled', lease_until = null, next_attempt_at = null,
			    attempts = attempts || ${JSON.stringify([attempt])}::jsonb, updated_at = now()
			where id = ${row.id}
		`;
		return { status: 'failed', attempt };
	}

	const body = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
	const t0 = Date.now();
	const result = await deliver(row.url, row.secret, row.event_id, body);
	const durationMs = Date.now() - t0;
	const attemptNo = Number(row.attempt || 0) + 1;
	const ok = result.statusCode >= 200 && result.statusCode < 300;
	const attempt = {
		n: attemptNo,
		at: new Date(t0).toISOString(),
		status_code: result.statusCode,
		error: result.error,
		duration_ms: durationMs,
		response_body: result.responseBody,
	};
	const exhausted = !ok && attemptNo >= MAX_ATTEMPTS;
	const status = ok ? 'succeeded' : exhausted ? 'failed' : 'pending';
	const nextAt = status === 'pending' ? new Date(Date.now() + backoffMs(attemptNo)) : null;

	await sql`
		update webhook_deliveries
		set status = ${status},
		    attempt = ${attemptNo},
		    status_code = ${result.statusCode},
		    response_body = ${result.responseBody},
		    error = ${result.error},
		    duration_ms = ${durationMs},
		    delivered_at = ${ok ? new Date() : null},
		    next_attempt_at = ${nextAt},
		    lease_until = null,
		    attempts = attempts || ${JSON.stringify([attempt])}::jsonb,
		    updated_at = now()
		where id = ${row.id}
	`;
	await recordEndpointHealth(row.webhook_id, ok);
	return { status, attempt, nextAttemptAt: nextAt };
}

/** Delay after failed attempt n, with up to 10% jitter so retries do not stampede. */
export function backoffMs(attemptNo) {
	const base = RETRY_SCHEDULE_MS[Math.min(attemptNo, RETRY_SCHEDULE_MS.length) - 1] ?? RETRY_SCHEDULE_MS[0];
	return Math.round(base * (1 + Math.random() * 0.1));
}

async function recordEndpointHealth(webhookId, ok) {
	try {
		if (ok) {
			await sql`
				update developer_webhooks
				set consecutive_failures = 0, last_success_at = now()
				where id = ${webhookId}
			`;
			return;
		}
		await sql`
			update developer_webhooks
			set consecutive_failures = consecutive_failures + 1,
			    last_failure_at = now(),
			    active = case
			      when consecutive_failures + 1 >= ${DISABLE_AFTER_FAILURES}
			       and (last_success_at is null or last_success_at < now() - interval '24 hours')
			      then false else active end,
			    disabled_reason = case
			      when consecutive_failures + 1 >= ${DISABLE_AFTER_FAILURES}
			       and (last_success_at is null or last_success_at < now() - interval '24 hours')
			      then 'consecutive_failures' else disabled_reason end,
			    updated_at = now()
			where id = ${webhookId}
		`;
	} catch (err) {
		console.warn('[webhooks] endpoint health update failed:', err?.message);
	}
}

/**
 * Validate a receiver URL for registration: HTTPS to a public address in
 * production. Returns an error string, or null when the URL is acceptable.
 */
export async function webhookUrlProblem(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return 'url is required';
	const url = raw.trim();
	if (url.length > 2048) return 'url exceeds 2048 characters';
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return 'url is not a valid URL';
	}
	if (privateTargetsAllowed() && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return null;
	if (parsed.protocol !== 'https:') return 'Webhook URL must use HTTPS';
	try {
		validatePublicUrl(url, { allowHttp: false });
		await resolvePublicHost(parsed.hostname);
	} catch {
		return 'Webhook URL must resolve to a public address';
	}
	return null;
}

async function deliver(url, secret, eventId, body) {
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = await hmacSha256(secret, `${eventId}.${timestamp}.${body}`);

	// SSRF guard: the URL is developer-supplied, so resolve it and pin the
	// connection to the validated public address(es). Without this, a webhook
	// pointed at 169.254.169.254 / localhost / RFC-1918 (directly or via a public
	// host that 30x-redirects inward) would have the server POST to an internal
	// target and persist the status/error as a probing oracle. Redirects are NOT
	// followed (manual) so a public host can't bounce the request internally.
	let target;
	let agent = null;
	try {
		if (privateTargetsAllowed()) {
			target = new URL(url);
		} else {
			target = validatePublicUrl(url, { allowHttp: false });
			const addrs = await resolvePublicHost(target.hostname);
			agent = pinnedAgent(target.hostname, addrs);
		}
	} catch (err) {
		const reason = err instanceof SsrfError ? `blocked_url:${err.code}` : 'invalid_url';
		return { statusCode: null, responseBody: null, error: reason };
	}

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

		let res;
		try {
			res = await fetch(target, {
				method: 'POST',
				redirect: 'manual',
				...(agent ? { dispatcher: agent } : {}),
				headers: {
					'content-type': 'application/json',
					'webhook-id': eventId,
					'webhook-timestamp': String(timestamp),
					'webhook-signature': `v1,${signature}`,
					'user-agent': 'three.ws-webhooks/1.0',
				},
				body,
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
			if (agent) await agent.close().catch(() => {});
		}

		// A redirect is a misconfigured (or hostile) endpoint: record it as a
		// failure instead of following it to a potentially internal target.
		if (res.status >= 300 && res.status < 400) {
			return { statusCode: res.status, responseBody: null, error: 'redirect_not_followed' };
		}

		let responseBody = null;
		try {
			responseBody = await res.text();
			if (responseBody.length > RESPONSE_BODY_MAX) responseBody = responseBody.slice(0, RESPONSE_BODY_MAX);
		} catch {
			responseBody = null;
		}
		const error = res.status >= 200 && res.status < 300 ? null : `http_${res.status}`;
		return { statusCode: res.status, responseBody, error };
	} catch (err) {
		const error = err?.name === 'AbortError' ? 'timeout' : err?.cause?.code || err?.message || 'delivery_failed';
		return { statusCode: null, responseBody: null, error };
	}
}
