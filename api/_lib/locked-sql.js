// Run one statement under per-key Postgres advisory locks, with the lock taken
// in its OWN statement ahead of it inside a single transaction.
//
// Why not a `WITH locked AS (SELECT pg_advisory_xact_lock(...))` CTE inside the
// statement itself: under READ COMMITTED a statement's snapshot is fixed when it
// STARTS. A request that blocks on the lock mid-statement wakes up only after
// the holder committed, but still reads the pre-commit snapshot, so it never
// sees the holder's reservation row and a "sum of the last 24h + this spend <=
// cap" check passes twice. Two statements in one transaction fix it: the second
// statement takes a fresh snapshot after the lock is held.
//
// Locks are taken in sorted order so two callers needing the same pair cannot
// deadlock. `query` must be an un-awaited sql`` fragment. Resolves to the rows
// of `query`.
import { sql } from './db.js';

export async function runLocked(lockKeys, query) {
	const keys = [...new Set(lockKeys.map(String))].sort();
	const results = await sql.transaction([
		...keys.map((k) => sql`select pg_advisory_xact_lock(hashtextextended(${k}, 0))`),
		query,
	]);
	return results[results.length - 1];
}
