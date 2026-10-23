/**
 * GET /api/x-video/download?url=<video.twimg.com or pbs.twimg.com URL>&handle=<h>&id=<postId>
 *   → streams the file as an attachment.
 *
 * Browsers cannot save a cross-origin video with the download attribute, so
 * the page routes the click through here. Restricted to X's two media CDN
 * hosts, https only, and redirects are never followed, so it cannot be turned
 * into an open proxy.
 */

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { cors, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { assertMediaUrl, downloadFilename, XPostError } from '../_lib/x-syndication.js';

const MAX_BYTES = 512 * 1024 * 1024;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.xVideoDownload(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const q = new URL(req.url, 'http://localhost').searchParams;
	let target;
	try {
		target = assertMediaUrl(q.get('url') || '');
	} catch (err) {
		if (err instanceof XPostError) return json(res, err.status, { error: 'invalid_media_url', message: err.message });
		throw err;
	}

	let upstream;
	try {
		upstream = await fetch(target, {
			redirect: 'manual',
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; three.ws)', Referer: 'https://x.com/' },
			signal: AbortSignal.timeout(30_000),
		});
	} catch {
		return json(res, 502, { error: 'upstream_unreachable', message: 'Could not reach the X media CDN. Try again in a minute.' });
	}
	if (!upstream.ok || !upstream.body) {
		const status = upstream.status === 404 ? 404 : 502;
		return json(res, status, { error: 'media_unavailable', message: 'X did not return this file. It may have expired; read the post again for a fresh link.' });
	}
	const length = Number(upstream.headers.get('content-length') || 0);
	if (length > MAX_BYTES) return json(res, 413, { error: 'too_large', message: 'This file is too large to proxy.' });

	const isImage = target.hostname === 'pbs.twimg.com';
	const ext = isImage ? (target.pathname.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] ?? 'jpg') : 'mp4';
	res.statusCode = 200;
	res.setHeader('Content-Type', upstream.headers.get('content-type') || (isImage ? 'image/jpeg' : 'video/mp4'));
	if (length) res.setHeader('Content-Length', String(length));
	res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename(q.get('handle'), q.get('id'), ext)}"`);
	res.setHeader('Cache-Control', 'private, no-store');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	try {
		await pipeline(Readable.fromWeb(upstream.body), res);
	} catch {
		res.destroy();
	}
});
