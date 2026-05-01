// GET /api/agent-3d/versions — serves dist/agent-3d/versions.json with CORS + cache headers

import { readFileSync } from 'node:fs';
import { cors, json, error, method, wrap } from '../_lib/http.js';

const VERSIONS_PATH = new URL('../../dist/agent-3d/versions.json', import.meta.url);

const CACHE_HEADERS = {
	'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,HEAD,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'HEAD'])) return;

	let data;
	try {
		data = JSON.parse(readFileSync(VERSIONS_PATH, 'utf8'));
	} catch {
		return error(
			res,
			503,
			'not_found',
			'versions.json not found — run npm run publish:lib',
		);
	}

	return json(res, 200, data, CACHE_HEADERS);
});
