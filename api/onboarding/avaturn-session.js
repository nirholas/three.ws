// Exchanges 3 selfies (frontal/left/right) for an Avaturn session URL that the
// client hands to `@avaturn/sdk`'s iframe. Photos arrive as JSON base64 data
// URLs — small enough after client-side downscaling to skip multipart parsing.
//
// Contract with client:
//   POST /api/onboarding/avaturn-session
//   body: { photos: { frontal, left, right } (data URLs), body_type, avatar_type }
//   200:  { session_url: string, expires_at?: string }
//   501:  { error: 'not_configured' } when AVATURN_API_KEY is unset

import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { env } from '../_lib/env.js';

const dataUrl = z
	.string()
	.max(2_500_000) // ~1.8MB binary per photo after base64 expansion; generous ceiling
	.regex(/^data:image\/(jpeg|png);base64,/i, 'must be a data:image/(jpeg|png);base64 url');

const bodySchema = z.object({
	photos: z.object({
		frontal: dataUrl,
		left: dataUrl,
		right: dataUrl,
	}),
	body_type: z.enum(['male', 'female']).default('male'),
	avatar_type: z.enum(['v1', 'v2']).default('v1'),
});

// Client payloads can be up to ~7.5MB (3 × 2.5MB). Set explicit ceiling on readJson.
const BODY_LIMIT = 8_000_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Auth (session cookie OR bearer with avatars:write).
	const userId = await resolveUser(req);
	if (!userId) return error(res, 401, 'unauthorized', 'sign in to create an avatar');

	// Rate-limit on the same bucket as other uploads — 60/hour/user is plenty
	// for onboarding and bounds abuse cost on the Avaturn API.
	const rlUser = await limits.upload(userId);
	if (!rlUser.success) return error(res, 429, 'rate_limited', 'too many avatar attempts, try again later');
	const rlIp = await limits.authIp(clientIp(req));
	if (!rlIp.success) return error(res, 429, 'rate_limited', 'too many requests from this network');

	if (!env.AVATURN_API_KEY) {
		return error(
			res,
			501,
			'not_configured',
			'Avaturn is not configured on this deployment. Set AVATURN_API_KEY.'
		);
	}

	const body = parse(bodySchema, await readJson(req, BODY_LIMIT));

	// Forward to Avaturn. The exact request shape should be verified against
	// the current Avaturn REST API docs before production traffic — fields
	// labelled below reflect v1 of their hosted pipeline and may move.
	// See https://docs.avaturn.me for the authoritative spec.
	try {
		const result = await createAvaturnSession({
			apiKey: env.AVATURN_API_KEY,
			apiUrl: env.AVATURN_API_URL,
			userId,
			photos: body.photos,
			bodyType: body.body_type,
			avatarType: body.avatar_type,
		});
		return json(res, 200, result);
	} catch (err) {
		const status = err?.status || 502;
		const code = err?.code || 'upstream_error';
		const message = err?.message || 'avatar provider rejected request';
		if (status >= 500) console.error('[avaturn-session] upstream failure:', err);
		return error(res, status === 502 ? 502 : status, code, message);
	}
});

async function resolveUser(req) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req), { audience: undefined });
	if (!bearer) return null;
	if (!hasScope(bearer.scope, 'avatars:write')) return null;
	return bearer.userId;
}

/**
 * Calls Avaturn's session-creation API. Kept in its own function so the exact
 * request/response mapping is easy to audit and swap when Avaturn revs.
 *
 * Expected behaviour (to verify against live docs):
 *   POST {AVATURN_API_URL}/api/v1/sessions
 *   Authorization: Bearer {apiKey}
 *   Content-Type: application/json
 *   body: { photos: { frontal, left, right }, body_type, version }
 *   → 200 { session_url, expires_at? }
 */
async function createAvaturnSession({ apiKey, apiUrl, userId, photos, bodyType, avatarType }) {
	const url = `${apiUrl}/api/v1/sessions`;
	const payload = {
		external_user_id: userId,
		photos: {
			frontal: photos.frontal,
			left: photos.left,
			right: photos.right,
		},
		body_type: bodyType,
		version: avatarType, // 'v1' | 'v2'
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
