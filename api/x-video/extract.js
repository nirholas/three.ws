/**
 * POST /api/x-video/extract  { url: "https://x.com/<handle>/status/<id>" }
 *   → 200 { post, videos, thumbnail, duration_ms, source }
 *
 * Free, keyless. Reads the post through api/_lib/x-syndication.js (syndication,
 * then fxtwitter, then guest GraphQL) and returns the post with its mp4 ladder.
 * 400 bad URL, 404 post unavailable or no video, 502 X unreachable.
 */

import { cors, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { readXPost, postVideoVariants, XPostError } from '../_lib/x-syndication.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.xVideoExtract(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req, 4_000).catch(() => null);
	let post;
	try {
		post = await readXPost(typeof body?.url === 'string' ? body.url : '');
	} catch (err) {
		if (err instanceof XPostError) {
			return json(res, err.status, { error: err.status === 404 ? 'post_unavailable' : err.status === 400 ? 'invalid_url' : 'upstream_unreachable', message: err.message });
		}
		throw err;
	}

	const videos = postVideoVariants(post);
	if (videos.length === 0) {
		return json(res, 404, {
			error: 'no_video',
			message: 'No video found in this post. Make sure the post actually contains a video or GIF.',
			post,
		});
	}
	const clip = post.media.find((m) => m.variants.length > 0);
	return json(res, 200, {
		post,
		videos,
		thumbnail: clip?.thumbnail ?? null,
		duration_ms: clip?.durationMs ?? null,
		source: post.source,
	});
});
