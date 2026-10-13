import { readFileSync } from 'fs';
import { cors, json, method, wrap } from './_lib/http.js';

const _credits = JSON.parse(
	readFileSync(new URL('../data/open-source-credits.json', import.meta.url), 'utf8'),
);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	return json(res, 200, _credits, { 'cache-control': 'public, max-age=3600' });
});
