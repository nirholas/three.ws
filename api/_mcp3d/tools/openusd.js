// export_openusd: a Forge model or any public GLB as simulation-ready OpenUSD
// for NVIDIA Omniverse and Isaac Sim (MCP tool).
//
// Same code path as POST/GET /api/forge/export-usd (api/_lib/usd-export.js):
// CoACD collision hulls, a rigid body with mass from volume times a category
// density, semantic labels, UsdSkel for rigged avatars, and both validators
// (usdchecker and the NVIDIA asset validator) on every file. Exports take 10
// to 60 s, so the tool waits up to `wait_seconds` for the result and otherwise
// returns the running job; calling it again with `job` picks up where it left
// off. A model that was exported before comes back at once (jobs are content
// addressed).
//
// Free: the work runs on the platform's own Cloud Run worker, rate limited per
// caller like the web route.

import { clientIp, limits } from '../../_lib/rate-limit.js';
import {
	loadCreationForUsd,
	pollUsdExport,
	startUsdExport,
	UsdExportError,
	usdWorkerConfig,
} from '../../_lib/usd-export.js';

const POLL_MS = 3_000;
const DEFAULT_WAIT_S = 30;
const MAX_WAIT_S = 50;

function toolError(message, code) {
	return {
		content: [{ type: 'text', text: message }],
		structuredContent: { error: true, code, message },
		isError: true,
	};
}

function findings(validation, key) {
	let n = 0;
	for (const kind of ['usd', 'usdz']) {
		for (const tool of Object.values(validation?.[kind] || {})) n += tool?.[key] || 0;
	}
	return n;
}

function doneText(job) {
	const s = job.summary || {};
	const size = Array.isArray(s.size_m) ? `${s.size_m.map((v) => Number(v).toFixed(3)).join(' x ')} m` : null;
	const body = s.rigged ? `${s.joints} joints (kinematic)` : s.hulls ? `${s.hulls} convex collision hulls` : null;
	const facts = [
		s.label && `class "${s.label}"`,
		size,
		Number.isFinite(s.mass_kg) && `${Number(s.mass_kg).toFixed(2)} kg`,
		body,
		`${findings(s.validation, 'errors')} validator errors, ${findings(s.validation, 'warnings')} warnings`,
	].filter(Boolean);
	const f = job.files || {};
	return [
		`OpenUSD export ready: ${facts.join(', ')}.`,
		f.usdz && `USDZ (single file, drag into Omniverse or Isaac Sim): ${f.usdz}`,
		f.zip && `USD + textures (zip): ${f.zip}`,
		f.usda && `USDA (text): ${f.usda}`,
		f.report && `Report (mass method, every validator finding): ${f.report}`,
	]
		.filter(Boolean)
		.join('\n');
}

function runningText(job) {
	return (
		`Exporting: ${job.stage_label || job.stage} (${Math.round((job.progress || 0) * 100)}%). ` +
		`Call export_openusd again with job="${job.job}" in a few seconds for the files.`
	);
}

function asResult(job) {
	if (job.status === 'error') {
		return toolError(job.error || 'The export failed on the worker. Try again.', 'export_failed');
	}
	return {
		content: [{ type: 'text', text: job.status === 'done' ? doneText(job) : runningText(job) }],
		structuredContent: job,
	};
}

/**
 * The tool handler. Dependencies are injectable so a test can run it against a
 * loopback worker; production uses the defaults.
 */
export function createExportOpenUsdHandler({
	loadCreation = loadCreationForUsd,
	config = usdWorkerConfig,
	sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
	pollMs = POLL_MS,
} = {}) {
	return async function handler(args = {}, _auth, req) {
		try {
			if (args.job) return asResult(await pollUsdExport(args.job, { config }));
			if (req) {
				const rate = await limits.usdExportIp(clientIp(req));
				if (!rate.success)
					return toolError('Too many OpenUSD exports from this caller this hour. Try again later.', 'rate_limited');
			}
			const input = {
				id: args.creation_id,
				src: args.glb_url,
				prompt: args.prompt,
				label: args.label,
				size_m: args.size_m,
				density_kg_m3: args.density_kg_m3,
			};
			let job = await startUsdExport(input, { loadCreation, config });
			const waitS = Math.min(MAX_WAIT_S, Math.max(0, Number(args.wait_seconds ?? DEFAULT_WAIT_S) || 0));
			const deadline = Date.now() + waitS * 1000;
			while ((job.status === 'queued' || job.status === 'running') && Date.now() + pollMs <= deadline) {
				await sleep(pollMs);
				job = await pollUsdExport(job.job, { config });
			}
			return asResult(job);
		} catch (err) {
			if (err instanceof UsdExportError) return toolError(err.message, err.code);
			throw err;
		}
	};
}

export const toolDefs = [
	{
		name: 'export_openusd',
		title: 'Export a 3D model as simulation-ready OpenUSD',
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		description:
			'Convert a three.ws Forge model (creation_id) or any public GLB (glb_url) into a validated OpenUSD package ' +
			'for NVIDIA Omniverse and Isaac Sim, with physics already set up: convex collision hulls (CoACD), a rigid ' +
			'body whose mass is hull volume times a density for the object class, a friction and restitution material, ' +
			'semantic class labels for synthetic-data annotators, and UsdSkel skeletons and animations for rigged ' +
			'avatars. Z-up, meters, standing on the ground at the origin. Every file passes OpenUSD usdchecker and the ' +
			'NVIDIA asset validator before it is returned. Returns .usdz, .usd (zipped with textures), .usda and a ' +
			'report.json with the mass method and every validator finding. Takes 10 to 60 s: the tool waits up to ' +
			'wait_seconds, otherwise returns a job; call again with job to collect the files. Free, no account needed. ' +
			'Docs: https://three.ws/docs/openusd-export',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				creation_id: { type: 'string', description: 'A public or unlisted three.ws Forge creation id (UUID).' },
				glb_url: { type: 'string', format: 'uri', description: 'Public https URL of a .glb, when there is no creation id.' },
				job: { type: 'string', description: 'A job id a previous call returned; polls it instead of starting an export.' },
				prompt: { type: 'string', maxLength: 2000, description: 'What the object is. Picks the semantic class, typical size and density. Defaults to the creation prompt.' },
				label: { type: 'string', maxLength: 64, description: 'Override the semantic class label, e.g. "chair" or "robot".' },
				size_m: { type: 'number', exclusiveMinimum: 0.01, maximum: 500, description: 'Override the longest dimension in meters.' },
				density_kg_m3: { type: 'number', exclusiveMinimum: 1, maximum: 25000, description: 'Override the density used for mass (water is 1000).' },
				wait_seconds: { type: 'number', minimum: 0, maximum: MAX_WAIT_S, default: DEFAULT_WAIT_S, description: 'How long to wait for the export before returning the running job.' },
			},
		},
		handler: createExportOpenUsdHandler(),
	},
];

export default { toolDefs };
