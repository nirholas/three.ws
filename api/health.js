// GET /api/health: honest readiness. Probes the database, Solana RPC lanes, the
// background worker and custodial wallet encryption, and reports `degraded` or
// `down` when any of them is. 200 for ok or degraded, 503 for down, so a load
// balancer pulls the instance only for a hard failure while an agent reading the
// body still sees the degradation. /api/healthz is liveness and always ok.

import { cors, json, method, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { gatherHealth } from './_lib/health-probes.js';

const CACHE_MS = 5_000;
let memo = { at: 0, value: null };

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (!memo.value || Date.now() - memo.at > CACHE_MS) memo = { at: Date.now(), value: await gatherHealth() };
	const body = memo.value;
	return json(res, body.status === 'down' ? 503 : 200, body, { 'cache-control': 'no-store' });
});
