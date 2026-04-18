// Returns a short-lived R2 presigned PUT URL for direct browser upload.
// After uploading, the client calls POST /api/avatars with the returned storage_key.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { presignUpload } from '../_lib/r2.js';
import { storageKeyFor, enforceQuotas } from '../_lib/avatars.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { parse, presignUploadBody, slug as slugSchema } from '../_lib/validate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const userId = await resolveUser(req, 'avatars:write');
	if (!userId) return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');

	const rl = await limits.upload(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'upload rate exceeded');

	const body = parse(presignUploadBody, await readJson(req));

	try {
		await enforceQuotas(userId, body.size_bytes);
	} catch (err) {
		return error(res, err.status || 402, err.code || 'plan_limit', err.message);
	}

	const bodyAny = body;
	const slug = bodyAny.slug
		? slugSchema.parse(bodyAny.slug)
		: `draft-${Math.random().toString(36).slice(2, 8)}`;

	const key = storageKeyFor({ userId, slug });
	const url = await presignUpload({
		key,
		contentType: body.content_type,
		contentLength: body.size_bytes,
	});

	return json(res, 200, {
		storage_key: key,
		upload_url: url,
		method: 'PUT',
		headers: { 'content-type': body.content_type },
		expires_in: 300,
	});
});

async function resolveUser(req, requiredScope) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req), { audience: undefined });
	if (!bearer) return null;
	if (!hasScope(bearer.scope, requiredScope)) return null;
	return bearer.userId;
}
