/**
 * The Forge page's handle on one generation, kept so that nothing the user does
 * in the browser can lose it or start it twice.
 *
 * A generation is three things in sequence: a POST that can take 30 to 45 s
 * (the art director and the reference image run before the job exists), a job
 * id, and minutes of polling. Each stage had its own way to go wrong:
 *
 *   • a reload or a closed tab during the POST lost the job outright, because
 *     the page only remembered a job once the POST had answered;
 *   • a second click, a held Enter key or a second tab each sent another POST,
 *     and each one started (and was charged as) a separate generation;
 *   • the page forgot a job after 30 minutes, while the server allows a job 45
 *     before it calls it failed.
 *
 * So the record is written BEFORE the POST, holding the exact request and the
 * Idempotency-Key it goes out under. A page that comes back (reload, reopened
 * tab, another tab) resends that same request under that same key, and the
 * server's idempotency layer (api/_lib/forge-idempotency.js) answers with the
 * first job instead of starting a second: 409 idempotency_in_progress while the
 * original POST is still open, the stored answer once it has closed.
 *
 * Everything here is plain logic over injected storage, fetch and clock, so the
 * suite in tests/forge-inflight.test.js drives it without a browser.
 */

import { FORGE_JOB_HARD_TTL_MINUTES } from '../api/_lib/forge-job-deadline.js';

export const INFLIGHT_KEY = 'forge:inflight';

// The server fails a job that has not finished FORGE_JOB_HARD_TTL_MINUTES after
// it was created (api/_lib/forge-job-deadline.js). The record outlives that by
// a margin, so a page reopened late still collects the job's real ending (done,
// or failed with a reason) instead of silently forgetting a job the server was
// still allowed to finish.
export const RESUME_WINDOW_MS = (FORGE_JOB_HARD_TTL_MINUTES + 5) * 60_000;

// How long the POST keeps waiting on a duplicate that is still running. The
// server holds an in-progress key for 300 s (RUNNING_TTL_S), longer than any
// real submit takes.
const DUPLICATE_WAIT_MS = 300_000;

// Fields that differ on every run of the same request: the seed the page mints
// per run, and the trace id of the pre-submit progress channel. A second tab
// typing the same prompt has new values for both and is still the same request.
const PER_RUN_FIELDS = new Set(['seed', 'progress_id']);

