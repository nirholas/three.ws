// GET /api/assets — public asset library catalog.
//
// Returns a unified, filterable catalog of three.ws-hosted accessories,
// animations, and environments — the on-disk truth (public/accessories/,
// public/animations/, src/environments.js) exposed as a stable REST shape.
//
// Query params:
//   ?type=accessory|animation|environment   filter by top-level kind
//   ?kind=hat|glasses|earrings|outfit       filter accessories by subkind
//   ?loop=true|false                        filter animations by loopability
//   ?limit=<n>                              cap result count (default 200)
//
// Response:
//   { ok: true, total: <int>, items: [ { id, type, kind?, name, ...} ] }
//
// Cached at the edge for 1h; on-disk manifests are part of the deploy so the
// catalog is immutable per build.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cors, error, wrap } from '../_lib/http.js';

// In-process caches: the on-disk manifests don't change between requests
// on the same serverless instance.
let accessoriesCache = null;
let animationsCache = null;

async function loadAccessories() {
	if (accessoriesCache) return accessoriesCache;
	const raw = await readFile(
		path.resolve(process.cwd(), 'public/accessories/presets.json'),
		'utf-8',
	);
	const items = JSON.parse(raw);
	accessoriesCache = items.map((a) => ({
		id: a.id,
		type: 'accessory',
		kind: a.kind,
		name: a.name,
		thumbnail: a.thumbnail || null,
		glb_url: a.glbUrl || null,
		attach_bone: a.attachBone || null,
		morph_binding: a.morphBinding || null,
	}));
	return accessoriesCache;
}

async function loadAnimations() {
	if (animationsCache) return animationsCache;
	const raw = await readFile(
		path.resolve(process.cwd(), 'public/animations/manifest.json'),
		'utf-8',
	);
	const items = JSON.parse(raw);
	animationsCache = items.map((a) => ({
		id: a.name,
		type: 'animation',
		name: a.label || a.name,
		clip_url: a.url,
		icon: a.icon || null,
		loop: a.loop === true,
	}));
	return animationsCache;
}

// Environments are sourced from a JS module so we duplicate the data here
// to avoid bundling client modules into a server handler.
const ENVIRONMENTS = [
	{ id: 'none', type: 'environment', name: 'None', path: null },
	{ id: 'neutral', type: 'environment', name: 'Neutral', path: null },
	{
		id: 'venice-sunset',
		type: 'environment',
		name: 'Venice Sunset',
		path: 'https://storage.googleapis.com/donmccurdy-static/venice_sunset_1k.exr',
		format: '.exr',
	},
	{
		id: 'footprint-court',
		type: 'environment',
		name: 'Footprint Court',
		path: 'https://storage.googleapis.com/donmccurdy-static/footprint_court_2k.exr',
		format: '.exr',
	},
];

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (req.method !== 'GET') {
		return error(res, 405, 'method_not_allowed', `method ${req.method} not allowed`);
	}

	const url = new URL(req.url, 'http://x');
	const type = (url.searchParams.get('type') || '').trim().toLowerCase();
	const kind = (url.searchParams.get('kind') || '').trim().toLowerCase();
	const loopParam = url.searchParams.get('loop');
	const limit = Math.max(
		1,
		Math.min(500, Number.parseInt(url.searchParams.get('limit') || '200', 10) || 200),
	);

	const buckets = [];
	if (!type || type === 'accessory') {
		try {
			buckets.push(await loadAccessories());
		} catch (err) {
			return error(res, 500, 'manifest_unreadable', `accessories: ${err?.message}`);
		}
	}
	if (!type || type === 'animation') {
		try {
			buckets.push(await loadAnimations());
		} catch (err) {
			return error(res, 500, 'manifest_unreadable', `animations: ${err?.message}`);
		}
	}
	if (!type || type === 'environment') {
		buckets.push(ENVIRONMENTS);
	}

	let items = buckets.flat();

	if (kind) items = items.filter((i) => i.kind === kind);
	if (loopParam === 'true') items = items.filter((i) => i.type === 'animation' && i.loop === true);
	if (loopParam === 'false') items = items.filter((i) => i.type === 'animation' && i.loop === false);

	const total = items.length;
	items = items.slice(0, limit);

	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
	res.setHeader('access-control-allow-origin', '*');
	res.statusCode = 200;
	res.end(JSON.stringify({ ok: true, total, items }));
});
