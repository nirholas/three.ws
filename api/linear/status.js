// GET /api/linear/status: public. Whether Add to Linear works right now, so the
// /integrations/linear page never offers a button that dead-ends.

import { json, method, wrap, cors } from '../_lib/http.js';
import { linearConfigured } from '../_lib/linear-installs.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET'])) return;
	const available = linearConfigured();
	return json(res, 200, { available, install_url: available ? '/api/linear/install' : null }, { 'cache-control': 'public, max-age=60' });
});
