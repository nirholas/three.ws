/**
 * Progressive avatar streaming - GET /api/avatar-stream
 * -----------------------------------------------------
 * GET /api/avatar-stream?src=/avatars/michelle.glb   (or ?src=<absolute glb url>)
 * GET /api/avatar-stream?src=...&format=json         (header only, no payload)
 *
 * Packs a GLB into an A3S stream (see specs/AVATAR_STREAM.md) and serves it as a
 * static-shaped byte range. The interesting property is that the response is an
 * ordinary file: a client asks for `bytes=0-56035`, gets a complete spec-valid
 * GLB back, and renders it. Refinement is more of the same file, so no socket,
 * no session, and nothing here that a CDN cannot cache and serve itself.
 *
 * Packing is deterministic for a given source, so the result is cached in
 * process and served with a long immutable TTL keyed by the source hash.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

import { cors, error, json, method, rateLimited, wrap } from './_lib/http.js';
import { clientIp, limits } from './_lib/rate-limit.js';
import { fetchModel } from './_lib/fetch-model.js';
import { pack } from '../packages/avatar-stream/src/pack.js';
import { decodeHeader, decodePreamble } from '../packages/avatar-stream/src/format.js';

/** Where locally-hosted avatars live, relative to the repo root. */
const PUBLIC_ROOT = new URL('../public/', import.meta.url).pathname;

/** Bounded in-process cache. Packing is CPU-bound, so repeat hits must be free. */
const CACHE_LIMIT = 12;
const cache = new Map();

function cacheGet(key) {
	const hit = cache.get(key);
	if (!hit) return null;
	// Refresh recency.
	cache.delete(key);
	cache.set(key, hit);
	return hit;
}

function cacheSet(key, value) {
	cache.set(key, value);
	while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

// Remote sources are avatars, not archives: anything past this is refused
// mid-stream rather than buffered.
const MAX_REMOTE_BYTES = 64 * 1024 * 1024;
const CALLER_FAULT_CODES = new Set(['invalid_url', 'scheme_not_allowed', 'private_address', 'host_pin_mismatch']);

/**
 * Resolve `src` to GLB bytes.
 *
 * A site-relative path is read off disk, which keeps the platform's own avatars
 * off the network. An absolute URL must be https and is fetched through the
 * SSRF-guarded model fetcher (api/_lib/fetch-model.js).
 */
async function loadSource(src) {
	if (/^https:\/\//i.test(src)) {
		// Caller-supplied source URL, so it goes through fetchModel: the host is
		// resolved on our side and refused if any address is private, loopback
		// or metadata, the socket is pinned to the validated address, every
		// redirect hop is re-checked, and the body is capped while streaming.
		// The timeout keeps a stalled host from holding the request open.
		try {
			const { bytes } = await fetchModel(src, { maxBytes: MAX_REMOTE_BYTES, timeoutMs: 20_000 });
			return bytes;
		} catch (err) {
			const code = err?.code || 'fetch_failed';
			const status = code === 'file_too_large' ? 413 : CALLER_FAULT_CODES.has(code) ? 400 : 502;
			throw Object.assign(new Error(err?.message || 'could not fetch src'), { status });
		}
	}
	if (!src.startsWith('/')) {
		throw Object.assign(new Error('src must be a site-relative path or an https URL'), { status: 400 });
	}
	// normalize() collapses any ".." before the prefix check, so a crafted path
	// cannot walk out of public/.
	const resolved = normalize(join(PUBLIC_ROOT, src));
	if (!resolved.startsWith(PUBLIC_ROOT)) {
		throw Object.assign(new Error('src escapes the public root'), { status: 400 });
	}
	if (!/\.glb$/i.test(resolved)) {
		throw Object.assign(new Error('src must name a .glb'), { status: 400 });
	}
	try {
		return new Uint8Array(await readFile(resolved));
	} catch {
		throw Object.assign(new Error('no such avatar'), { status: 404 });
	}
}

/** Parse a single `bytes=a-b` range against a known length. */
export function parseRange(rangeHeader, size) {
	if (!rangeHeader) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
	if (!match) return { unsatisfiable: true };
	const [, rawStart, rawEnd] = match;
	if (rawStart === '' && rawEnd === '') return { unsatisfiable: true };
	let start;
	let end;
	if (rawStart === '') {
		// Suffix range: the last N bytes.
		const suffix = Number(rawEnd);
		if (!suffix) return { unsatisfiable: true };
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
	}
	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
		return { unsatisfiable: true };
	}
	return { start, end };
}

