// Route every import of api/_lib/db.js to an in-process Postgres for this
// process. Call installPgliteDb(sql) BEFORE the first dynamic import of any api
// module; `sql` is the tagged-template function from
// tests/_helpers/pglite-sql.js. The redirect is a module resolve hook, so the
// api code under test is the unmodified production code.
import { register } from 'node:module';

export function installPgliteDb(sql) {
	globalThis.__threeWsPgliteSql = sql;
	const db = new URL('../../api/_lib/db.js', import.meta.url).href;
	const stub = new URL('./pglite-db-stub.mjs', import.meta.url).href;
	const hook = `export async function resolve(spec, ctx, next) {
		const r = await next(spec, ctx);
		return r.url === ${JSON.stringify(db)} ? { ...r, url: ${JSON.stringify(stub)} } : r;
	}`;
	register(`data:text/javascript,${encodeURIComponent(hook)}`);
}
