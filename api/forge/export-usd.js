// OpenUSD (simulation-ready) export for Forge models.
//
//   POST /api/forge/export-usd { id } | { src }   start (or reuse) an export job
//        optional: prompt, label, size_m, density_kg_m3
//   GET  /api/forge/export-usd?job=<task id>       poll it
//
// The heavy lifting runs on workers/usd-export (Cloud Run, usd-core): glTF to
// UsdGeom/UsdShade/UsdSkel, CoACD convex decomposition into UsdPhysics
// collision, mass from volume times a category density, semantic labels, then
// OpenUSD's UsdValidation (usdchecker) and NVIDIA's omniverse-asset-validator
// on every file. This route resolves a creation id to its GLB, guards caller
// URLs against SSRF, holds the worker's bearer key server side, and reshapes the
// worker's task record into a stable public job.
//
// Jobs are content addressed on the worker, so exporting the same model twice
// returns the finished job immediately.
//
// Environment: GCP_USD_EXPORT_URL (worker base URL), GCP_RECONSTRUCTION_KEY
// (the shared worker bearer secret).

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { getPublicCreation } from '../_lib/forge-store.js';
import { assertPublicHttpsUrl, SsrfError } from '../_lib/ssrf.js';
import { fetchUpstream, UpstreamError } from '../_lib/upstream-fetch.js';

const SITE = 'https://three.ws';
const JOB_RE = /^[0-9a-f]{40}$/;
const STAGE_LABELS = {
	queued: 'Queued',
	fetching: 'Downloading the model',
	converting: 'Converting to OpenUSD',
	physics: 'Building collision hulls and mass',
	packaging: 'Packaging USD, USDA and USDZ',
	validating: 'Running usdchecker and the NVIDIA asset validator',
	uploading: 'Publishing the files',
	done: 'Ready',
};

function workerConfig() {
	return {
		base: (process.env.GCP_USD_EXPORT_URL || '').replace(/\/$/, ''),
		key: process.env.GCP_RECONSTRUCTION_KEY || '',
	};
}

/** A public creation's export inputs, or null when it is missing, private or unfinished. */
export async function loadCreationForUsd(id) {
	const creation = await getPublicCreation({ id });
	if (!creation?.glb_url) return null;
	return {
		glb_url: creation.glb_url,
		prompt: creation.prompt || null,
		category: creation.model_category || null,
	};
}

function absoluteUrl(url) {
	return url.startsWith('/') ? `${SITE}${url}` : url;
}

function finiteInRange(value, min, max) {
	if (value === undefined || value === null || value === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) && n > min && n <= max ? n : NaN;
}

/** Validate the optional overrides; returns { options } or { message }. */
function readOptions(body) {
	const options = {};
	if (body.prompt != null) options.prompt = String(body.prompt).slice(0, 2000);
	if (body.label != null) {
		const label = String(body.label).trim().toLowerCase();
		if (!/^[a-z][a-z0-9 _-]{0,63}$/.test(label))
			return { message: 'label must be a short class name such as "chair" or "robot".' };
		options.label = label;
	}
	const size = finiteInRange(body.size_m, 0.01, 500);
	if (Number.isNaN(size)) return { message: 'size_m must be a number of meters between 0.01 and 500.' };
	if (size !== undefined) options.size_m = size;
	const density = finiteInRange(body.density_kg_m3, 1, 25000);
	if (Number.isNaN(density))
		return { message: 'density_kg_m3 must be a number between 1 and 25000 (water is 1000).' };
	if (density !== undefined) options.density_kg_m3 = density;
	return { options };
}

/** The worker's task record as the public job shape. */
export function toJob(record) {
	const stage = record.stage || record.status;
	const stages = Array.isArray(record.stages) ? record.stages : [];
	const job = {
		job: record.task_id,
		status: record.status,
		stage,
		stage_label: STAGE_LABELS[stage] || stage,
		stages: stages.map((s) => ({ id: s, label: STAGE_LABELS[s] || s })),
		progress:
			record.status === 'done'
				? 1
				: stages.length && stages.includes(stage)
					? Math.round((stages.indexOf(stage) / stages.length) * 100) / 100
					: 0,
		exporter: record.exporter,
		poll: `/api/forge/export-usd?job=${record.task_id}`,
	};
	if (record.files) job.files = record.files;
	if (record.summary) job.summary = record.summary;
	if (record.error) job.error = record.error;
	return job;
}

