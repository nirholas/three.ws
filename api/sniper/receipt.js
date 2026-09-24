/**
 * Trade receipt: why an agent took one trade, with the evidence it had.
 *
 *   GET /api/sniper/receipt?id=<position uuid>
 *
 * Joins one agent_sniper_positions row to every gate that recorded a decision
 * about it (Oracle score and base-rate reasons, the trade firewall's round-trip
 * simulation, the LLM judge, the Risk Officer, paid x402 sentiment and rug-pull
 * reads with their payment tx, launch intel) plus each journal leg and its
 * on-chain signature. Evidence recorded after the exit is dropped. Shape and
 * honesty rules live in api/_lib/trade-receipt.js.
 *
 * Powers the "Why" drawer on /trader/:id and the "Why it traded" section of the
 * /trade/:id share page. Public and IP rate-limited, with the same visibility
 * gate as /api/sniper/trader: a private or deleted agent's receipts are 404.
 */

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { loadTradeReceipt } from '../_lib/trade-receipt.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, `http://${req.headers.host || 'x'}`).searchParams;
	const id = (params.get('id') || params.get('position_id') || '').trim();
	if (!isUuid(id)) return error(res, 400, 'invalid_id', 'id must be a trade (position) UUID');

	const receipt = await loadTradeReceipt(id);
	if (!receipt) return error(res, 404, 'not_found', 'No such trade, or its agent is not public.');

	// A closed trade's evidence is final; an open one still gains exit legs.
	const cache = receipt.position.status === 'closed'
		? 'public, max-age=300, s-maxage=3600'
		: 'public, max-age=15, s-maxage=30';
	return json(res, 200, receipt, { 'cache-control': cache });
});
