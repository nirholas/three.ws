// GET/POST /api/3d/engine-qa: FREE, keyless real-time-engine fitness report.
//
// Where /api/3d/inspect answers "is this valid glTF, and how heavy is it" and
// /api/sim-readiness answers "can a physics solver integrate this", this
// endpoint answers the question a game engine's import step asks: draw calls,
// material count, texel density, a per-LOD-level triangle budget (when a LOD
// chain is requested), and collider suitability (reusing the print pipeline's
// manifold/watertight analyzer). See api/_lib/engine-qa.js for the grading
// logic and api/_lib/print/{mesh-io,analyze,export-stl}.js for the reused
// print-pipeline checks.
//
// Input:
//   GET  /api/3d/engine-qa?url=<https url>&lods=1&format=stl
//   POST /api/3d/engine-qa            body { "url": "<https url>", "lods": true }
//   POST /api/3d/engine-qa            raw .glb bytes as the request body (?lods=1&format=stl)
//
// Output (format=json, the default):
//   { url, sizeBytes, report: <gradeEngineQa() output>, lods?: [...], ts }
//
// format=stl exports the mesh as binary STL (millimeters) when it is
// watertight; otherwise it answers 422 with the open-edge count rather than
// handing a slicer a silently broken file.
//
// `lods=1` builds a real LOD chain (packages/glb-tools's buildLodChain) before
// grading the triangle-budget check, which is real decimation work, so it
// carries its own, stricter rate limit.

import { cors, wrap, error, json, rateLimited, readJson, readBody } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { fetchModel, FetchModelError } from '../_lib/fetch-model.js';
import { gradeEngineQa } from '../_lib/engine-qa.js';
import { loadMesh, MeshIoError } from '../_lib/print/mesh-io.js';
import { analyzeMesh } from '../_lib/print/analyze.js';
import { exportStl, StlExportError } from '../_lib/print/export-stl.js';

// Same free-tier size cap as /api/3d/inspect: generous for real assets, bounded
// against an anonymous call spending unbounded memory/compute.
const MAX_BYTES = 32 * 1024 * 1024;

function httpError(status, code, message, extra = {}) {
	const e = new Error(message);
	e.status = status;
	e.code = code;
	e.extra = extra;
	return e;
}

async function fetchByUrl(url) {
	try {
		const { bytes, url: finalUrl } = await fetchModel(url, { maxBytes: MAX_BYTES, timeoutMs: 20_000 });
		return { bytes, url: finalUrl };
	} catch (err) {
		if (err instanceof FetchModelError) {
			if (err.code === 'file_too_large') {
				throw httpError(413, 'too_large', `model exceeds the ${MAX_BYTES}-byte free-tier cap`);
			}
			if (['invalid_url', 'scheme_not_allowed', 'private_address', 'host_pin_mismatch'].includes(err.code)) {
				throw httpError(400, 'invalid_url', err.message);
			}
			throw httpError(502, 'fetch_failed', `could not fetch model: ${err.message}`, {
				retry: 'the source URL did not return the model, check it is public and try again',
			});
		}
		throw httpError(502, 'fetch_failed', `could not fetch model: ${err?.message || err}`);
	}
}

const MESH_ERROR_STATUS = { invalid_model: 422, no_geometry: 422, too_large: 413, too_complex: 413 };

