// GET /api/forge/mine?limit=&before=
//
// The signed-in user's own finished Forge models, newest first, every
// visibility included. This is the list the PowerPoint add-in
// (integrations/microsoft/office-addin) shows after sign-in: it authenticates
// with a three.ws OAuth access token carrying `avatars:read`, or with the
// site session cookie. Each model says whether /api/forge/export-pptx can put
// it on a slide (public and unlisted can; private cannot until the owner
// changes its visibility on the model page).
//
// Paging: pass the previous page's `nextBefore` as `before`. The response is
// per user, so it is never cached anywhere.

import { getRequestUser, requestUserHasScope } from '../_lib/auth.js';
import { cors, error, json, method, wrap } from '../_lib/http.js';
import { listOwnCreations } from '../_lib/forge-store.js';
import { selfOrigin } from '../_lib/self-origin.js';
import { slideTitle } from './export-pptx.js';

export const SCOPE = 'avatars:read';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

/** One stored row as the add-in reads it. */
export function toMineModel(row, origin) {
	const visibility = row.visibility === 'unlisted' || row.visibility === 'private' ? row.visibility : 'public';
	return {
		id: row.id,
		title: slideTitle(row.prompt),
		prompt: row.prompt || '',
		previewImageUrl: row.preview_image_url || null,
		visibility,
		exportable: visibility !== 'private',
		modelUrl: `${origin}/m/${row.id}`,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
	};
}

function readPage(req) {
	const url = new URL(req.url, 'http://localhost');
	const rawLimit = Number(url.searchParams.get('limit'));
	const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
	const rawBefore = url.searchParams.get('before');
	if (!rawBefore) return { limit, before: null };
	const parsed = new Date(rawBefore);
	if (!/^\d{4}-\d{2}-\d{2}T/.test(rawBefore) || Number.isNaN(parsed.getTime())) return { limit, invalid: true };
	return { limit, before: parsed.toISOString() };
}

export function createForgeMineHandler({ authenticate = getRequestUser, listOwn = listOwnCreations } = {}) {
	return wrap(async (req, res) => {
		if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS', payments: false })) return;
		if (!method(req, res, ['GET'])) return;

		const user = await authenticate(req, res);
		if (!user) return error(res, 401, 'unauthorized', 'Sign in to three.ws to see your models.');
		if (!requestUserHasScope(user, SCOPE))
			return error(res, 403, 'insufficient_scope', `This token needs the ${SCOPE} scope. Sign in again to grant it.`);

		const page = readPage(req);
		if (page.invalid) return error(res, 400, 'validation_error', 'before must be an ISO timestamp from nextBefore.');

		const rows = await listOwn({ userId: user.id, limit: page.limit, before: page.before });
		const origin = selfOrigin(req);
		const models = rows.map((row) => toMineModel(row, origin));
		const nextBefore = rows.length === page.limit ? models[models.length - 1].createdAt : null;
		return json(res, 200, { models, nextBefore }, { 'cache-control': 'private, no-store' });
	});
}

export default createForgeMineHandler();
