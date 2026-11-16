// GET /api/microsoft-teams/job?id=<id>: what the Teams tab shows when a
// notification deep link opens it on one 3D job (subEntityId `job:<id>`).
//
// The id is either a Teams-started job key (an unguessable key minted from the
// conversation, read from the job record the card already keeps) or a forge
// creation id (public and unlisted creations only, the same visibility rule as
// the share page). Public data only: the tab runs in an iframe with no session.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { normalizeStoredUrl } from '../_lib/r2.js';
import { env } from '../_lib/env.js';
import { isForgeKey, loadJob } from '../_lib/teams-forge.js';

export async function jobView(id, origin = env.APP_ORIGIN || 'https://three.ws') {
	if (isForgeKey(id)) {
		const record = await loadJob(id);
		if (!record) return null;
		return {
			state: record.state === 'done' ? 'done' : record.state === 'failed' ? 'failed' : 'running',
			prompt: record.prompt,
			glbUrl: record.result?.glbUrl || null,
			viewerUrl: record.result?.viewerUrl || null,
			posterUrl: record.result?.posterUrl || null,
			error: record.state === 'failed' ? record.error : null,
		};
	}
	if (!isUuid(id)) return null;
	const [row] = await sql`
		select id, prompt, status, glb_url, web_glb_url, preview_image_url
		from forge_creations
		where id = ${id} and (visibility is null or visibility in ('public', 'unlisted'))
		limit 1
	`;
	if (!row) return null;
	const glb = row.web_glb_url || row.glb_url;
	const done = row.status === 'done' && Boolean(glb);
	return {
		state: done ? 'done' : row.status === 'failed' ? 'failed' : 'running',
		prompt: row.prompt,
		glbUrl: done ? normalizeStoredUrl(glb) : null,
		viewerUrl: `${origin}/forge?share=${row.id}`,
		posterUrl: row.preview_image_url ? normalizeStoredUrl(row.preview_image_url) : null,
		error: null,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
	const view = await jobView(id);
	if (!view) return error(res, 404, 'not_found', 'This 3D job is not available.');
	return json(res, 200, view, { 'cache-control': 'no-store' });
});
