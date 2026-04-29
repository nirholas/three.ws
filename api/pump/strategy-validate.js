// POST /api/pump/strategy-validate
// Body: { strategy: <spec> }
// Returns: { data: { filterCount, exitCount, filters[], exits[] } } or 400 with parse error.

import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { makeRuntime } from '../_lib/skill-runtime.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body?.strategy || typeof body.strategy !== 'object') {
		return error(res, 400, 'validation_error', 'strategy required');
	}

	const rt = makeRuntime();
	const r = await rt.invoke('pump-fun-strategy.validateStrategy', { strategy: body.strategy });
	if (!r.ok) return error(res, 400, 'validation_error', r.error);
	return json(res, 200, { data: r.data });
});
