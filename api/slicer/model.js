// GET /api/slicer/:id/model.stl, /api/slicer/:id/model.3mf
// GET /api/slicer/:id/:size mm/model.stl (for example /api/slicer/<id>/80mm/model.stl)
//
// A stored creation, converted on the fly into a file a 3D-printing slicer can
// open. This is the URL behind the "Open in OrcaSlicer" and "Open in Bambu
// Studio" buttons: their deep links (`orcaslicer://open?file=<url>`) download
// whatever URL they are handed and pick the importer from the LAST path
// segment, so the path has to end in a literal `model.stl` and carry no query
// string. vercel.json rewrites the pretty path onto this handler.
//
// The file is print-ready, not just converted: Z-up, millimetres, resting on
// the bed and centred (api/_lib/print/slicer.js). Geometry comes from the same
// loader and exporters Materialize uses (api/_lib/print/), so the STL a slicer
// receives here is byte-for-byte the kind a print bureau receives there.
//
// Public creations and unlisted ones (which are reachable by link anyway) are
// served; private ones are a 404, exactly like /api/forge-creation. Responses
// are immutable per (id, format, size), so they carry a long CDN lifetime and a
// strong ETag, and a small in-process cache keeps a slicer's retry from
// converting the model twice.

import { createHash } from 'node:crypto';

import { cors, error, method, rateLimited, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { getPublicCreation } from '../_lib/forge-store.js';
import { loadMeshFromUrl, MeshIoError } from '../_lib/print/mesh-io.js';
import { exportStl } from '../_lib/print/export-stl.js';
import { export3mf } from '../_lib/print/export-3mf.js';
import { placeOnBed, SIZE_LIMITS_MM } from '../_lib/print/slicer.js';

export const FORMATS = Object.freeze({
	stl: { contentType: 'model/stl' },
	'3mf': { contentType: 'model/3mf' },
});

// A slicer handoff is for a single printable part. Above this the STL alone
// passes 75 MB and slicers struggle; Materialize's own cap is 2M for orders a
// person has deliberately sized and paid for.
export const MAX_SLICER_TRIANGLES = 1_500_000;

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_ENTRIES = 12;
const CACHE_BYTES = 256 * 1024 * 1024;

const MESH_ERROR_STATUS = {
	invalid_model: 422,
	no_geometry: 422,
	too_large: 413,
	too_complex: 413,
	invalid_url: 422,
	fetch_failed: 502,
};

function slug(text) {
	return (
		String(text || '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'model'
	);
}

/** The production source: a finished public creation's GLB, through the SSRF-safe fetcher. */
export async function loadCreationMesh(id, { color }) {
	const creation = await getPublicCreation({ id });
	if (!creation?.glb_url) return null;
	const mesh = await loadMeshFromUrl(creation.glb_url, { maxTriangles: MAX_SLICER_TRIANGLES, color });
	return { mesh, title: creation.prompt };
}

function readParams(req) {
	const url = new URL(req.url, 'http://localhost');
	const q = req.query || {};
	const pick = (k) => String(q[k] ?? url.searchParams.get(k) ?? '').trim();
	return { id: pick('id').toLowerCase(), format: pick('format').toLowerCase(), size: pick('size') };
}

/**
 * Build the handler. `loadSource(id, { color })` resolves to `{ mesh, title }`
 * (mesh as api/_lib/print/mesh-io.js returns it) or null when the creation is
 * not public. Production uses loadCreationMesh; the test suite hands in a GLB it
 * builds itself, because the production fetcher refuses loopback hosts.
 */
export function createSlicerModelHandler({ loadSource = loadCreationMesh } = {}) {
	const cache = new Map();
	let cachedBytes = 0;

	function remember(key, entry) {
		cache.set(key, entry);
		cachedBytes += entry.body.length;
		while (cache.size > CACHE_ENTRIES || cachedBytes > CACHE_BYTES) {
			const [oldest, value] = cache.entries().next().value;
			cache.delete(oldest);
			cachedBytes -= value.body.length;
		}
	}

	async function convert(id, format, sizeMm) {
		const source = await loadSource(id, { color: format === '3mf' });
		if (!source) return null;
		const placed = placeOnBed(source.mesh.positions, { sizeMm });
		const mesh = { positions: placed.positions, indices: source.mesh.indices, colors: source.mesh.colors };
		const sizeLabel = placed.sizeMm.map((n) => n.toFixed(1)).join(' x ');
		const body =
			format === 'stl'
				? exportStl(mesh, { scale: 1, header: `three.ws ${id.slice(0, 8)} mm ${sizeLabel}` })
				: export3mf(mesh, { scale: 1, title: String(source.title || '').slice(0, 200), designer: 'three.ws' });
		const digest = createHash('sha256').update(body).digest('hex').slice(0, 32);
		return {
			body,
			etag: `"slc-${digest}"`,
			filename: `${slug(source.title)}${sizeMm ? `-${sizeMm}mm` : ''}.${format}`,
			triangles: mesh.indices.length / 3,
			sizeLabel,
			mode: placed.mode,
		};
	}

	return wrap(async (req, res) => {
		if (cors(req, res, { origins: '*', methods: 'GET,HEAD,OPTIONS', payments: false })) return;
		if (!method(req, res, ['GET'])) return; // HEAD is folded into GET and its body stripped

		const { id, format, size } = readParams(req);
		if (!isUuid(id)) return error(res, 400, 'validation_error', 'id must be a creation id (a UUID).');
		if (!FORMATS[format]) return error(res, 400, 'validation_error', 'format must be stl or 3mf.');
		let sizeMm = null;
		if (size) {
			sizeMm = Number(size);
			if (!Number.isInteger(sizeMm) || sizeMm < SIZE_LIMITS_MM[0] || sizeMm > SIZE_LIMITS_MM[1]) {
				return error(
					res,
					400,
					'validation_error',
					`size must be a whole number of millimetres from ${SIZE_LIMITS_MM[0]} to ${SIZE_LIMITS_MM[1]}.`,
				);
			}
		}

		const key = `${id}:${format}:${sizeMm ?? 'auto'}`;
		let entry = cache.get(key);
		if (!entry) {
			const rate = await limits.slicerFileIp(clientIp(req));
			if (!rate.success) return rateLimited(res, rate, 'too many slicer file conversions');
			try {
				entry = await convert(id, format, sizeMm);
			} catch (err) {
				if (err instanceof MeshIoError) {
					return error(res, MESH_ERROR_STATUS[err.code] ?? 422, err.code, err.message, err.extra || {});
				}
				throw err;
			}
			if (!entry) {
				return error(res, 404, 'creation_not_found', 'No finished public creation with that id.');
			}
			remember(key, entry);
		}

		res.setHeader('cache-control', CACHE_CONTROL);
		res.setHeader('etag', entry.etag);
		res.setHeader('x-slicer-size-mm', entry.sizeLabel);
		res.setHeader('x-slicer-scale', entry.mode);
		res.setHeader('access-control-expose-headers', 'etag, x-slicer-size-mm, x-slicer-scale, content-disposition');
		const inm = req.headers['if-none-match'];
		if (inm && inm.split(',').some((tag) => tag.trim() === entry.etag)) {
			res.statusCode = 304;
			res.end();
			return;
		}
		res.statusCode = 200;
		res.setHeader('content-type', FORMATS[format].contentType);
		res.setHeader('content-length', String(entry.body.length));
		res.setHeader('content-disposition', `attachment; filename="${entry.filename}"`);
		res.setHeader('x-content-type-options', 'nosniff');
		res.end(entry.body);
	});
}

export default createSlicerModelHandler();
