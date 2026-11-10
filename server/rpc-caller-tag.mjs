// The Solana RPC accounting tag for one API dispatch (see
// api/_lib/solana/rpc-spend.js): the route TEMPLATE ("/api/agents/[id]"), never
// the raw path, so ids cannot multiply the ledger's key space.
//
// Crons are the exception: they share one dynamic file, and the job name is
// exactly what an operator needs, from a bounded set. A cron arrives either by
// its own path (/api/cron/<job>) or through the vercel.json rewrite
// /api/cron/<job> -> /api/cron/[name]?name=<job>, where the dispatched path is
// the template itself and the job is only in the query. Before the second case
// was handled, about 220k RPC calls a day were booked to "/api/cron/[name]".
import path from 'node:path';

const CRON_JOB_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function rpcCallerTag(apiRoot, file, apiPath, query = {}) {
	const template = '/api/' + path.relative(apiRoot, file).split(path.sep).join('/').replace(/\.m?js$/, '').replace(/\/index$/, '');
	if (!template.startsWith('/api/cron/[')) return template;
	if (apiPath !== template) return apiPath;
	const job = typeof query?.name === 'string' ? query.name : '';
	return CRON_JOB_RE.test(job) ? `/api/cron/${job}` : template;
}
