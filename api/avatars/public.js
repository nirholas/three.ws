// GET /api/avatars/public — browse public avatar gallery (no auth)

import { searchPublicAvatars, stripOwnerFor } from '../_lib/avatars.js';
import { cors, json, method, wrap } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const result = await searchPublicAvatars({
		q: url.searchParams.get('q') || undefined,
		tag: url.searchParams.get('tag') || undefined,
		limit: Number(url.searchParams.get('limit')) || 24,
		cursor: url.searchParams.get('cursor') || undefined,
	});
	// Unauthenticated endpoint — never leak raw owner UUIDs (used as R2 path prefix).
	result.avatars = result.avatars.map((a) => stripOwnerFor(a, null));
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=60');
	return json(res, 200, result);
});
