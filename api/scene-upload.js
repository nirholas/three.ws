/**
 * /api/scene-upload — direct-to-storage upload for Scene Capture source videos.
 *
 *   POST /api/scene-upload  { content_type, size_bytes }
 *                         → 200 { storage_key, upload_url, public_url, method, headers, expires_in }
 *
 * The browser PUTs the video bytes straight to `upload_url` (a short-lived R2
 * presigned URL), then submits `public_url` to /api/scene-capture as `video_url`.
 * Keeping multi-hundred-MB video off this serverless function is the whole point
 * — mirrors /api/forge-upload, but for video content types and a larger cap.
 *
 * Auth-free, matching the rest of the capture surface: rate-limited by client IP
 * and scoped to the anonymous browser handle (x-forge-client). When object
 * storage isn't configured the endpoint returns a clean 503 and the page falls
 * back to accepting a public video URL directly.
 */

import { randomUUID } from 'node:crypto';
import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { presignUpload, publicUrl } from './_lib/r2.js';
import { hashClient } from './_lib/forge-store.js';

// Accepted source-video types → file extension for the storage key.
const CONTENT_TYPE_EXT = Object.freeze({
	'video/mp4': 'mp4',
	'video/quicktime': 'mov',
	'video/webm': 'webm',
});

// A walkthrough clip is comfortably under this; anything larger is almost
// certainly the wrong input for a streaming reconstruction.
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

function storageConfigured() {
	return Boolean(
		process.env.S3_ENDPOINT &&
			process.env.S3_BUCKET &&
			process.env.S3_PUBLIC_DOMAIN &&
			process.env.S3_ACCESS_KEY_ID &&
			process.env.S3_SECRET_ACCESS_KEY,
	);
}

function clientKeyFrom(req) {
	const raw = req.headers['x-forge-client'];
	return hashClient(Array.isArray(raw) ? raw[0] : raw);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!storageConfigured()) {
		return json(res, 503, {
			error: 'unconfigured',
			message:
				'Video upload is not configured on this deployment (object storage missing). ' +
				'Pass a public https video URL to /api/scene-capture instead.',
		});
	}

	const ip = clientIp(req);
	const rl = await limits.upload(`scene:${ip}`);
	if (!rl.success) return rateLimited(res, rl, 'Upload limit reached. Try again shortly.');

	const body = await readJson(req, 2_000).catch(() => null);

	const contentType =
		typeof body?.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
	const ext = Object.hasOwn(CONTENT_TYPE_EXT, contentType) ? CONTENT_TYPE_EXT[contentType] : null;
	if (!ext) {
		return json(res, 400, {
			error: 'invalid_content_type',
			message: 'content_type must be video/mp4, video/quicktime, or video/webm.',
		});
	}

	const size = Number(body?.size_bytes);
	if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
		return json(res, 400, {
			error: 'invalid_size',
			message: `size_bytes must be between 1 and ${MAX_VIDEO_BYTES} bytes.`,
		});
	}

	const clientKey = clientKeyFrom(req);
	const key = `capture/uploads/${clientKey.slice(0, 12)}/${randomUUID()}.${ext}`;

	let uploadUrl;
	try {
		uploadUrl = await presignUpload({ key, contentType });
	} catch (err) {
		return json(res, 502, {
			error: 'presign_failed',
			message: err?.message || 'Could not create an upload URL.',
		});
	}

	return json(res, 200, {
		storage_key: key,
		upload_url: uploadUrl,
		public_url: publicUrl(key),
		method: 'PUT',
		headers: { 'content-type': contentType },
		expires_in: 300,
	});
});
