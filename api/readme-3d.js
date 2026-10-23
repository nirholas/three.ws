/**
 * README 3D: turn any model URL into a block GitHub renders as interactive 3D.
 *
 *   POST /api/readme-3d  { url, budget?, facets?, name?, details? }
 *     → { markdown, facets, source_facets, bytes, github_limit_bytes, fits_github }
 *
 * `markdown` is a ```stl fence ready to paste into a README (or wrapped in a
 * <details> disclosure when `details: true`). GitHub renders ASCII STL fences
 * natively but stops rendering a markdown file past 512 KB, so the mesh is
 * decimated to a byte budget (default 150 KB, max 400 KB) with the readme-3d
 * package's own meshoptimizer pass. The model is fetched through the same
 * SSRF-hardened fetcher as the MCP 3D tools. Accepts .glb, .gltf (single
 * file), .obj and .stl. Package: packages/readme-3d. Page: /readme-3d.
 */

import { convertBytes, toMarkdown, GITHUB_MARKDOWN_LIMIT } from '../packages/readme-3d/src/index.js';
import { cors, error, json, method, rateLimited, readJson, wrap } from './_lib/http.js';
import { clientIp, limits } from './_lib/rate-limit.js';
import { fetchModel, FetchModelError } from './_lib/fetch-model.js';

const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const DEFAULT_BUDGET_BYTES = 150 * 1024;
const MIN_BUDGET_BYTES = 8 * 1024;
const MAX_BUDGET_BYTES = 400 * 1024;
const MAX_FACETS = 6000;

const CALLER_FAULT = new Set([
	'invalid_url',
	'scheme_not_allowed',
	'private_address',
	'blocked_host',
	'dns_failed',
	'too_many_redirects',
	'file_too_large',
]);

function modelExtension(bytes, filename) {
	if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
		return '.glb';
	}
	const m = /\.(glb|gltf|obj|stl)$/i.exec(filename || '');
	return m ? `.${m[1].toLowerCase()}` : null;
}

function intInRange(value, min, max, fallback) {
	if (value === undefined || value === null) return fallback;
	const n = Number(value);
	if (!Number.isFinite(n)) return NaN;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.readme3dIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = await readJson(req, 16 * 1024);
	} catch (err) {
		return error(res, err.status || 400, 'invalid_body', err.message);
	}
	if (!body || typeof body !== 'object' || typeof body.url !== 'string' || !body.url.trim()) {
		return error(res, 400, 'validation_error', 'url (a public https model URL) is required');
	}

	const budget = intInRange(body.budget, MIN_BUDGET_BYTES, MAX_BUDGET_BYTES, DEFAULT_BUDGET_BYTES);
	const facets = intInRange(body.facets, 16, MAX_FACETS, MAX_FACETS);
	if (Number.isNaN(budget) || Number.isNaN(facets)) {
		return error(res, 400, 'validation_error', 'budget (bytes) and facets must be numbers');
	}
	const name = String(body.name ?? 'model').replace(/[^\w.-]+/g, '-').slice(0, 48) || 'model';

	let model;
	try {
		model = await fetchModel(body.url.trim(), { maxBytes: MAX_SOURCE_BYTES, timeoutMs: 25_000 });
	} catch (err) {
		if (err instanceof FetchModelError) {
			const status = CALLER_FAULT.has(err.code) ? (err.code === 'file_too_large' ? 413 : 400) : 502;
			return error(res, status, err.code, err.message);
		}
		throw err;
	}

	const ext = modelExtension(model.bytes, model.filename);
	if (!ext) {
		return error(res, 415, 'unsupported_format', 'the URL must serve a .glb, .gltf, .obj or .stl model');
	}

	let result;
	try {
		result = await convertBytes(model.bytes, ext, { budget, facets, name });
	} catch (err) {
		return error(res, 422, 'conversion_failed', err.message);
	}

	const markdown = toMarkdown(result.stl, { details: body.details === true });
	const markdownBytes = Buffer.byteLength(markdown);
	return json(
		res,
		200,
		{
			markdown,
			facets: result.facets,
			source_facets: result.sourceFacets,
			bytes: markdownBytes,
			github_limit_bytes: GITHUB_MARKDOWN_LIMIT,
			fits_github: markdownBytes < GITHUB_MARKDOWN_LIMIT,
		},
		{ 'cache-control': 'no-store' },
	);
});
