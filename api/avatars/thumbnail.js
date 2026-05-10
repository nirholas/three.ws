// POST /api/avatars/thumbnail — upload a PNG poster for an existing avatar.
// Body: { avatar_id: uuid, png_base64: "data:image/png;base64,..." | "<raw base64>" }
// The caller must own the avatar OR be an admin (for the backfill script).
//
// PNGs are stored under thumb/<avatarId>.png in R2 and the avatars row's
// thumbnail_key is updated. The frontend then fetches via publicUrl() so the
// browser sees a 50KB PNG instead of a 5MB GLB.

import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { putObject, deleteObject, publicUrl } from '../_lib/r2.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const MAX_PNG_BYTES = 1_500_000; // 1.5 MB max — generous for 1024² posters.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');

	const rl = await limits.upload(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'thumbnail upload rate exceeded');

	const body = await readJson(req).catch(() => null);
	const avatarId = body?.avatar_id;
	const pngB64 = body?.png_base64;

	if (!avatarId || typeof avatarId !== 'string' || avatarId.length > 100) {
		return error(res, 400, 'invalid_request', 'avatar_id required');
	}
	if (!pngB64 || typeof pngB64 !== 'string') {
		return error(res, 400, 'invalid_request', 'png_base64 required');
	}

	// Strip an optional "data:image/png;base64," prefix.
	const raw = pngB64.replace(/^data:image\/png;base64,/, '');
	let buf;
	try {
		buf = Buffer.from(raw, 'base64');
	} catch {
		return error(res, 400, 'invalid_request', 'png_base64 not valid base64');
	}
	if (buf.length === 0 || buf.length > MAX_PNG_BYTES) {
		return error(res, 413, 'too_large', `png must be 1..${MAX_PNG_BYTES} bytes`);
	}
	if (!buf.subarray(0, 8).equals(PNG_HEADER)) {
		return error(res, 400, 'invalid_request', 'body is not a PNG');
	}

	// Look up the avatar; permit owner OR admin (admins are needed to backfill
	// thumbnails for legacy avatars whose owners may be inactive).
	const [row] = await sql`
		SELECT a.id, a.owner_id, a.thumbnail_key, u.is_admin
		FROM avatars a
		LEFT JOIN users u ON u.id = ${auth.userId}
		WHERE a.id = ${avatarId} AND a.deleted_at IS NULL
		LIMIT 1
	`;
	if (!row) return error(res, 404, 'not_found', 'avatar not found');
	const isOwner = row.owner_id === auth.userId;
	const isAdmin = row.is_admin === true;
	if (!isOwner && !isAdmin) return error(res, 403, 'forbidden', 'not your avatar');

	const key = `thumb/${avatarId}.png`;
	await putObject({
		key,
		body: buf,
		contentType: 'image/png',
		metadata: { 'avatar-id': avatarId, 'uploaded-by': auth.userId },
	});

	// If the avatar previously had a different thumbnail key, drop the old one.
	if (row.thumbnail_key && row.thumbnail_key !== key) {
		queueMicrotask(() => deleteObject(row.thumbnail_key).catch(() => {}));
	}

	await sql`
		UPDATE avatars
		SET thumbnail_key = ${key}, updated_at = now()
		WHERE id = ${avatarId}
	`;

	return json(res, 200, {
		data: {
			avatar_id: avatarId,
			thumbnail_key: key,
			thumbnail_url: publicUrl(key),
			bytes: buf.length,
		},
	});
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	if (!hasScope(bearer.scope, 'avatars:write')) return null;
	return { userId: bearer.userId };
}