async function respondStl(res, bytes, sourceUrl) {
	let mesh;
	let analysis;
	try {
		mesh = await loadMesh(bytes, { color: false });
		analysis = await analyzeMesh(mesh, { sourceUrl });
	} catch (err) {
		if (err instanceof MeshIoError) {
			return error(res, MESH_ERROR_STATUS[err.code] ?? 422, err.code, err.message, err.extra || {});
		}
		throw err;
	}

	if (!analysis.watertight) {
		return error(res, 422, 'not_watertight', 'this mesh is not watertight; an STL export would be unprintable', {
			openEdges: analysis.open_edges,
			nonManifoldEdges: analysis.non_manifold_edges,
			shells: analysis.shells,
		});
	}

	let stl;
	try {
		stl = exportStl(mesh, { requireWatertight: true, openEdges: analysis.open_edges });
	} catch (err) {
		if (err instanceof StlExportError) return error(res, 422, err.code, err.message);
		throw err;
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'model/stl');
	res.setHeader('content-disposition', 'attachment; filename="model.stl"');
	res.setHeader('content-length', String(stl.length));
	res.setHeader('cache-control', sourceUrl ? 'public, max-age=60, s-maxage=300' : 'no-store');
	res.end(stl);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (req.method !== 'GET' && req.method !== 'POST') {
		res.setHeader('allow', 'GET, POST');
		return error(res, 405, 'method_not_allowed', 'use GET (?url=) or POST ({ url } or a raw model body)');
	}

	const query = req.query || {};
	const format = String(query.format || 'json').toLowerCase();
	const wantLods = ['1', 'true', 'yes'].includes(String(query.lods || '').toLowerCase());

	const ip = clientIp(req);
	const rl = await limits.apiIp(ip, { limit: 60, window: '1 m' });
	if (!rl.success) return rateLimited(res, rl, 'too many engine-qa requests');
	if (wantLods) {
		// Building a LOD chain is real decimation work (meshoptimizer), far
		// heavier than grading alone, so it gets its own tighter budget rather
		// than letting a handful of callers exhaust the generic bucket for
		// everyone grading without a LOD chain.
		const lodRl = await limits.apiIp(ip, { limit: 10, window: '5 m' });
		if (!lodRl.success) return rateLimited(res, lodRl, 'too many LOD-chain requests; grade without lods=1, or retry shortly');
	}

	let bytes;
	let sourceUrl = null;
	try {
		if (req.method === 'GET') {
			const url = String(query.url || '').trim();
			if (!url) return error(res, 400, 'missing_url', 'query param "url" is required (or POST a model body)');
			const fetched = await fetchByUrl(url);
			bytes = fetched.bytes;
			sourceUrl = fetched.url;
		} else {
			const ct = String(req.headers['content-type'] || '').toLowerCase();
			if (ct.includes('application/json')) {
				let body;
				try {
					body = await readJson(req);
				} catch (e) {
					return error(res, e.status === 415 ? 415 : 400, 'invalid_json', e.message || 'invalid JSON body');
				}
				const url = String(body?.url || '').trim();
				if (!url) return error(res, 400, 'missing_url', 'POST JSON must include "url", or upload raw model bytes');
				const fetched = await fetchByUrl(url);
				bytes = fetched.bytes;
				sourceUrl = fetched.url;
			} else {
				let raw;
				try {
					raw = await readBody(req, MAX_BYTES);
				} catch (e) {
					if (e.status === 413) return error(res, 413, 'too_large', `upload exceeds the ${MAX_BYTES}-byte free-tier cap`);
					return error(res, 400, 'bad_body', e.message || 'could not read request body');
				}
				if (!raw || raw.byteLength === 0) {
					return error(res, 400, 'empty_body', 'no model bytes uploaded, send a .glb body or a "url"');
				}
				bytes = Uint8Array.from(raw);
			}
		}
	} catch (e) {
		return error(res, e.status || 502, e.code || 'fetch_failed', e.message, e.extra || {});
	}

	if (format === 'stl') return respondStl(res, bytes, sourceUrl);
	if (format !== 'json') return error(res, 400, 'bad_format', 'format must be "json" or "stl"');

	let lodLevels = null;
	if (wantLods) {
		try {
			const { buildLodChain } = await import('../../packages/glb-tools/src/lod.js');
			const chain = await buildLodChain(bytes);
			lodLevels = chain.levels.map((l) => ({ name: l.name, ratio: l.ratio, triangleCount: l.triangleCount, vertexCount: l.vertexCount }));
		} catch (err) {
			return error(res, 422, 'lod_build_failed', `could not build a LOD chain: ${err?.message || err}`);
		}
	}

	let report;
	try {
		report = await gradeEngineQa(bytes, { lods: lodLevels });
	} catch (err) {
		return error(res, 422, 'invalid_model', `not a valid glTF/GLB: ${err?.message || 'could not parse model'}`);
	}

	const payload = { url: sourceUrl, sizeBytes: bytes.byteLength, report, ...(lodLevels ? { lods: lodLevels } : {}), ts: new Date().toISOString() };

	if (req.method === 'GET' && sourceUrl) {
		res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
	} else {
		res.setHeader('cache-control', 'no-store');
	}
	return json(res, 200, payload);
});
