// POST /api/avatars/:id/session
// Creates an Avaturn edit session for an existing avatar the caller owns.
// Returns { session_url } — embed in the AvatarCreator modal to preload the
// existing avatar so the user can tweak it and export a new version.
//
// Avaturn API shape (verify against https://docs.avaturn.me):
//   POST {AVATURN_API_URL}/api/v1/sessions
//   Authorization: Bearer {apiKey}
//   { external_user_id, avatar_url }
//   → 200 { session_url, expires_at? }
//
// If AVATURN_API_KEY is unset → 501.
// If the avatar is not found / not owned by caller → 404 (mirrors [id].js pattern).

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { getAvatar, resolveAvatarUrl } from '../../_lib/avatars.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id;
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.upload(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests, try again later');

	// 404 (not 403) when not found or not owned — mirrors [id].js.
	const avatar = await getAvatar({ id, requesterId: auth.userId });
	if (!avatar || avatar.owner_id !== auth.userId) {
		return error(res, 404, 'not_found', 'avatar not found');
	}

	if (!env.AVATURN_API_KEY) {
		return error(res, 501, 'not_configured', 'Avaturn is not configured on this deployment. Set AVATURN_API_KEY.');
	}

	// Resolve a time-limited URL the Avaturn upstream can fetch (works for private too).
	const { url: glbUrl } = await resolveAvatarUrl(avatar, { expiresIn: 3600 });

	try {
		const result = await createAvaturnEditSession({
			apiKey: env.AVATURN_API_KEY,
			apiUrl: env.AVATURN_API_URL,
			userId: auth.userId,
			avatarUrl: glbUrl,
		});
		return json(res, 200, result);
	} catch (err) {
		const status = err?.status || 502;
		const code = err?.code || 'upstream_error';
		const message = err?.message || 'avatar provider rejected request';
		if (status >= 500) console.error('[avatars/session] upstream failure:', err);
		return error(res, status >= 500 ? 502 : status, code, message);
	}
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	if (!hasScope(bearer.scope, 'avatars:write')) return null;
	return { userId: bearer.userId };
}

/**
 * Opens an existing avatar in Avaturn for editing.
 * Passes `avatar_url` so Avaturn pre-populates the editor with the existing mesh.
 * If Avaturn's API uses a different field (e.g. `avatarUrl`, `model_url`), update
 * the payload mapping below and the AVATURN_API_URL env var accordingly.
 */
async function createAvaturnEditSession({ apiKey, apiUrl, userId, avatarUrl }) {
	const url = `${apiUrl}/api/v1/sessions`;
	const payload = {
		external_user_id: userId,
		avatar_url: avatarUrl,
	};

	const upstream = await fetch(url, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json',
			accept: 'application/json',
		},
		body: JSON.stringify(payload),
	});

	if (!upstream.ok) {
		const text = await upstream.text().catch(() => '');
		const err = new Error(`avaturn upstream ${upstream.status}: ${text.slice(0, 200)}`);
		err.status = upstream.status >= 500 ? 502 : upstream.status;
		err.code = upstream.status === 401 ? 'upstream_auth' : 'upstream_error';
		throw err;
	}

	const data = await upstream.json();
	const sessionUrl = data?.session_url || data?.url || data?.iframe_url;
	if (!sessionUrl) {
		const err = new Error('avaturn response missing session_url');
		err.status = 502;
		err.code = 'upstream_error';
		throw err;
	}
	return { session_url: sessionUrl, expires_at: data.expires_at ?? null };
}
