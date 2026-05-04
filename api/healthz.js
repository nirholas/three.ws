// GET /api/healthz
// ----------------
// Lightweight liveness/readiness endpoint. Returns 200 with uptime + a small
// summary block compatible with the pump-dashboard's API status panel.
//
// Intentionally has no DB / RPC dependencies — this should stay green even
// when downstream systems are degraded so it's safe to wire to uptime probes.

import { cors, json, method, wrap } from './_lib/http.js';

const STARTED_AT = Date.now();
const VERSION = process.env.VERCEL_GIT_COMMIT_SHA || process.env.npm_package_version || 'dev';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const uptimeMs = Date.now() - STARTED_AT;
	return json(res, 200, {
		status: 'ok',
		service: '3d-agent',
		version: VERSION,
		uptime: Math.floor(uptimeMs / 1000),
		uptimeMs,
		// Match the pump-dashboard health shape so the existing UI binding works
		// without conditional logic.
		monitor: { running: true, mode: 'serverless', claimsDetected: 0 },
		watches: { total: 0, active: 0 },
	}, { 'cache-control': 'public, max-age=2, s-maxage=2' });
});
