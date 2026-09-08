/**
 * /api/forge-upload — direct-to-storage upload for /forge reference views.
 *
 *   POST /api/forge-upload  { content_type, size_bytes, checksum_sha256? }
 *                         → 200 { storage_key, upload_url, public_url, method, headers, expires_in }
 *
 * The browser PUTs the image bytes straight to `upload_url` (a short-lived R2
 * presigned URL), then submits `public_url` to /api/forge as one of `image_urls`
 * for multi-view reconstruction. Keeping the bytes off this function avoids
 * proxying multi-MB uploads through a serverless handler.
 *
 * Auth-free, matching the rest of /forge: rate-limited by client IP and scoped
 * to the anonymous browser handle (x-forge-client) so uploads land under that
 * client's key prefix.
 *
 * Because the only thing this endpoint returns is a URL the BROWSER dereferences,
 * it verifies that storage will accept an upload rather than only that storage is
 * configured. A signed URL made from a rejected credential is indistinguishable
 * from a good one until the browser uses it, and the bucket's 403 arrives with no
 * CORS header, so the page sees a rejected fetch and no status. Both unavailable
 * cases answer 503: `unconfigured` (this deployment has no bucket, and the page
 * falls back to accepting public image URLs) and `storage_unavailable` (the
 * bucket is refusing us, and the user should come back shortly).
 */

import { randomUUID } from 'node:crypto';
import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { presignUpload, publicUrl, objectStorageUsable } from './_lib/r2.js';
import { hashClient } from './_lib/forge-store.js';

// Accepted reference-image types → file extension for the storage key.
const CONTENT_TYPE_EXT = Object.freeze({
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // matches forge-store's preview copy cap

function clientKeyFrom(req) {
	const raw = req.headers['x-forge-client'];
	return hashClient(Array.isArray(raw) ? raw[0] : raw);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	// Ask whether storage will actually ACCEPT the bytes, not merely whether it
	// is configured. This endpoint's whole output is a URL the browser uses
	// itself, so a credential that is present but rejected produces a perfectly
	// formed 200 here and a 403 SignatureDoesNotMatch there. Cross-origin, that
	// 403 arrives without a CORS header and the page cannot read its status, so
	// it surfaces as a bare "Network error during upload" with no way for the
	// user to tell a broken photo from a broken platform (live on /forge from
	// 2026-09-07). Answering honestly here is the only place that distinction
	// still exists. The check is cached in r2.js, so this costs one signed list
	// per minute, not one per upload.
	const storage = await objectStorageUsable();
	if (!storage.ok) {
		if (storage.reason === 'rejected') {
			console.error(`[forge-upload] object storage rejected our credential: ${storage.message}`);
			res.setHeader('retry-after', '60');
			return json(res, 503, {
				error: 'storage_unavailable',
				message:
					'Reference image upload is temporarily unavailable while our asset storage recovers. ' +
					'Please try again shortly.',
				retry_after: 60,
			});
		}
		return json(res, 503, {
			error: 'unconfigured',
			message:
				'Reference image upload is not configured on this deployment (object storage missing). ' +
				'Pass a public image URL to /api/forge instead.',
		});
	}

	const ip = clientIp(req);
	const rl = await limits.upload(`forge:${ip}`);
	if (!rl.success) {
		return rateLimited(res, rl, 'Upload limit reached. Try again shortly.');
	}

	const body = await readJson(req, 2_000).catch(() => null);

	const contentType =
		typeof body?.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
	// Object.hasOwn, not a bare truthy lookup: freezing the map does not detach
	// its prototype, so `content_type: "constructor"` resolved to the Object
	// function (and "__proto__" to Object.prototype), passed this check, and
	// presigned an upload whose storage key ended in the stringified builtin.
	const ext = Object.hasOwn(CONTENT_TYPE_EXT, contentType) ? CONTENT_TYPE_EXT[contentType] : null;
	if (!ext) {
		return json(res, 400, {
			error: 'invalid_content_type',
			message: 'content_type must be image/png, image/jpeg, or image/webp.',
		});
	}

	const size = Number(body?.size_bytes);
	if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
		return json(res, 400, {
			error: 'invalid_size',
			message: `size_bytes must be between 1 and ${MAX_IMAGE_BYTES} bytes.`,
		});
	}

	const checksum =
		typeof body?.checksum_sha256 === 'string' && /^[a-f0-9]{64}$/.test(body.checksum_sha256)
			? body.checksum_sha256
			: undefined;

	const clientKey = clientKeyFrom(req);
	const key = `forge/uploads/${clientKey.slice(0, 12)}/${randomUUID()}.${ext}`;

	let uploadUrl;
	try {
		uploadUrl = await presignUpload({
			key,
			contentType,
			...(checksum ? { checksumSha256: checksum } : {}),
		});
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
