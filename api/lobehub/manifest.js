import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { json, error, method, wrap, cors } from '../_lib/http.js';

let manifest;
try {
	manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/lobehub/plugin.json'), 'utf8'));
} catch (err) {
	console.error('[lobehub/manifest] failed to load plugin.json', err);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	if (!manifest) return error(res, 500, 'internal_error', 'manifest unavailable');
	return json(res, 200, manifest, { 'cache-control': 'public, max-age=300' });
});
