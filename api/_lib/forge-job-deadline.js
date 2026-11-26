// The one allowance every Forge job lives inside, and the poll-side decision
// that enforces it.
//
// The finalizer cron (api/cron/forge-finalize.js) fails any creation row still
// `generating` past FORGE_JOB_HARD_TTL_MINUTES. The browser poll asks the
// upstream worker instead, so a worker that never picks the task up (answers
// "queued" forever) or that stopped answering at all (every status call throws,
// which the poll reports as "running") used to keep a page polling with no end:
// the page resets its run budget on every "queued" answer. decideStalledPoll
// closes that gap by reading the row the finalizer writes.
//
// Only a NON-terminal upstream answer is ever overridden. A worker that finally
// delivered still wins (the row flips to done through the normal writer), and a
// job inside its allowance is never touched.

// Past this age a non-terminal generation is declared dead. The slowest real
// lane (self-host TRELLIS high tier behind a full queue) finishes well inside
// 30 minutes; beyond it the worker task has been evicted or lost.
export const FORGE_JOB_HARD_TTL_MINUTES = 45;

const TIMED_OUT_MESSAGE =
	'This generation took too long and was stopped. Start it again and it will run on a fresh slot.';

/**
 * What a poll should answer instead of the upstream's non-terminal status, or
 * null to relay the upstream answer unchanged.
 *
 * @param {{ pendingStatus: string, row: null | {
 *   status?: string, error?: string | null, created_at?: string | Date | null,
 *   superseded_by?: string | null } , now?: number }} input
 * @returns {null | { status: 'failed', error: string, markFailed: boolean, storedError: string }}
 */
export function decideStalledPoll({ pendingStatus, row, now = Date.now() }) {
	if (pendingStatus === 'done' || pendingStatus === 'failed') return null;
	if (!row || typeof row !== 'object') return null;
	// A failed attempt that a failover successor took over is a recovery, not an
	// outcome: the live successor is what this poll should keep reporting.
	if (row.superseded_by) return null;

	if (row.status === 'failed') {
		return {
			status: 'failed',
			error: failedRowMessage(row.error),
			markFailed: false,
			storedError: String(row.error || ''),
		};
	}

	if (row.status !== 'generating' && row.status != null) return null;
	const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
	if (!Number.isFinite(createdMs)) return null;
	const ageMinutes = (now - createdMs) / 60_000;
	if (ageMinutes < FORGE_JOB_HARD_TTL_MINUTES) return null;

	// Same wording the finalizer's reap writes, so every matcher that reads the
	// error column (npm run forge:errors, the health sensor) sees one shape.
	return {
		status: 'failed',
		error: TIMED_OUT_MESSAGE,
		markFailed: true,
		storedError: `generation timed out after ${Math.round(ageMinutes)} minutes`,
	};
}

// The finalizer's stored reasons are operator strings. A timeout gets the
// plain-language copy; any other stored reason is already a masked failure the
// poll handler would have shown, so it gets the generic retry copy.
function failedRowMessage(stored) {
	if (/timed out/i.test(String(stored || ''))) return TIMED_OUT_MESSAGE;
	return '3D generation hit a snag and stopped. Start it again and it will run on a fresh slot.';
}
