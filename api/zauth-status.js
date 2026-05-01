import { cors, json, method, wrap } from './_lib/http.js';
import { status } from './_lib/zauth.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	return json(res, 200, { data: status() });
});
