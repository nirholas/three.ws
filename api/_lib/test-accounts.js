// QA, audit and end-to-end accounts: who they are and how public boards skip them.
//
// Our own sweeps sign up real production accounts and publish real agents and
// creations with them. `users.is_test` (migration 20261105000000_users_is_test.sql)
// marks those accounts, set by a backfill and by a BEFORE INSERT trigger that
// applies the address rule below. Public listings filter on the column; the
// accounts themselves keep working.
//
// TEST_ACCOUNT_EMAIL_RE mirrors the SQL function users_is_test_email() so the
// rule is unit-testable here. Change both together.

import { sql } from './db.js';

const LOCAL_PREFIX = /^(qa[-_.]|threews-qa-|qaswarm|api-?audit|apiaudit|audit-batch|anim-audit-|labor-audit-|forgeaudit|auditprobe|[a-z]+-e2e-)/i;
const TEST_DOMAIN = /@(qa\.three\.ws|[^@]*\.test)$/i;

/** True when an address is one our own tooling generates for a test account. */
export function isTestAccountEmail(email) {
	const s = String(email || '').trim();
	if (!s) return false;
	return LOCAL_PREFIX.test(s) || TEST_DOMAIN.test(s);
}

export const TEST_ACCOUNT_EMAIL_RE = { LOCAL_PREFIX, TEST_DOMAIN };

// The set is a few dozen ids and changes only when a sweep provisions a new
// account, so one read per minute per instance is plenty.
const TTL_MS = 60_000;
let cache = { at: 0, ids: null };

/**
 * Ids of every account marked is_test, cached briefly. A read failure returns
 * an empty set: a board that briefly shows a QA row is better than a board
 * that does not render.
 *
 * @returns {Promise<Set<string>>}
 */
export async function testUserIds() {
	const now = Date.now();
	if (cache.ids && now - cache.at < TTL_MS) return cache.ids;
	try {
		const rows = await sql`select id from users where is_test`;
		cache = { at: now, ids: new Set(rows.map((r) => String(r.id))) };
		return cache.ids;
	} catch (err) {
		console.error('[test-accounts] could not read is_test ids:', err?.message);
		return cache.ids || new Set();
	}
}

/** Test hook: forget the cached id set. */
export function _resetTestUserIdsCache() {
	cache = { at: 0, ids: null };
}
