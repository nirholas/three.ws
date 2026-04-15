/**
 * POST /api/widgets/:id/duplicate
 * -------------------------------
 * Owner-only. Clones a widget (config, type, avatar_id, is_public) under a new
 * id with name "<original> (copy)". Returns the new widget so the dashboard
 * can prepend it to the grid without re-fetching.
 */

import crypto from 'node:crypto';

import { sql }                            from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits }                         from '../../_lib/rate-limit.js';
import { decorate }                       from '../index.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = idFromReq(req);
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const auth = await resolveAuth(req);
	if (!auth?.userId) return error(res, 401, 'unauthorized', 'authentication required');
	if (auth.source === 'oauth' || auth.source === 'apikey') {
		if (!hasScope(auth.scope, 'avatars:write')) return error(res, 403, 'insufficient_scope', 'avatars:write required');
	}

	const rl = await limits.widgetWrite(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [src] = await sql`
		select id, type, name, config, avatar_id, is_public
		from widgets
		where id = ${id} and user_id = ${auth.userId} and deleted_at is null
		limit 1
	`;
	if (!src) return error(res, 404, 'not_found', 'widget not found or not yours');

	const newId   = 'wdgt_' + crypto.randomBytes(9).toString('base64url');
	const newName = trim(`${src.name} (copy)`, 120);

	const [row] = await sql`
		insert into widgets (id, user_id, avatar_id, type, name, config, is_public)
		values (${newId}, ${auth.userId}, ${src.avatar_id}, ${src.type}, ${newName},
		        ${JSON.stringify(src.config || {})}::jsonb, ${src.is_public})
		returning id, user_id, avatar_id, type, name, config, is_public, view_count, created_at, updated_at
	`;

	return json(res, 201, { widget: decorate(row) });
});

function trim(s, max) {
	return s.length <= max ? s : s.slice(0, max);
}

function idFromReq(req) {
	const fromQuery = req.query?.id;
	if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
	const path = new URL(req.url, 'http://x').pathname;
	const m = path.match(/\/api\/widgets\/([^/]+)\/duplicate/);
	return m ? decodeURIComponent(m[1]) : null;
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session', scope: 'avatars:read avatars:write' };
	return await authenticateBearer(extractBearer(req));
}
