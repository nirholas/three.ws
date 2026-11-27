// Forge: what the Rig button tells the user while it waits, and which answers
// it can retry.
//
// Measured on production 2026-11-27: a figure rigged in 19 to 34 seconds, a
// hound took 205 seconds on the non-human rigger, and a worker that is asleep
// adds its start-up on top. The page used to give up after four minutes, so a
// creature on a cold worker failed in the browser while the job was still
// running and still counted. The page now waits as long as the server lets a
// job live, and every message says what is actually happening.
//
// Pure, so tests/forge-rig-status.test.js pins the copy and the decisions.

/** How often the page asks the server about a rig job. */
export const RIG_POLL_INTERVAL_MS = 2500;

/**
 * How long the page keeps waiting. The non-human rigger may take 15 minutes
 * (RIG_NONHUMAN timeout in workers/rig/main.py) and a cold worker adds a few
 * more; the server's own hard limit is 45 (api/_lib/forge-job-deadline.js).
 */
export const RIG_POLL_BUDGET_MS = 20 * 60 * 1000;

/** After this long a wait message says plainly that it is a long one. */
export const RIG_LONG_WAIT_MS = 5 * 60 * 1000;

/**
 * Answers the preflight gives when the model itself cannot be rigged. Trying
 * the same model again gives the same answer, so these get no Retry button.
 */
export const RIG_REFUSAL_CODES = new Set([
	'rig_not_riggable',
	'rig_multiple_pieces',
	'rig_too_large',
	'rig_too_complex',
	'rig_invalid_model',
	'invalid_glb_url',
]);

/**
 * True when the server refused the model, as opposed to failing on the way.
 * A 422 rig_fetch_failed (the link answered 404) is a refusal too; the 502
 * form is a download that failed and is worth retrying.
 */
export function isRigRefusal(status, body) {
	const code = body?.error;
	if (code === 'rig_fetch_failed') return status === 422;
	return status < 500 && status !== 429 && RIG_REFUSAL_CODES.has(code);
}

/** "0:07", "3:25", "20:00". */
export function formatElapsed(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The sentence shown while the page waits.
 *
 * @param {{ phase: 'checking'|'queued'|'running'|'verifying', subject?: string|null, elapsedMs?: number }} state
 */
export function rigWaitMessage({ phase, subject = null, elapsedMs = 0 }) {
	if (phase === 'checking') return 'Checking the model before it goes to the rigger.';
	if (phase === 'verifying') return 'Checking the skeleton and playing a test animation on it.';
	if (elapsedMs >= RIG_LONG_WAIT_MS) {
		return 'Still working. A rig worker that was asleep takes longer the first time. This page keeps checking for up to 20 minutes, and you can keep using it meanwhile.';
	}
	if (phase === 'queued') {
		return 'Waiting for a rig worker. If none is awake, one is starting now, which takes a minute or two.';
	}
	if (subject === 'creature') {
		return 'Fitting a skeleton to this creature. Creatures usually take three to four minutes.';
	}
	return 'Fitting a skeleton and skin weights. A figure usually takes under a minute once a worker is awake.';
}
