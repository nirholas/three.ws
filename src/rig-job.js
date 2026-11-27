/**
 * Browser client for one auto-rig job: POST /api/forge?action=rig, then poll
 * GET /api/forge?job=<id> until the rigged GLB is ready. The same contract the
 * Forge "Rig for animation" button uses (src/forge-rig.js); /pose uses this one
 * to rig a model that arrived without a skeleton, so a motion can play on it.
 *
 * Every message comes from the Forge copy map (src/forge-errors.js), never from
 * the rigger's raw output.
 */

import { forgeErrorFromResponse, forgeJobFailedError } from './forge-errors.js';

export const RIG_POLL_INTERVAL_MS = 2500;
export const RIG_MAX_POLL_MS = 4 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} glbUrl  public http(s) URL of the mesh to rig
 * @param {{ isCurrent?: () => boolean, fetchImpl?: typeof fetch, pollMs?: number, maxPollMs?: number }} [opts]
 * @returns {Promise<{ glbUrl: string, eta: number|null } | null>} null when superseded
 */
export async function runRigJob(glbUrl, opts = {}) {
	const isCurrent = opts.isCurrent ?? (() => true);
	const doFetch = opts.fetchImpl ?? ((...a) => fetch(...a));
	const pollMs = opts.pollMs ?? RIG_POLL_INTERVAL_MS;
	const maxPollMs = opts.maxPollMs ?? RIG_MAX_POLL_MS;

	let res;
	try {
		res = await doFetch('/api/forge?action=rig', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ glb_url: glbUrl }),
		});
	} catch {
		throw forgeErrorFromResponse(0, {});
	}
	const sub = await res.json().catch(() => ({}));
	if (res.status === 501 || sub.error === 'rig_unconfigured') {
		const e = forgeErrorFromResponse(res.status, { ...sub, error: 'rig_unconfigured' });
		e.kind = 'unconfigured';
		throw e;
	}
	if (!res.ok) throw forgeErrorFromResponse(res.status, sub);
	if (!sub.job_id) throw forgeErrorFromResponse(res.status, { error: 'rig_failed' });
	opts.onQueued?.({ eta: typeof sub.eta_seconds === 'number' ? sub.eta_seconds : null });

	const deadline = Date.now() + maxPollMs;
	while (isCurrent() && Date.now() < deadline) {
		await sleep(pollMs);
		if (!isCurrent()) return null;
		let poll;
		try {
			poll = await doFetch(`/api/forge?job=${encodeURIComponent(sub.job_id)}`, { credentials: 'include' });
		} catch {
			// A dropped connection mid-poll is not a failed job: keep polling.
			continue;
		}
		const data = await poll.json().catch(() => ({}));
		if (data.status === 'done' && data.glb_url) return { glbUrl: data.glb_url, eta: sub.eta_seconds ?? null };
		if (data.status === 'failed') throw forgeJobFailedError(data.error, 'rig_failed');
		if (poll.status === 404 || data.error === 'invalid_job' || data.error === 'missing_job') {
			throw forgeErrorFromResponse(poll.status, data);
		}
	}
	if (!isCurrent()) return null;
	const e = new Error('Rigging is taking longer than it should. Try again: a GPU that was asleep can take a minute to start.');
	e.title = 'Auto-rig is taking too long';
	throw e;
}
