/**
 * /api/scene-glb-upload — direct-to-storage upload for Scene Studio's
 * "Share / Embed" action.
 *
 *   POST /api/scene-glb-upload  { content_type, size_bytes }
 *                             → 200 { storage_key, upload_url, public_url, method, headers, expires_in }
 *
 * Scene Studio (/scene) composes a scene from any number of imported models,
 * so the exported GLB can run much larger than a single Forge reference
 * image — hence its own upload route (and its own, larger size cap) rather
 * than reusing /api/forge-upload's image-only allowlist. The browser PUTs the
 * exported GLB bytes straight to `upload_url` (a short-lived R2 presigned
 * URL), then feeds `public_url` into the existing "Embed this model" panel
 * (src/forge-embed-panel.js) to produce an iframe / web-component / <agent-3d>
 * snippet — the same flow Forge results already use. Keeping the bytes off
 * this function avoids proxying a multi-MB scene export through a serverless
 * handler.
 *
 * Auth-free, matching the rest of the anonymous creation surface: rate-limited
 * by client IP. When object storage isn't configured the endpoint returns a
 * clean 503 and the Share panel explains the deployment can't host the export
 * (the user can still use File ▸ Export in the editor to save locally).
 */

import { randomUUID } from 'node:crypto';
import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { presignUpload, publicUrl } from './_lib/r2.js';

// Accepted export types → file extension for the storage key. Binary glTF is
// the only format Scene Studio's Share action produces; the vendored editor's
// File ▸ Export submenu still covers OBJ/PLY/STL/DRC for local-only exports.
const CONTENT_TYPE_EXT = Object.freeze({
	'model/gltf-binary': 'glb',
});

// A composed scene (multiple imported avatars/props + baked textures) can run
// well past a single reference image — cap comfortably above what the editor
// can hold in memory client-side without choking a low-end device first.
const MAX_GLB_BYTES = 200 * 1024 * 1024;

function storageConfigured() {
	return Boolean(
		process.env.S3_ENDPOINT &&
			process.env.S3_BUCKET &&
			process.env.S3_PUBLIC_DOMAIN &&
			process.env.S3_ACCESS_KEY_ID &&
			process.env.S3_SECRET_ACCESS_KEY,
	);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!storageConfigured()) {
		return json(res, 503, {
			error: 'unconfigured',
			message:
				'Scene sharing is not configured on this deployment (object storage missing). ' +
				'Use File ▸ Export in the editor to save the GLB locally instead.',
		});
	}

	const ip = clientIp(req);
	const rl = await limits.upload(`scene-share:${ip}`);
	if (!rl.success) return rateLimited(res, rl, 'Upload limit reached. Try again shortly.');

	const body = await readJson(req, 2_000).catch(() => null);

	const contentType =
		typeof body?.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
	const ext = Object.hasOwn(CONTENT_TYPE_EXT, contentType) ? CONTENT_TYPE_EXT[contentType] : null;
	if (!ext) {
		return json(res, 400, {
			error: 'invalid_content_type',
			message: 'content_type must be model/gltf-binary.',
		});
	}

	const size = Number(body?.size_bytes);
	if (!Number.isFinite(size) || size <= 0 || size > MAX_GLB_BYTES) {
		return json(res, 400, {
			error: 'invalid_size',
			message: `size_bytes must be between 1 and ${MAX_GLB_BYTES} bytes.`,
		});
	}

	const key = `scene/shares/${randomUUID()}.${ext}`;

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
