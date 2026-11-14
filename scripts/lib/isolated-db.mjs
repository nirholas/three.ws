// Run real server code against a throwaway in-process Postgres instead of the
// production database that DATABASE_URL in .env.local points at.
//
// Usage: await useIsolatedDb() before importing anything that uses
// api/_lib/db.js, then dynamically import the server modules under test (for
// example api/_lib/approvals.js). scripts/approvals-telegram-live-check.mjs is
// the reference caller.
//
// It builds PGlite with the production schema (api/_lib/schema.sql plus every
// migration, via tests/_helpers/pglite-full-schema.js, cached across runs) and
// installs a synchronous module hook that resolves every import of
// api/_lib/db.js to a shim whose `sql` runs on that PGlite. Everything else
// db.js exports is the real module. The code under test is unchanged: the
// gateway worker, the approvals library and the notification fan-out all run
// as they do in production, only their rows land in memory and vanish with the
// process.
//
// Why not a Neon branch or the docker proxy in scripts/use-local-neon.mjs: the
// branch needs a Neon API key this machine does not hold, and the proxy needs
// a Docker daemon. This needs neither.

import { registerHooks } from 'node:module';
import { createPgliteSql } from '../../tests/_helpers/pglite-sql.js';
import { createFullSchemaDb } from '../../tests/_helpers/pglite-full-schema.js';

const DB_SUFFIX = '/api/_lib/db.js';
const SHIM_URL = new URL('./isolated-db-shim.mjs', import.meta.url).href;

let installed = null;

/**
 * Build the throwaway database and route api/_lib/db.js to it. Idempotent.
 * @returns {Promise<{ pg: import('@electric-sql/pglite').PGlite, sql: Function, query: Function, skipped: Array, cached: boolean }>}
 */
export async function useIsolatedDb() {
	if (installed) return installed;
	const { pg, skipped, cached } = await createFullSchemaDb();
	const wrapped = createPgliteSql({ pg });
	const sql = wrapped.sql;
	// The production proxy forwards these to the Neon client; give the shim the
	// same surface so a caller that uses them does not crash here.
	sql.query = (text, params = []) => pg.query(text, params).then((r) => r.rows);
	const arrayTransaction = sql.transaction;
	sql.transaction = (queriesOrFn) => arrayTransaction(typeof queriesOrFn === 'function' ? queriesOrFn(sql) : queriesOrFn);
	globalThis.__threeWsIsolatedSql = sql;

	registerHooks({
		resolve(specifier, context, next) {
			const out = next(specifier, context);
			if (out.url.endsWith(DB_SUFFIX) && context.parentURL !== SHIM_URL) return { ...out, url: SHIM_URL, shortCircuit: true };
			return out;
		},
	});
	installed = { pg, sql, query: wrapped.query, skipped, cached };
	return installed;
}
