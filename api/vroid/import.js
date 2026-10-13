// POST /api/vroid/import: pull one VRoid Hub character model into the
// caller's three.ws avatar library.
//
// Download flow (developer.vroid.com/en/api/load-character.html, verified
// live): POST /api/download_licenses {character_model_id} mints a
// DownloadLicense, then GET /api/download_licenses/{id}/download 302s to an
// S3 presigned URL that serves the actual VRM/GLB bytes. Both calls live in
// api/_lib/vroid/client.js.
//
// License enforcement (task 3 of 092-partners-09-vroid-hub-import.md): the
// import itself is always allowed (a creator's own download license already
// cleared that), but what three.ws lets the *imported avatar* do afterward
// (become a public agent, be exported again, be modified, be monetized) is
// gated by api/_lib/vroid/license.js and stored on the avatar so every later
// surface (agent creation, export, the garment/remesh tools, marketplace
// listing) can re-check it without another Hub round trip.

import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, error, readJson, wrap } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { vroidConfigured } from '../_lib/vroid/config.js';
import { hubGet, issueDownloadLicense, resolveDownloadUrl, CHARACTER_MODEL_PATH } from '../_lib/vroid/client.js';
import { getValidVroidToken } from '../_lib/vroid/token-store.js';
import { evaluateLicense, creditLineFor } from '../_lib/vroid/license.js';
import { createAvatar, storageKeyFor, enforceQuotas, isPlanLimitError } from '../_lib/avatars.js';
import { putObject } from '../_lib/r2.js';
import { isValidGlbHeader } from '../_lib/glb-inspect.js';
import { sha256 } from '../_lib/crypto.js';
import { slug as slugSchema } from '../_lib/validate.js';

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

function slugFor(name) {
	const base = String(name || 'vroid-avatar')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	const candidate = base || 'vroid-avatar';
	return slugSchema.safeParse(candidate).success ? candidate : 'vroid-avatar';
}

async function downloadBytes(url) {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: ac.signal });
		if (!res.ok) {
			const err = new Error(`VRoid Hub file download returned HTTP ${res.status}`);
			err.status = 502;
			throw err;
		}
		const contentLength = Number(res.headers.get('content-length'));
		if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
			const err = new Error('model exceeds the maximum importable size');
			err.status = 413;
			throw err;
		}
		const ab = await res.arrayBuffer();
		if (ab.byteLength > MAX_IMPORT_BYTES) {
			const err = new Error('model exceeds the maximum importable size');
			err.status = 413;
			throw err;
		}
		return Buffer.from(ab);
	} finally {
		clearTimeout(timer);
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	if (!vroidConfigured()) {
		return error(res, 501, 'not_configured', 'VRoid Hub is not connected on this deployment yet');
	}

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');
	if (!(await requireCsrf(req, res, session.id))) return;

	const rl = await limits.upload(session.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many imports, try again shortly');

	const body = await readJson(req).catch(() => ({}));
	const characterModelId = typeof body.character_model_id === 'string' ? body.character_model_id.trim() : '';
	if (!characterModelId) return error(res, 400, 'bad_request', 'character_model_id is required');

	const accessToken = await getValidVroidToken(session.id);
	if (!accessToken) {
		return error(res, 409, 'not_connected', 'connect your VRoid Hub account first', {
			connect_url: '/api/auth/vroid/connect',
		});
	}

	let detail;
	try {
		detail = await hubGet(CHARACTER_MODEL_PATH(characterModelId), accessToken);
	} catch (err) {
		return error(res, err.status || 502, err.code || 'upstream_error', err.message || 'could not load that model from VRoid Hub');
	}
	const model = detail?.character_model;
	if (!model) return error(res, 404, 'not_found', 'VRoid Hub has no model with that id');
	if (model.is_downloadable === false) {
		return error(res, 403, 'not_downloadable', 'the creator has not made this model downloadable');
	}

	const evaluated = evaluateLicense(model.license);
	const creatorName = model.character?.user?.name || null;
	const characterName = model.name || model.character?.name || null;

	let downloadLicense;
	try {
		downloadLicense = await issueDownloadLicense(characterModelId, accessToken);
	} catch (err) {
		return error(res, err.status || 502, err.code || 'license_failed', err.message || 'VRoid Hub refused to issue a download license for this model');
	}

	let downloadUrl;
	try {
		downloadUrl = await resolveDownloadUrl(downloadLicense.id, accessToken);
	} catch (err) {
		return error(res, err.status || 502, err.code || 'download_failed', err.message || 'VRoid Hub did not return a download link');
	}

	let buffer;
	try {
		buffer = await downloadBytes(downloadUrl);
	} catch (err) {
		return error(res, err.status || 502, err.code || 'download_failed', err.message || 'failed to download the model file');
	}

	if (!isValidGlbHeader(buffer)) {
		return error(res, 415, 'invalid_glb', 'VRoid Hub did not return a valid binary glTF (GLB) file');
	}

	// Canonicalize bone names + up-axis orientation at ingest, same as every
	// other import path (api/avatars/_actions.js handleUpload), so the stored
	// GLB shares one convention regardless of source. VRoid exports VRM, whose
	// humanoid bone map glb-canonicalize.js already recognizes.
	try {
		const { canonicalizeGLBBones } = await import('../../src/glb-canonicalize.js');
		const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		const canonical = canonicalizeGLBBones(ab);
		if (canonical.renamed > 0 || canonical.orientationCorrected) {
			buffer = Buffer.from(canonical.buffer);
		}
	} catch (err) {
		console.warn('[vroid-import] canonicalize skipped:', err?.message);
	}

	const checksum = await sha256(buffer);
	const name = characterName || 'VRoid Hub avatar';
	const slug = slugFor(name);
	const storageKey = storageKeyFor({ userId: session.id, slug });

	try {
		await enforceQuotas(session.id, buffer.length);
	} catch (err) {
		return error(res, err.status || 402, err.code || 'plan_limit', err.message);
	}

	try {
		await putObject({ key: storageKey, body: buffer, contentType: 'model/gltf-binary' });

		const avatar = await createAvatar({
			userId: session.id,
			storageKey,
			input: {
				name,
				description: creatorName ? `Imported from VRoid Hub, created by ${creatorName}.` : 'Imported from VRoid Hub.',
				visibility: 'private',
				tags: ['vroid-hub'],
				source: 'vroid_hub',
				source_meta: {
					character_model_id: characterModelId,
					creator_name: creatorName,
					character_name: characterName,
					license: evaluated.license,
					actions: evaluated.actions,
					credit_required: evaluated.creditRequired,
					credit_line: creditLineFor({ creatorName, characterName }),
					license_url: evaluated.licenseUrl,
					imported_at: new Date().toISOString(),
				},
				content_type: 'model/gltf-binary',
				size_bytes: buffer.length,
				checksum_sha256: checksum,
			},
		});

		return json(res, 200, { avatar, edit_url: `/avatars/${avatar.id}/edit` });
	} catch (err) {
		if (isPlanLimitError(err)) {
			return error(res, 402, err.code || 'plan_limit', err.message);
		}
		console.error('[vroid-import] failed', err?.message || err);
		return error(res, err.status || 500, err.code || 'import_failed', err.message || 'import failed');
	}
});
