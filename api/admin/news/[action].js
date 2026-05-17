// Local-only admin CRUD for the news/RSS feed.
//
// Endpoints:
//   GET  /api/admin/news/list             → list every item (incl. drafts)
//   POST /api/admin/news/save             → create/update one item
//   POST /api/admin/news/delete           → delete one item by id
//   POST /api/admin/news/upload-image     → upload a cover image
//
// Local-only: refuses to run on Vercel (process.env.VERCEL === '1') or any
// non-localhost host. The Vercel filesystem is read-only at runtime anyway,
// so writes would fail — this just returns a clean 403 with an explanation.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, error, method, cors, readJson, wrap } from '../../_lib/http.js';
import { loadCuratedItems } from '../../_lib/rss-feed.js';
import { writeAllPages } from '../../../scripts/build-news.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const ITEMS_FILE = path.join(ROOT, 'data', 'rss', 'items.json');
const IMAGES_DIR = path.join(ROOT, 'public', 'news-images');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg']);

function refuseIfNotLocal(req, res) {
	if (process.env.VERCEL === '1') {
		error(res, 403, 'local_only', 'The news admin runs only in local dev (vite/vercel-dev). The Vercel runtime filesystem is read-only.');
		return true;
	}
	const host = String(req.headers.host || '').toLowerCase();
	const isLocalHost = host === '' || host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('0.0.0.0');
	if (!isLocalHost && process.env.NODE_ENV === 'production') {
		error(res, 403, 'local_only', `The news admin only accepts localhost requests in production builds (host=${host}).`);
		return true;
	}
	return false;
}

async function readItemsFile() {
	const raw = await readFile(ITEMS_FILE, 'utf8');
	return JSON.parse(raw);
}

async function writeItemsFile(data) {
	const out = JSON.stringify(data, null, 2) + '\n';
	await writeFile(ITEMS_FILE, out, 'utf8');
}

// After items.json changes, regenerate every permalink page + the
// listing + the sitemap routes file. Same code path the prebuild runs.
async function regeneratePages() {
	const items = await loadCuratedItems();
	if (!items.length) return { written: 0, routes: 0 };
	return writeAllPages(items);
}

function sanitizeImageFilename(name) {
	const base = String(name || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
	if (!base) return '';
	const ext = base.split('.').pop();
	if (!ALLOWED_IMAGE_EXT.has(ext)) return '';
	return base.slice(0, 100);
}

const VALID_FIELDS = new Set([
	'id', 'slug', 'title', 'date', 'body_html', 'summary', 'author', 'tags',
	'image', 'image_alt', 'image_width', 'image_height',
	'og_title', 'og_description', 'external_link', 'link', 'published',
]);

function sanitizeItem(input) {
	const out = {};
	for (const [k, v] of Object.entries(input || {})) {
		if (!VALID_FIELDS.has(k)) continue;
		if (v === null || v === undefined || v === '') continue;
		out[k] = v;
	}
	if (typeof out.id !== 'string' || !out.id.trim()) {
		const err = new Error('id is required');
		err.status = 400;
		err.code = 'invalid_item';
		throw err;
	}
	if (typeof out.title !== 'string' || !out.title.trim()) {
		const err = new Error('title is required');
		err.status = 400;
		err.code = 'invalid_item';
		throw err;
	}
	if (typeof out.date !== 'string' || Number.isNaN(new Date(out.date).getTime())) {
		const err = new Error('date must be an ISO 8601 timestamp');
		err.status = 400;
		err.code = 'invalid_item';
		throw err;
	}
	if (typeof out.body_html !== 'string' || !out.body_html.trim()) {
		const err = new Error('body_html is required');
		err.status = 400;
		err.code = 'invalid_item';
		throw err;
	}
	if (Array.isArray(out.tags)) {
		out.tags = out.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase());
	}
	if (out.image && !out.image_alt) {
		const err = new Error('image_alt is required when image is set');
		err.status = 400;
		err.code = 'invalid_item';
		throw err;
	}
	return out;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: false })) return;
	if (refuseIfNotLocal(req, res)) return;

	const action = String(req.query?.action || '').toLowerCase();

	if (action === 'list') {
		if (!method(req, res, ['GET'])) return;
		const data = await readItemsFile();
		const items = Array.isArray(data?.items) ? data.items : [];
		return json(res, 200, { count: items.length, items });
	}

	if (action === 'save') {
		if (!method(req, res, ['POST'])) return;
		const body = await readJson(req);
		const item = sanitizeItem(body?.item);
		const data = await readItemsFile();
		const items = Array.isArray(data.items) ? data.items : [];
		const i = items.findIndex((e) => e.id === item.id);
		if (i >= 0) items[i] = item;
		else items.unshift(item);
		data.items = items;
		await writeItemsFile(data);
		const stats = await regeneratePages();
		return json(res, 200, { ok: true, item, rebuild: stats });
	}

	if (action === 'delete') {
		if (!method(req, res, ['POST'])) return;
		const body = await readJson(req);
		const id = String(body?.id || '').trim();
		if (!id) return error(res, 400, 'missing_id', 'id is required');
		const data = await readItemsFile();
		const items = Array.isArray(data.items) ? data.items : [];
		const before = items.length;
		data.items = items.filter((e) => e.id !== id);
		if (data.items.length === before) return error(res, 404, 'not_found', `no item with id "${id}"`);
		await writeItemsFile(data);
		const stats = await regeneratePages();
		return json(res, 200, { ok: true, removed: id, rebuild: stats });
	}

	if (action === 'upload-image') {
		if (!method(req, res, ['POST'])) return;
		const body = await readJson(req);
		const filename = sanitizeImageFilename(body?.filename);
		if (!filename) return error(res, 400, 'invalid_filename', 'filename must end in .jpg/.jpeg/.png/.webp/.gif/.svg');
		const dataB64 = typeof body?.data_base64 === 'string' ? body.data_base64 : '';
		if (!dataB64) return error(res, 400, 'missing_data', 'data_base64 is required');
		const buf = Buffer.from(dataB64.replace(/^data:[^;]+;base64,/, ''), 'base64');
		if (buf.length === 0) return error(res, 400, 'empty_payload', 'decoded image is 0 bytes');
		if (buf.length > MAX_IMAGE_BYTES) return error(res, 413, 'too_large', `image exceeds ${MAX_IMAGE_BYTES} bytes`);
		await mkdir(IMAGES_DIR, { recursive: true });
		await writeFile(path.join(IMAGES_DIR, filename), buf);
		return json(res, 200, { ok: true, path: `/news-images/${filename}`, bytes: buf.length });
	}

	return error(res, 404, 'unknown_action', `unknown action "${action}" (valid: list, save, delete, upload-image)`);
});
