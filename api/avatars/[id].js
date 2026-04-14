// GET    /api/avatars/:id  — fetch one (public if visibility allows, else requires auth)
// PATCH  /api/avatars/:id  — update metadata (owner only)
// DELETE /api/avatars/:id  — soft-delete (owner only)

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { getAvatar, updateAvatar, deleteAvatar, resolveAvatarUrl } from '../_lib/avatars.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { recordEvent } from '../_lib/usage.js';
import { z } from 'zod';
import { avatarVisibility, parse } from '../_lib/validate.js';

const patchSchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	description: z.string().trim().max(2000).optional(),
	visibility: avatarVisibility.optional(),
	tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PATCH', 'DELETE'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').pop();
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const auth = await resolveAuth(req);

	if (req.method === 'GET') {
		const avatar = await getAvatar({ id, requesterId: auth?.userId });
		if (!avatar) return error(res, 404, 'not_found', 'avatar not found');
		const urlInfo = await resolveAvatarUrl(avatar);
		recordEvent({ userId: auth?.userId, clientId: auth?.clientId, apiKeyId: auth?.apiKeyId, avatarId: id, kind: 'avatar_fetch' });
		return json(res, 200, { avatar: { ...avatar, ...urlInfo } });
	}

	if (!auth?.userId) return error(res, 401, 'unauthorized', 'authentication required');

	if (req.method === 'PATCH') {
		if (auth.source === 'oauth' || auth.source === 'apikey') {
			if (!hasScope(auth.scope, 'avatars:write')) return error(res, 403, 'insufficient_scope', 'avatars:write required');
		}
		const patch = parse(patchSchema, await readJson(req));
		const avatar = await updateAvatar({ id, userId: auth.userId, patch });
		if (!avatar) return error(res, 404, 'not_found', 'avatar not found or not yours');
		return json(res, 200, { avatar });
	}

	// DELETE
	if (auth.source === 'oauth' || auth.source === 'apikey') {
		if (!hasScope(auth.scope, 'avatars:delete')) return error(res, 403, 'insufficient_scope', 'avatars:delete required');
	}
	const ok = await deleteAvatar({ id, userId: auth.userId });
	if (!ok) return error(res, 404, 'not_found', 'avatar not found or not yours');
	return json(res, 200, { ok: true });
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session', scope: 'avatars:read avatars:write avatars:delete' };
	const bearer = await authenticateBearer(extractBearer(req));
	return bearer;
}
