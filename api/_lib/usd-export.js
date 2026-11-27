// OpenUSD (simulation-ready) export: the one code path behind
// POST/GET /api/forge/export-usd and the export_openusd MCP tool.
//
// The heavy lifting runs on workers/usd-export (Cloud Run, usd-core): glTF to
// UsdGeom/UsdShade/UsdSkel, CoACD convex decomposition into UsdPhysics
// collision, mass from volume times a category density, semantic labels, then
// OpenUSD's UsdValidation (usdchecker) and NVIDIA's omniverse-asset-validator
// on every file. This module resolves a creation id to its GLB, guards caller
// URLs against SSRF, holds the worker's bearer key, and reshapes the worker's
// task record into a stable public job.
//
// Jobs are content addressed on the worker, so exporting the same model twice
// returns the finished job immediately.
//
// Environment: GCP_USD_EXPORT_URL (worker base URL), GCP_RECONSTRUCTION_KEY
// (the shared worker bearer secret).

import { isUuid } from './validate.js';
import { getPublicCreation } from './forge-store.js';
import { assertPublicHttpsUrl, SsrfError } from './ssrf.js';
import { fetchUpstream, UpstreamError } from './upstream-fetch.js';

const SITE = 'https://three.ws';
export const USD_JOB_RE = /^[0-9a-f]{40}$/;
export const USD_STAGE_LABELS = {
	queued: 'Queued',
	fetching: 'Downloading the model',
	converting: 'Converting to OpenUSD',
	physics: 'Building collision hulls and mass',
	packaging: 'Packaging USD, USDA and USDZ',
	validating: 'Running usdchecker and the NVIDIA asset validator',
	uploading: 'Publishing the files',
	done: 'Ready',
};

/** A refusal or failure with the HTTP status and error code a caller should see. */
export class UsdExportError extends Error {
	constructor(status, code, message) {
		super(message);
		this.name = 'UsdExportError';
		this.status = status;
		this.code = code;
	}
}

export function usdWorkerConfig() {
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

function invalid(message) {
	return new UsdExportError(400, 'validation_error', message);
}

/** Validate the optional overrides into the worker's field names. */
function readOptions(body) {
	const options = {};
	if (body.prompt != null) options.prompt = String(body.prompt).slice(0, 2000);
	if (body.label != null) {
		const label = String(body.label).trim().toLowerCase();
		if (!/^[a-z][a-z0-9 _-]{0,63}$/.test(label))
			throw invalid('label must be a short class name such as "chair" or "robot".');
		options.label = label;
	}
	const size = finiteInRange(body.size_m, 0.01, 500);
	if (Number.isNaN(size)) throw invalid('size_m must be a number of meters between 0.01 and 500.');
	if (size !== undefined) options.size_m = size;
	const density = finiteInRange(body.density_kg_m3, 1, 25000);
	if (Number.isNaN(density)) throw invalid('density_kg_m3 must be a number between 1 and 25000 (water is 1000).');
	if (density !== undefined) options.density_kg_m3 = density;
	return options;
}

/** The worker's task record as the public job shape. */
export function toJob(record) {
	const stage = record.stage || record.status;
	const stages = Array.isArray(record.stages) ? record.stages : [];
	const job = {
		job: record.task_id,
		status: record.status,
		stage,
		stage_label: USD_STAGE_LABELS[stage] || stage,
		stages: stages.map((s) => ({ id: s, label: USD_STAGE_LABELS[s] || s })),
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
	if (record.error) {
		const friendly = friendlyWorkerError(record.error);
		job.error = friendly || record.error;
		if (friendly) job.error_detail = record.error;
	}
	return job;
}

// The worker caps the GLB it downloads at 96 MiB (MAX_GLB_BYTES in
// workers/usd-export/main.py) and reports the overrun in its own words
// ("response exceeded N bytes" / "response too large: N bytes"). Those are true
// but say nothing the user can act on, so they become the limit and the way out.
const OVERSIZE_RE = /^response (?:exceeded \d+ bytes|too large: \d+ bytes)/;
const OVERSIZE_MESSAGE =
	'This model is over 96 MB, the most the OpenUSD exporter accepts. Reduce it with Optimize in the Forge viewer, then export again.';

function friendlyWorkerError(raw) {
	if (typeof raw !== 'string') return '';
	if (OVERSIZE_RE.test(raw)) return OVERSIZE_MESSAGE;
	return '';
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

const WORKER_DOWN = 'The OpenUSD exporter is not answering right now. Try again in a minute.';

function requireConfig(cfg) {
	if (!cfg.base || !cfg.key) {
		throw new UsdExportError(
			503,
			'not_configured',
			'OpenUSD export is not configured. Set GCP_USD_EXPORT_URL and GCP_RECONSTRUCTION_KEY on the API service.',
		);
	}
	return cfg;
}

async function callWorker(cfg, path, init) {
	const r = await fetchUpstream(
		`${cfg.base}${path}`,
		{ ...init, headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' } },
		{ name: 'usd-export', label: 'usd-export', timeoutMs: 30_000, attempts: 2 },
	);
	return r.json();
}

/**
 * Start (or reuse) an export. `input` is { id } (a Forge creation) or { src }
 * (a public .glb URL), plus optional prompt, label, size_m, density_kg_m3.
 * Resolves with the public job; throws UsdExportError.
 */
export async function startUsdExport(input, { loadCreation = loadCreationForUsd, config = usdWorkerConfig } = {}) {
	const cfg = requireConfig(config());
	if (!input || typeof input !== 'object') throw invalid('Send a JSON body.');
	const payload = readOptions(input);
	if (input.id != null) {
		if (!isUuid(input.id)) throw invalid('id must be a creation id (a UUID).');
		const creation = await loadCreation(input.id);
		if (!creation) throw new UsdExportError(404, 'creation_not_found', 'No finished public creation with that id.');
		payload.glb_url = absoluteUrl(creation.glb_url);
		payload.prompt ??= creation.prompt || undefined;
		if (creation.category) payload.category = creation.category;
		payload.creation_id = input.id;
	} else if (typeof input.src === 'string' && input.src) {
		try {
			payload.glb_url = await assertPublicHttpsUrl(input.src);
		} catch (err) {
			if (err instanceof SsrfError) throw invalid('src must be a public https URL of a .glb file.');
			throw err;
		}
	} else {
		throw invalid('Send id (a Forge creation) or src (a public .glb URL).');
	}

	try {
		return toJob(await callWorker(cfg, '/export', { method: 'POST', body: JSON.stringify(payload) }));
	} catch (err) {
		if (err instanceof UpstreamError && (err.status === 400 || err.status === 422)) {
			throw invalid(workerDetail(err) || 'The exporter refused that model.');
		}
		throw new UsdExportError(502, 'worker_unavailable', WORKER_DOWN);
	}
}

/** Read a job by id. Resolves with the public job; throws UsdExportError. */
export async function pollUsdExport(job, { config = usdWorkerConfig } = {}) {
	const cfg = requireConfig(config());
	if (!USD_JOB_RE.test(job || '')) throw invalid('job must be the id an export returned.');
	try {
		return toJob(await callWorker(cfg, `/tasks/${job}`, { method: 'GET' }));
	} catch (err) {
		if (err instanceof UpstreamError && err.status === 404)
			throw new UsdExportError(404, 'job_not_found', 'No export with that id. Start the export again.');
		throw new UsdExportError(502, 'worker_unavailable', WORKER_DOWN);
	}
}
