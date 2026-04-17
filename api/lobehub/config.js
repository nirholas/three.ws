import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { json, error, method, wrap } from '../_lib/http.js';

let manifest;
try {
	manifest = JSON.parse(
		readFileSync(join(process.cwd(), 'public/.well-known/lobehub-plugin.json'), 'utf8'),
	);
} catch (err) {
	console.error('[lobehub/config] failed to load lobehub-plugin.json', err);
}

export default wrap(async (req, res) => {
	// CORS open so LobeHub marketplace fetcher can read this without credentials.
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
	if (req.method === 'OPTIONS') {
		res.statusCode = 204;
		res.end();
		return;
	}
	if (!method(req, res, ['GET'])) return;
	if (!manifest) return error(res, 500, 'internal_error', 'manifest unavailable');
	return json(res, 200, manifest, { 'cache-control': 'public, max-age=300' });
});
