// Stands in for api/_lib/db.js inside a devnet proof script, so the real api
// modules run their real SQL against an in-process Postgres (PGlite) and never
// reach the production database. Installed by installPgliteDb() in
// ./pglite-db.mjs, which sets the global before any api module loads. Every
// other db.js export (error classifiers, sqlValues) is the real one.
export * from '../../api/_lib/db.js?pglite-real';

export const sql = globalThis.__threeWsPgliteSql;
if (typeof sql !== 'function') {
	throw new Error('pglite-db-stub loaded before installPgliteDb(): import api modules only after installing it');
}
