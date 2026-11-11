// POST /api/minecraft-export: turn a Forge model into a Minecraft: Bedrock
// Edition build.
//
// Body: { creationId? | glbUrl?, height?: 16-128, palette?: preset, fill?:
// 'solid'|'shell', dither?: boolean, levels?: 'auto'|'none', name?: string,
// format?: 'preview'|'mcpack' }
//
// format 'preview' (default) returns JSON: grid size, block counts per block,
// which color input was used (texture, vertex colors, or flat material), and
// the visible voxels packed 4 bytes each for the in-page instanced preview.
// format 'mcpack' returns the behavior pack itself as a download.
//
// The voxelizer is CPU work bounded three ways: the GLB byte and triangle caps
// from the print loader, the voxelizer's sample and grid caps, and a wall-clock
// deadline per request. The parsed mesh is cached per URL so dragging the
// height slider re-voxelizes without re-downloading and re-decoding textures.
//
// Not an official Minecraft product. Not approved by or associated with Mojang
// or Microsoft.

import { cors, error, json, method, rateLimited, readJson, wrap } from './_lib/http.js';
import { clientIp, limits } from './_lib/rate-limit.js';
import { loadMeshFromUrl, MeshIoError } from './_lib/print/mesh-io.js';
import { getPublicCreation } from './_lib/forge-store.js';
import { buildBedrockGrid, packageBuild, previewPayload } from './_lib/minecraft/export.js';
import { PALETTE_PRESETS, PaletteError } from './_lib/minecraft/bedrock-palette.js';
import { MAX_HEIGHT, MIN_HEIGHT, VoxelizeError } from './_lib/minecraft/voxelize.js';
import { structureName } from './_lib/minecraft/mcstructure.js';

// Forge GLBs are 2-30 MB; 60 MB and 1.5M triangles leave room for uploads
// while keeping one request well inside the deadline.
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_TRIANGLES = 1_500_000;
const DEADLINE_MS = 25_000;
const MESH_CACHE_SIZE = 3;
const MESH_CACHE_TTL_MS = 10 * 60_000;

const MESH_ERROR_STATUS = {
	invalid_model: 422,
	no_geometry: 422,
	too_large: 413,
	too_complex: 413,
	invalid_url: 400,
	fetch_failed: 502,
};
const VOXEL_ERROR_STATUS = { no_geometry: 422, too_complex: 413, timeout: 503 };