function stableStringify(value) {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.filter((k) => value[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/**
 * The identity of a generation request, independent of key order and of the
 * per-run seed and trace id.
 *
 * @param {Record<string, unknown>} body
 * @returns {string}
 */
export function requestFingerprint(body) {
	const kept = {};
	for (const [k, v] of Object.entries(body || {})) if (!PER_RUN_FIELDS.has(k)) kept[k] = v;
	return stableStringify(kept);
}

/** A fresh Idempotency-Key for one generation (36 chars; the server allows 200). */
export function newIdempotencyKey() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether an error leaves the job possibly alive on the server, so the record
 * must be kept for the next page load to collect it.
 *
 * @param {unknown} err
 */
export function keepsInflight(err) {
	return err?.kind === 'transport_lost' || err?.kind === 'still_running';
}

function validRecord(rec) {
	if (!rec || typeof rec !== 'object' || !Number.isFinite(rec.startedAt)) return false;
	if (typeof rec.jobId === 'string' && rec.jobId) return true;
	return rec.phase === 'submitting' && typeof rec.key === 'string' && rec.key && rec.body && typeof rec.body === 'object';
}

/**
 * localStorage-backed record of the one generation this browser is waiting on.
 *
 * @param {{ storage?: Storage, now?: () => number }} [opts]
 */
export function createInflightStore({ storage = globalThis.localStorage, now = () => Date.now() } = {}) {
	function write(rec) {
		try {
			storage.setItem(INFLIGHT_KEY, JSON.stringify(rec));
		} catch {
			// Private mode or a full quota: resume is unavailable, the run itself is not.
		}
	}

	function clear() {
		try {
			storage.removeItem(INFLIGHT_KEY);
		} catch {
			/* storage blocked */
		}
	}

	function read() {
		let raw;
		try {
			raw = storage.getItem(INFLIGHT_KEY);
		} catch {
			return null;
		}
		if (!raw) return null;
		let rec;
		try {
			rec = JSON.parse(raw);
		} catch {
			clear();
			return null;
		}
		if (!validRecord(rec) || now() - rec.startedAt > RESUME_WINDOW_MS) {
			clear();
			return null;
		}
		// Records written before the submit phase existed carry only a job id.
		return { phase: rec.jobId ? 'polling' : 'submitting', jobId: null, key: null, body: null, ...rec };
	}

	return {
		read,
		clear,

		/** Remember the request before it is sent, so a reload mid-POST can resend it. */
		beginSubmit({ key, body, label = '' }) {
			write({ phase: 'submitting', key, body, label, jobId: null, startedAt: now() });
		},

		/** The POST answered with a job: keep polling it across page loads. */
		attachJob(job, { label } = {}) {
			if (!job?.job_id) return;
			const prev = read();
			write({
				phase: 'polling',
				key: prev?.key ?? null,
				body: prev?.body ?? null,
				label: label ?? prev?.label ?? '',
				jobId: job.job_id,
				creationId: job.creation_id || null,
				previewImageUrl: job.preview_image_url || null,
				backend: job.backend || null,
				tier: job.tier || null,
				path: job.path || null,
				startedAt: prev?.startedAt ?? now(),
			});
		},

		/** The live record for this same request, if one exists (another tab, an earlier load). */
		matching(body) {
			const rec = read();
			if (!rec?.body) return null;
			return requestFingerprint(rec.body) === requestFingerprint(body) ? rec : null;
		},
	};
}

function header(res, name) {
	return res?.headers?.get ? res.headers.get(name) : undefined;
}

/**
 * POST one generation request under an Idempotency-Key, and keep the promise
 * that a duplicate never becomes a second job: while the server reports the
 * first request under this key is still running (409 idempotency_in_progress),
 * wait its retry_after and ask again with the identical request, until it
 * answers with the first job. Any other answer is handed back unchanged for the
 * page's own error mapping.
 *
 * A request that never reached an answer (dropped socket, page offline) may
 * still have reached the server, so it rejects as `transport_lost`, which keeps
 * the record and its key for the next load to collect.
 *
 * @param {{
 *   url: string, body: object, key: string, headers?: Record<string,string>,
 *   fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>,
 *   now?: () => number, maxWaitMs?: number,
 *   onWaiting?: (info: { retryAfterMs: number }) => void,
 *   isCancelled?: () => boolean,
 * }} opts
 * @returns {Promise<{ res: Response, data: any }>}
 */
export async function postGenerationOnce({
	url,
	body,
	key,
	headers = {},
	fetchImpl = (...args) => fetch(...args),
	sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
	now = () => Date.now(),
	maxWaitMs = DUPLICATE_WAIT_MS,
	onWaiting,
	isCancelled = () => false,
}) {
	const init = {
		method: 'POST',
		headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': key },
		body: JSON.stringify(body),
	};
	const started = now();
	for (;;) {
		let res;
		try {
			res = await fetchImpl(url, init);
		} catch {
			const e = new Error(
				'Lost the connection while starting this generation. If the request reached the generator it is still being made: reopen /forge to pick it back up.',
			);
			e.kind = 'transport_lost';
			e.title = 'Connection lost';
			e.userFacing = true;
			throw e;
		}
		const data = await res.json().catch(() => ({}));
		if (!(res.status === 409 && data?.error === 'idempotency_in_progress')) return { res, data };

		const seconds = Number(data.retry_after) || Number(header(res, 'retry-after')) || 2;
		const retryAfterMs = Math.max(1000, seconds * 1000);
		if (now() - started + retryAfterMs > maxWaitMs) {
			const e = new Error(
				'This generation is still being started by another tab or an earlier visit. It is not lost: reopen /forge in a minute to pick it up.',
			);
			e.kind = 'still_running';
			e.title = 'Still being made';
			e.userFacing = true;
			throw e;
		}
		onWaiting?.({ retryAfterMs });
		await sleep(retryAfterMs);
		if (isCancelled()) {
			const e = new Error('Cancelled.');
			e.kind = 'cancelled';
			throw e;
		}
	}
}

/**
 * One generation per tab at a time. Every input path (button, Enter, a held
 * key's auto-repeat, the pay-then-generate flow, a resume on load) goes through
 * enter(); only the holder of the current token may end the busy state.
 *
 * enter({ handoff: true }) lets a run that is ending start its successor (the
 * automatic lane hop) without the old run's cleanup ending the new one.
 * reset() is the user's Cancel: the tab is free at once, and the cancelled
 * run's late cleanup cannot touch whatever starts next.
 */
export function createRunGate() {
	let seq = 0;
	let owner = 0;
	return {
		get busy() {
			return owner !== 0;
		},
		enter({ handoff = false } = {}) {
			if (owner && !handoff) return 0;
			owner = ++seq;
			return owner;
		},
		leave(token) {
			if (!token || token !== owner) return false;
			owner = 0;
			return true;
		},
		reset() {
			owner = 0;
		},
	};
}
