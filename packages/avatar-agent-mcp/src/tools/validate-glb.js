// `validate_glb` — run Khronos's official `gltf-validator` against any
// GLB URL and surface its findings (errors, warnings, infos, hints) with
// JSON-pointer locations and severity codes.
//
// This is the same validator the glTF Viewer (gltf.report) uses. It
// checks the entire spec compliance surface: accessor bounds, animation
// channel targets, image data integrity, extension usage, etc.

import { z } from 'zod';
import validator from 'gltf-validator';

import { fetchGlbBytes } from '../lib/glb-io.js';
import { resultShape, upstreamObject } from '../lib/output-shapes.js';

const SEVERITIES = ['error', 'warning', 'info', 'hint'];

const issueBucket = z.array(
	upstreamObject({
		code: z.string(),
		message: z.string(),
		pointer: z.string().nullable(),
		offset: z.number().nullable(),
	}),
);

const outputSchema = resultShape({
	url: z.string().optional().describe('The validated GLB URL (echoed).'),
	sizeBytes: z.number().optional(),
	validatorVersion: z.string().nullable().optional(),
	mimeType: z.string().nullable().optional(),
	validated: z.string().optional().describe('ISO timestamp of the validation run.'),
	summary: z
		.object({
			numErrors: z.number(),
			numWarnings: z.number(),
			numInfos: z.number(),
			numHints: z.number(),
			truncated: z.boolean(),
		})
		.optional(),
	info: upstreamObject({})
		.nullable()
		.optional()
		.describe("The Khronos validator's structural info report, passed through verbatim."),
	issues: z
		.object({ error: issueBucket, warning: issueBucket, info: issueBucket, hint: issueBucket })
		.optional(),
});

function classify(messages = []) {
	const buckets = { error: [], warning: [], info: [], hint: [] };
	for (const m of messages) {
		const sev = SEVERITIES[m.severity] || 'info';
		buckets[sev].push({
			code: m.code,
			message: m.message,
			pointer: m.pointer || null,
			offset: m.offset ?? null,
		});
	}
	return buckets;
}

export const def = {
	name: 'validate_glb',
	title: 'Validate a GLB / glTF against the Khronos spec',
	// MCP ToolAnnotations — safety hints surfaced to MCP clients.
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Run the official Khronos gltf-validator against a GLB URL. Returns errors, warnings, infos, and hints with codes + JSON pointers, plus structural counts (animations, materials, etc.) per the validator\'s info report. The same engine that powers gltf.report. Use this to find out why a GLB fails to load or renders wrong; for counts and file size alone, inspect_glb is lighter.',
	inputSchema: {
		url: z.string().describe('Public URL or data: URL of a .glb / .gltf file to validate.'),
		maxIssues: z.number().int().min(1).max(2000).optional()
			.describe('Cap on issues returned in each bucket (default 100). Validator may still scan all of them.'),
	},
	outputSchema,
	async handler(args) {
		const { url } = args || {};
		if (!url) return { ok: false, error: 'invalid_input', message: 'url is required' };
		const cap = args?.maxIssues || 100;
		let bytes;
		try {
			bytes = await fetchGlbBytes(url);
		} catch (err) {
			return { ok: false, error: 'fetch_failed', message: err.message };
		}

		let report;
		try {
			report = await validator.validateBytes(new Uint8Array(bytes), {
				uri: url,
				maxIssues: 2000,
				externalResourceFunction: async (resourceUri) => {
					// Fetch buffer/image references that live outside the GLB (rare
					// for .glb because everything's embedded, but supported here
					// for .gltf inputs).
					const r = await fetch(resourceUri);
					if (!r.ok) throw new Error(`external resource HTTP ${r.status}: ${resourceUri}`);
					return new Uint8Array(await r.arrayBuffer());
				},
			});
		} catch (err) {
			return { ok: false, error: 'validator_failed', message: err.message };
		}

		const buckets = classify(report.issues?.messages || []);
		for (const k of SEVERITIES) buckets[k] = buckets[k].slice(0, cap);

		return {
			ok: true,
			url,
			sizeBytes: bytes.byteLength,
			validatorVersion: report.validatorVersion || null,
			mimeType: report.mimeType || null,
			validated: report.validatedAt || new Date().toISOString(),
			summary: {
				numErrors: report.issues?.numErrors ?? 0,
				numWarnings: report.issues?.numWarnings ?? 0,
				numInfos: report.issues?.numInfos ?? 0,
				numHints: report.issues?.numHints ?? 0,
				truncated: !!report.issues?.truncated,
			},
			info: report.info || null,
			issues: buckets,
		};
	},
};
