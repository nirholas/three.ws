'use strict';

const { ApiError, MESSAGES, messageFor, normalise } = require('./errors');
const { realSleep } = require('./retry');

const DONE = new Set(['succeeded', 'completed', 'complete', 'done', 'ready']);
const FAILED = new Set(['failed', 'error']);
const CANCELLED = new Set(['cancelled', 'canceled']);

const STAGE_LABELS = Object.freeze({
	queued: 'Waiting for a GPU',
	download: 'Fetching your file',
	stitch: 'Stitching the two lenses',
	frames: 'Extracting frames',
	sfm: 'Solving camera positions',
	train: 'Training the scene',
	export: 'Exporting files',
	upload: 'Saving results',
	depth: 'Estimating depth',
	mesh: 'Building the mesh',
});

function stageLabel(update) {
	if (!update) return 'Starting';
	if (update.status === 'queued') return STAGE_LABELS.queued;
	return STAGE_LABELS[update.stage] || 'Processing';
}

/** 0..1, clamped; missing progress reads as 0. */
function clampProgress(p) {
	const n = Number(p);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Interval grows from 2 s to 6 s so a long splat job does not hammer the API. */
function nextInterval(tick) {
	return Math.min(6000, 2000 + tick * 500);
}

/**
 * Poll `fetchStatus()` until the job finishes. Returns the final status object.
 * Throws ApiError for failed and cancelled jobs (with the job's own error code),
 * and after `maxTransientFailures` consecutive network failures.
 */
async function pollJob({ fetchStatus, onUpdate = () => {}, token, sleep = realSleep, maxMs = 3 * 60 * 60 * 1000, maxTransientFailures = 5, now = Date.now }) {
	const started = now();
	let tick = 0;
	let transient = 0;
	for (;;) {
		token.throwIfCancelled();
		let status;
		try {
			status = await fetchStatus();
			transient = 0;
		} catch (raw) {
			const err = normalise(raw);
			if (!err.retryable || ++transient > maxTransientFailures) throw err;
			await sleep(nextInterval(tick++));
			continue;
		}
		const state = String(status.status || '').toLowerCase();
		onUpdate({ ...status, progress: clampProgress(status.progress), label: stageLabel(status) });
		if (DONE.has(state)) return status;
		if (CANCELLED.has(state)) throw new ApiError('cancelled', MESSAGES.cancelled);
		if (FAILED.has(state)) {
			const code = status.error && typeof status.error.code === 'string' ? status.error.code : 'job_failed';
			throw new ApiError(code, messageFor(code, status.error && status.error.message));
		}
		if (now() - started > maxMs) throw new ApiError('timeout', MESSAGES.timeout);
		await sleep(nextInterval(tick++));
	}
}

module.exports = { pollJob, stageLabel, clampProgress, nextInterval, STAGE_LABELS };