const meshCache = new Map();
async function cachedMesh(url) {
	const now = Date.now();
	const hit = meshCache.get(url);
	if (hit && now - hit.at < MESH_CACHE_TTL_MS) {
		meshCache.delete(url);
		meshCache.set(url, hit);
		return hit.mesh;
	}
	const pending = loadMeshFromUrl(url, { surface: true, maxBytes: MAX_BYTES, maxTriangles: MAX_TRIANGLES });
	const entry = { at: now, mesh: pending };
	meshCache.set(url, entry);
	while (meshCache.size > MESH_CACHE_SIZE) meshCache.delete(meshCache.keys().next().value);
	try {
		const mesh = await pending;
		// Drop the gltf-transform document and raw bytes; the voxelizer reads only arrays.
		const slim = { positions: mesh.positions, indices: mesh.indices, colors: mesh.colors, surface: mesh.surface, vertexColored: mesh.vertexColored, triangleCount: mesh.triangleCount };
		entry.mesh = Promise.resolve(slim);
		return slim;
	} catch (err) {
		meshCache.delete(url);
		throw err;
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rate = await limits.minecraftExportIp(clientIp(req));
	if (!rate.success) return rateLimited(res, rate, 'too many export requests');

	const body = await readJson(req, 8_000).catch(() => null);
	if (!body || typeof body !== 'object') return error(res, 400, 'validation_error', 'a JSON body is required');

	let sourceUrl = typeof body.glbUrl === 'string' ? body.glbUrl.trim() : '';
	let title = typeof body.name === 'string' ? body.name.trim().slice(0, 48) : '';
	if (typeof body.creationId === 'string' && body.creationId.trim()) {
		const creation = await getPublicCreation({ id: body.creationId.trim() });
		if (creation?.glb_url) {
			sourceUrl = creation.glb_url;
			if (!title) title = String(creation.prompt || '').slice(0, 48);
		} else if (!sourceUrl) {
			// A private or unsaved creation is still exportable by its GLB URL,
			// which the Forge page always knows; only a bare unknown id fails.
			return error(res, 404, 'creation_not_found', 'No finished public creation with that id.');
		}
	}
	if (!sourceUrl) return error(res, 400, 'validation_error', 'Pass a creationId or a glbUrl to export.');

	const height = Number(body.height ?? 64);
	if (!Number.isFinite(height) || height < MIN_HEIGHT || height > MAX_HEIGHT) {
		return error(res, 400, 'validation_error', `height must be between ${MIN_HEIGHT} and ${MAX_HEIGHT} blocks`);
	}
	const palette = typeof body.palette === 'string' ? body.palette : 'all';
	if (!PALETTE_PRESETS[palette]) {
		return error(res, 400, 'invalid_palette', `palette must be one of ${Object.keys(PALETTE_PRESETS).join(', ')}`);
	}
	const fill = body.fill === 'shell' ? 'shell' : 'solid';
	const format = body.format === 'mcpack' ? 'mcpack' : 'preview';
	// Every pack's structures share the threews: namespace in a world, so an
	// unnamed export gets a distinct id from the model file rather than a
	// generic one that a second import would overwrite.
	const fileStem = (sourceUrl.split('?')[0].split('/').pop() || '').replace(/\.glb$/i, '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
	const name = structureName(body.name || title || (fileStem ? `forge_${fileStem}` : 'build'));

	const deadline = Date.now() + DEADLINE_MS;
	let built;
	try {
		const mesh = await cachedMesh(sourceUrl);
		built = buildBedrockGrid(mesh, { height, fill, palette, dither: body.dither === true, levels: body.levels === 'none' ? 'none' : 'auto', deadline });
	} catch (err) {
		if (err instanceof MeshIoError) return error(res, MESH_ERROR_STATUS[err.code] ?? 422, err.code, err.message, err.extra || {});
		if (err instanceof VoxelizeError) return error(res, VOXEL_ERROR_STATUS[err.code] ?? 422, err.code, err.message);
		if (err instanceof PaletteError) return error(res, 400, err.code, err.message);
		throw err;
	}

	if (built.stats.blockCount === 0) {
		return error(res, 422, 'empty_build', 'The model produced no blocks at this height. Try a larger height.');
	}

	if (format === 'mcpack') {
		const pack = packageBuild(built, { name, title: title || name, sourceUrl });
		const bytes = Buffer.from(pack.bytes);
		res.statusCode = 200;
		res.setHeader('content-type', 'application/octet-stream');
		res.setHeader('content-length', String(bytes.length));
		res.setHeader('content-disposition', `attachment; filename="${name}.mcpack"`);
		res.setHeader('cache-control', 'no-store');
		res.setHeader('x-content-type-options', 'nosniff');
		res.setHeader('x-structure-ids', pack.structures.map((s) => s.id).join(','));
		res.setHeader('x-block-count', String(built.stats.blockCount));
		res.setHeader('access-control-expose-headers', 'content-disposition, x-structure-ids, x-block-count');
		res.end(bytes);
		return;
	}

	const { used, ...stats } = built.stats;
	return json(res, 200, {
		ok: true,
		name,
		// A build wider than one structure block ships as tiles (name_0_0, ...),
		// placed together by the function; a single tile loads by this id.
		structureId: stats.tiles === 1 ? `threews:${name}` : null,
		functionName: `threews/${name}`,
		stats,
		preview: previewPayload(built),
		palettes: Object.fromEntries(Object.entries(PALETTE_PRESETS).map(([k, v]) => [k, v.label])),
	}, { 'cache-control': 'no-store' });
});
