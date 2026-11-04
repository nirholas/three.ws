// The LongCat talking-avatar worker runs on a Compute Engine GPU host that stops
// itself when idle (workers/longcat/scripts/idle-shutdown.mjs). When a caller
// arrives while it is stopped, the worker URL answers with a socket error or a
// proxy 502/504. This module turns that into a typed, retryable answer and starts
// the host, so the visitor sees "capacity unavailable, retry in a few minutes"
// and the next attempt lands on a booted GPU.
//
// Waking is gated twice: platform-wide rate limits (one wake per 5 minutes, a
// daily ceiling) and the host's own GPU-hour cap enforced by
// workers/longcat/scripts/host.mjs. LONGCAT_GCE_INSTANCE ("project/zone/name")
// enables the wake; without it the answer is the typed retry alone.

import { limits } from './rate-limit.js';
import { getGcpAccessToken } from './gcp-auth.js';
import { fetchUpstream } from './upstream-fetch.js';
import { error } from './http.js';

export const CAPACITY_RETRY_SECONDS = 240;

/** True when the worker did not answer at all, or a proxy in front of it did not reach the worker. */
export function isCapacityFailure({ err, status } = {}) {
	if (err) return true;
	return status === 502 || status === 504;
}

export function parseInstanceRef(value) {
	const parts = String(value || '').split('/').filter(Boolean);
	if (parts.length !== 3 || parts.some((p) => !/^[a-z0-9][a-z0-9-]*$/i.test(p))) return null;
	return { project: parts[0], zone: parts[1], name: parts[2] };
}

/**
 * Best-effort host start. Never throws: the caller already has a failure to report.
 * @returns {Promise<'started'|'already_running'|'throttled'|'disabled'|'failed'>}
 */
export async function requestHostWake({
	instance = process.env.LONGCAT_GCE_INSTANCE,
	rateLimits = limits,
	getToken = getGcpAccessToken,
	fetcher = fetchUpstream,
} = {}) {
	const ref = parseInstanceRef(instance);
	if (!ref) return 'disabled';
	try {
		const [burst, daily] = await Promise.all([rateLimits.longcatWakeBurst(), rateLimits.longcatWakeDaily()]);
		if (!burst.success || !daily.success) return 'throttled';
		const token = await getToken();
		const base = `https://compute.googleapis.com/compute/v1/projects/${ref.project}/zones/${ref.zone}/instances/${ref.name}`;
		const headers = { authorization: `Bearer ${token}` };
		const current = await fetcher(base, { headers }, { name: 'longcat-gce', timeoutMs: 8_000, attempts: 2 });
		if (current.ok) {
			const body = await current.json();
			if (body.status === 'RUNNING' || body.status === 'PROVISIONING' || body.status === 'STAGING') {
				return 'already_running';
			}
		}
		const started = await fetcher(`${base}/start`, { method: 'POST', headers }, { name: 'longcat-gce', timeoutMs: 15_000, attempts: 1 });
		return started.ok ? 'started' : 'failed';
	} catch (err) {
		console.error('[longcat-host] wake failed:', err?.message || err);
		return 'failed';
	}
}

/**
 * Respond 503 capacity_unavailable with a Retry-After, after kicking off a wake.
 * `operation` names the call for the message.
 */
export async function respondCapacityUnavailable(res, { wake = requestHostWake } = {}) {
	const woke = await wake();
	res.setHeader('retry-after', String(CAPACITY_RETRY_SECONDS));
	return error(
		res,
		503,
		'capacity_unavailable',
		'The video renderer is warming up. Try again in a few minutes.',
		{ retry_after_seconds: CAPACITY_RETRY_SECONDS, host: woke === 'started' || woke === 'already_running' ? 'starting' : 'stopped' },
	);
}
