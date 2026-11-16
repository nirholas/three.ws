// OpenUSD (simulation-ready) export for Forge models.
//
//   POST /api/forge/export-usd { id } | { src }   start (or reuse) an export job
//        optional: prompt, label, size_m, density_kg_m3
//   GET  /api/forge/export-usd?job=<task id>       poll it
//
// The export itself (creation lookup, SSRF guard, worker call, job shape) lives
// in api/_lib/usd-export.js, shared with the export_openusd MCP tool. This file
// is the HTTP binding: CORS, rate limits and the status codes.

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import {
	loadCreationForUsd,
	pollUsdExport,
	startUsdExport,
	toJob,
	USD_JOB_RE,
	UsdExportError,
	usdWorkerConfig,
} from '../_lib/usd-export.js';

export { loadCreationForUsd, toJob };

export function createExportUsdHandler({ loadCreation = loadCreationForUsd, config = usdWorkerConfig } = {}) {
	function fail(res, err) {
		if (err instanceof UsdExportError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	async function start(req, res) {
		const rate = await limits.usdExportIp(clientIp(req));
		if (!rate.success) return rateLimited(res, rate, 'too many OpenUSD exports');
		const body = await readJson(req, 16_384);
		try {
			const job = await startUsdExport(body, { loadCreation, config });
			return json(res, job.status === 'done' ? 200 : 202, job, { 'cache-control': 'no-store' });
		} catch (err) {
			return fail(res, err);
		}
	}

	async function poll(req, res, job) {
		if (!USD_JOB_RE.test(job)) return error(res, 400, 'validation_error', 'job must be the id an export returned.');
		const rate = await limits.mcp3dStatus(clientIp(req));
		if (!rate.success) return rateLimited(res, rate, 'too many status checks');
		try {
			return json(res, 200, await pollUsdExport(job, { config }), { 'cache-control': 'no-store' });
		} catch (err) {
			return fail(res, err);
		}
	}

	return wrap(async (req, res) => {
		if (cors(req, res, { origins: '*', methods: 'GET,POST,OPTIONS', payments: false })) return;
		if (!method(req, res, ['GET', 'POST'])) return;
		const cfg = config();
		if (!cfg.base || !cfg.key) {
			return error(
				res,
				503,
				'not_configured',
				'OpenUSD export is not configured. Set GCP_USD_EXPORT_URL and GCP_RECONSTRUCTION_KEY on the API service.',
			);
		}
		if (req.method === 'POST') return start(req, res);
		return poll(req, res, new URL(req.url, 'http://local').searchParams.get('job') || '');
	});
}

export default createExportUsdHandler();
