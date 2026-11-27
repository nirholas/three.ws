// Read-time checks every Forge cache runs before it hands a stored model back.
//
// The caches (forge-cache.js, forge-done-cache.js) key on a request and store a
// pointer to a finished model. The pointer outlives the model's circumstances: the
// owner can delete it, make it private, or a takedown or the content-safety sweep
// can block it, any time in the next seven days. Purging by value is not
// possible (the stores are keyed by request, not by model), so the guarantee is
// enforced where it cannot be bypassed: on every read, the cached pointer is
// checked against the creation row, which is the source of truth.
//
// Three answers:
//   ok       the row exists, is finished, is not blocked or held, and the viewer
//            may have it.
//   gone     the row is missing, unfinished, blocked, held, or not the viewer's.
//   unknown  the row could not be read (database outage).
// The caller decides what unknown means. A cross-account cache treats it as a
// miss (generate fresh, never guess); a job's own done frame keeps answering,
// because the poller already owns that job.

import { sql } from './db.js';

// The columns the decision needs, nothing else.
export async function lookupCreation(id) {
	if (!id || typeof id !== 'string') return null;
	const rows = await sql`
		select id, status, visibility, safety_status, user_id, client_key
		from forge_creations
		where id = ${id}
		limit 1
	`;
	return rows[0] ?? null;
}

function ownsRow(row, viewer) {
	if (!viewer) return false;
	if (viewer.userId && row.user_id && row.user_id === viewer.userId) return true;
	const ck = viewer.clientKey;
	// The shared anonymous bucket identifies no one, so it never proves ownership.
	return Boolean(typeof ck === 'string' && ck && ck !== 'anon' && row.client_key === ck);
}

/**
 * Pure: may `viewer` be handed this creation's model? `viewer: null` asks the
 * public question (is it servable to anyone).
 *
 * @param {{ status?: string, visibility?: string|null, safety_status?: string|null, user_id?: string|null, client_key?: string|null }|null|undefined} row
 * @param {{ userId?: string|null, clientKey?: string|null }|null} [viewer]
 */
export function creationServableTo(row, viewer = null) {
	if (!row || row.status !== 'done') return false;
	if (row.safety_status === 'blocked' || row.safety_status === 'held') return false;
	// A row with no visibility is legacy and reads as public everywhere.
	if (row.visibility == null || row.visibility === 'public') return true;
	return ownsRow(row, viewer);
}

/**
 * @param {string|null|undefined} id
 * @param {{ viewer?: object|null, lookup?: (id: string) => Promise<object|null> }} [opts]
 * @returns {Promise<'ok'|'gone'|'unknown'>}
 */
export async function checkCreation(id, { viewer = null, lookup = lookupCreation } = {}) {
	if (!id) return 'gone';
	let row;
	try {
		row = await lookup(id);
	} catch {
		return 'unknown';
	}
	return creationServableTo(row, viewer) ? 'ok' : 'gone';
}