function workerDetail(err) {
	const body = err instanceof UpstreamError ? err.body : '';
	try {
		const parsed = JSON.parse(body || '');
		if (typeof parsed.detail === 'string') return parsed.detail;
		if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) return parsed.detail[0].msg;
	} catch {
		// The excerpt is capped at 200 characters, so a long detail arrives as
		// truncated JSON; read the message straight out of it.
	}
	const match = /"(?:detail|msg)"\s*:\s*"([^"]+)/.exec(body || '');
	return match ? match[1] : null;
}

export function createExportUsdHandler({ loadCreation = loadCreationForUsd, config = workerConfig } = {}) {
	async function callWorker(cfg, path, init) {
		return fetchUpstream(
			`${cfg.base}${path}`,
			{ ...init, headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' } },
			{ name: 'usd-export', label: 'usd-export', timeoutMs: 30_000, attempts: 2 },
		);
	}

	async function start(req, res, cfg) {
		const rate = await limits.usdExportIp(clientIp(req));
		if (!rate.success) return rateLimited(res, rate, 'too many OpenUSD exports');

		const body = await readJson(req, 16_384);
		if (!body || typeof body !== 'object') return error(res, 400, 'validation_error', 'Send a JSON body.');
		const { options, message } = readOptions(body);
		if (message) return error(res, 400, 'validation_error', message);

		const payload = { ...options };
		if (body.id != null) {
			if (!isUuid(body.id)) return error(res, 400, 'validation_error', 'id must be a creation id (a UUID).');
			const creation = await loadCreation(body.id);
			if (!creation)
				return error(res, 404, 'creation_not_found', 'No finished public creation with that id.');
			payload.glb_url = absoluteUrl(creation.glb_url);
			payload.prompt ??= creation.prompt || undefined;
			if (creation.category) payload.category = creation.category;
			payload.creation_id = body.id;
		} else if (typeof body.src === 'string' && body.src) {
			try {
				payload.glb_url = await assertPublicHttpsUrl(body.src);
			} catch (err) {
				if (err instanceof SsrfError)
					return error(res, 400, 'validation_error', 'src must be a public https URL of a .glb file.');
				throw err;
			}
		} else {
			return error(res, 400, 'validation_error', 'Send id (a Forge creation) or src (a public .glb URL).');
		}

		let record;
		try {
			const r = await callWorker(cfg, '/export', { method: 'POST', body: JSON.stringify(payload) });
			record = await r.json();
		} catch (err) {
			if (err instanceof UpstreamError && (err.status === 400 || err.status === 422)) {
				return error(res, 400, 'validation_error', workerDetail(err) || 'The exporter refused that model.');
			}
			return error(res, 502, 'worker_unavailable', 'The OpenUSD exporter is not answering right now. Try again in a minute.');
		}
		return json(res, record.status === 'done' ? 200 : 202, toJob(record), { 'cache-control': 'no-store' });
	}

	async function poll(req, res, cfg, job) {
		if (!JOB_RE.test(job)) return error(res, 400, 'validation_error', 'job must be the id an export returned.');
		const rate = await limits.mcp3dStatus(clientIp(req));
		if (!rate.success) return rateLimited(res, rate, 'too many status checks');
		let record;
		try {
			const r = await callWorker(cfg, `/tasks/${job}`, { method: 'GET' });
			record = await r.json();
		} catch (err) {
			if (err instanceof UpstreamError && err.status === 404)
				return error(res, 404, 'job_not_found', 'No export with that id. Start the export again.');
			return error(res, 502, 'worker_unavailable', 'The OpenUSD exporter is not answering right now. Try again in a minute.');
		}
		return json(res, 200, toJob(record), { 'cache-control': 'no-store' });
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
		if (req.method === 'POST') return start(req, res, cfg);
		const job = new URL(req.url, 'http://local').searchParams.get('job') || '';
		return poll(req, res, cfg, job);
	});
}

export default createExportUsdHandler();
