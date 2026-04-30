// GET /api/billing/fee-info — public endpoint returning the current platform fee rate.
// Used by pricing UIs so agent owners see how much the platform takes.

import { cors, json, method, wrap } from '../_lib/http.js';
import { getFeeBps } from '../_lib/fee.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const fee_bps = getFeeBps();
	return json(res, 200, {
		fee_bps,
		fee_percent: (fee_bps / 100).toFixed(1),
	});
});
