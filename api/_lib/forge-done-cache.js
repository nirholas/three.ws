// Remembers the first finished frame of a forge job so every later poll of a
// done job answers from cache instead of rebuilding it.
//
// Why: the done branch of the poll materializes the creation and runs the
// vision quality gate. Both are worth doing ONCE. Measured live on 2026-08-27,
// every poll of an already-finished job re-ran them and took 13-33 s, which
// pushed the OKX forge_status tool (15 s client bound) into "timed out" on
// roughly every other read of a finished model. A done job is terminal: its
// frame cannot change, so the first one built is the one every poll gets.
//
// Keyed by a hash of the job handle (handles are signed tokens up to 1 KB) and
// held for six hours, which outlives any client's polling loop. The shared
// cache degrades to per-instance memory without Redis, which still dedupes
// the common case of one client polling one instance.
//
// Two correctness rules on top of that:
//   - Only a durable copy is remembered. A frame whose mesh could not be copied
//     into our storage carries the provider's short-lived URL; remembering it
//     would freeze a link that dies within hours, and skip the copy every later
//     poll would retry.
//   - A remembered frame is re-checked against its creation row on every read.
//     A model deleted, blocked or held for review after it finished is answered
//     as removed instead of being handed out for the rest of the six hours. The
//     poller owns the job, so visibility is not checked; a row that cannot be
//     read (database outage) keeps the frame answering.

import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './cache.js';
import { creationLive, lookupCreation } from './forge-cache-guard.js';

export const DONE_FRAME_TTL_S = 6 * 3600;

export function doneFrameKey(jobId) {
	return `forge:done:${createHash('sha256').update(String(jobId)).digest('hex').slice(0, 40)}`;
}

// What a poll answers once the model behind a remembered frame is gone. A
// terminal failure with a code the client can act on, never the old model.
export function removedFrame(jobId, frame) {
	return {
		job_id: frame?.job_id ?? jobId,
		creation_id: frame?.creation_id ?? null,
		status: 'failed',
		code: 'model_removed',
		error: 'model_removed',
		message: 'This model was removed and is no longer available. Generate it again to get a new one.',
	};
}

// The frame a done poll answered with, or null when this job has not finished
// on this instance (or its record expired). When the model has since been
// removed, the removed frame instead.
export async function recallDoneFrame(jobId, { lookup = lookupCreation } = {}) {
	if (!jobId) return null;
	const v = await cacheGet(doneFrameKey(jobId));
	if (!v || typeof v !== 'object' || v.status !== 'done') return null;
	if (!v.creation_id) return v;
	let row;
	try {
		row = await lookup(v.creation_id);
	} catch {
		return v;
	}
	return creationLive(row) ? v : removedFrame(jobId, v);
}

// Store a finished frame. Only a genuinely done frame with a durable model and
// the creation row it belongs to is worth remembering; anything else is
// answered fresh by the next poll.
export async function rememberDoneFrame(jobId, frame) {
	if (!jobId || !frame || frame.status !== 'done' || !frame.glb_url) return false;
	if (frame.durable === false || !frame.creation_id) return false;
	if (!/^https?:\/\//i.test(String(frame.glb_url))) return false;
	await cacheSet(doneFrameKey(jobId), frame, DONE_FRAME_TTL_S);
	return true;
}