async function buildStream(src) {
	const source = await loadSource(src);
	const sourceHash = createHash('sha256').update(source).digest('hex');
	const cached = cacheGet(sourceHash);
	if (cached) return cached;

	const { container } = await pack(source, { name: src.split('/').pop() });
	const preamble = decodePreamble(container);
	const entry = {
		container,
		preamble,
		header: decodeHeader(container, preamble),
		etag: `"a3s-${sourceHash.slice(0, 32)}"`,
	};
	cacheSet(sourceHash, entry);
	return entry;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,HEAD,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'HEAD'])) return;

	const url = new URL(req.url, 'http://localhost');
	const src = url.searchParams.get('src') || '';
	if (!src) return error(res, 400, 'missing_src', 'pass ?src=<path or https url to a .glb>');
	// A remote source costs a download plus a CPU-bound pack per distinct URL,
	// and the cache holds only a dozen, so remote packs get their own budget.
	if (/^https:\/\//i.test(src)) {
		const rl = await limits.avatarStreamRemoteIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl, 'too many remote avatar packs; try again shortly');
	}

	let entry;
	try {
		entry = await buildStream(src);
	} catch (err) {
		return error(res, err.status || 500, 'stream_failed', err.message);
	}

	// A JSON view of the header, so a client can plan its requests (or a human
	// can read the layer table) without downloading any geometry.
	if (url.searchParams.get('format') === 'json') {
		return json(res, 200, {
			src,
			preamble: entry.preamble,
			header: entry.header,
			firstRenderBytes: entry.preamble.baseOffset + entry.preamble.baseLength,
			ranges: entry.header.layers.map((layer) => ({
				level: layer.level,
				range: layer.level === 0 ? `bytes=0-${entry.preamble.baseOffset + entry.preamble.baseLength - 1}` : `bytes=${layer.offset}-${layer.offset + layer.length - 1}`,
			})),
		});
	}

	const { container, etag } = entry;
	const size = container.byteLength;
	res.setHeader('content-type', 'model/a3s');
	res.setHeader('accept-ranges', 'bytes');
	res.setHeader('etag', etag);
	// Deterministic output keyed by content hash, so this is safe to hold forever.
	res.setHeader('cache-control', 'public, max-age=31536000, immutable');
	res.setHeader('x-a3s-layers', String(entry.header.layers.length));
	res.setHeader('x-a3s-base-bytes', String(entry.preamble.baseOffset + entry.preamble.baseLength));

	if (req.headers['if-none-match'] === etag) {
		res.statusCode = 304;
		return res.end();
	}

	const range = parseRange(req.headers.range, size);
	if (range?.unsatisfiable) {
		res.statusCode = 416;
		res.setHeader('content-range', `bytes */${size}`);
		return res.end();
	}

	if (range) {
		const body = container.subarray(range.start, range.end + 1);
		res.statusCode = 206;
		res.setHeader('content-range', `bytes ${range.start}-${range.end}/${size}`);
		res.setHeader('content-length', String(body.byteLength));
		return res.end(req.method === 'HEAD' ? undefined : Buffer.from(body));
	}

	res.statusCode = 200;
	res.setHeader('content-length', String(size));
	return res.end(req.method === 'HEAD' ? undefined : Buffer.from(container));
});
