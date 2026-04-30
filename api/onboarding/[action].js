// Consolidated onboarding endpoints (avaturn-session + link-avatar).

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { env } from '../_lib/env.js';

// ── avaturn-session ───────────────────────────────────────────────────────────

const dataUrl = z.string().max(2_500_000).regex(/^data:image\/(jpeg|png);base64,/i, 'must be a data:image/(jpeg|png);base64 url');
const avaturnSchema = z.object({
	photos: z.object({ frontal: dataUrl, left: dataUrl, right: dataUrl }),
	body_type: z.enum(['male', 'female']).default('male'),
	avatar_type: z.enum(['v1', 'v2']).default('v1'),
});

async function resolveAvaturnUser(req) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req), { audience: undefined });
	if (!bearer || !hasScope(bearer.scope, 'avatars:write')) return null;
	return bearer.userId;
}

async function handleAvaturnSession(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const userId = await resolveAvaturnUser(req);
	if (!userId) return error(res, 401, 'unauthorized', 'sign in to create an avatar');
	const rlUser = await limits.upload(userId);
	if (!rlUser.success) return error(res, 429, 'rate_limited', 'too many avatar attempts, try again later');
	const rlIp = await limits.authIp(clientIp(req));
	if (!rlIp.success) return error(res, 429, 'rate_limited', 'too many requests from this network');
	if (!env.AVATURN_API_KEY) return error(res, 501, 'not_configured', 'Avaturn is not configured on this deployment. Set AVATURN_API_KEY.');
	const body = parse(avaturnSchema, await readJson(req, 8_000_000));
	try {
		const url = `${env.AVATURN_API_URL}/api/v1/sessions`;
		const upstream = await fetch(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${env.AVATURN_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ external_user_id: userId, photos: body.photos, body_type: body.body_type, version: body.avatar_type }),
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
		if (!sessionUrl) { const e = new Error('avaturn response missing session_url'); e.status = 502; e.code = 'upstream_error'; throw e; }
		return json(res, 200, { session_url: sessionUrl, expires_at: data.expires_at ?? null });
	} catch (err) {
		if (err.status >= 500) console.error('[avaturn-session] upstream failure:', err);
		return error(res, err.status || 502, err.code || 'upstream_error', err.message || 'avatar provider rejected request');
	}
}

// ── link-avatar ───────────────────────────────────────────────────────────────

const linkAvatarSchema = z.object({ avatarId: z.string().uuid(), force: z.boolean().default(false) });

async function handleLinkAvatar(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;
	const body = parse(linkAvatarSchema, await readJson(req));
	const [avatar] = await sql`select id from avatars where id = ${body.avatarId} and owner_id = ${userId} and deleted_at is null limit 1`;
	if (!avatar) return error(res, 404, 'not_found', 'avatar not found or not owned by you');
	const [agent] = await sql`select id, avatar_id from agent_identities where user_id = ${userId} and deleted_at is null order by created_at asc limit 1`;
	if (!agent) return error(res, 404, 'not_found', 'no agent identity found for user');
	if (agent.avatar_id && agent.avatar_id !== body.avatarId && !body.force) return error(res, 409, 'already_linked', 'agent already has an avatar; pass force: true to override', { current_avatar_id: agent.avatar_id });
	const [updated] = await sql`update agent_identities set avatar_id = ${body.avatarId}, updated_at = now() where id = ${agent.id} returning id, avatar_id, updated_at`;
	return json(res, 200, { agent: updated });
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = { 'avaturn-session': handleAvaturnSession, 'link-avatar': handleLinkAvatar };

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown onboarding action: ${action}`);
	return fn(req, res);
});
