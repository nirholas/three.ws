// POST /api/wallet/balances
// body: { chain: 'solana'|'evm', address: string }
// → { chain, address, native: {symbol, amount, usd}, tokens: [{symbol, amount, usd, logo}] }

import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getBalances } from '../_lib/balances.js';
import { z } from 'zod';

const bodySchema = z.object({
	chain: z.enum(['solana', 'evm']),
	address: z.string().trim().min(1),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		const raw = await readJson(req);
		body = bodySchema.parse(raw);
	} catch (e) {
		return error(res, 400, 'validation_error', e.message);
	}

	try {
		const result = await getBalances({ chain: body.chain, address: body.address });
		return json(res, 200, result);
	} catch (e) {
		if (e.code === 'not_configured') {
			return error(res, 503, 'not_configured', `missing env var: ${e.missing}`, {
				missing_key: e.missing,
			});
		}
		if (e.status === 502) {
			return error(res, 502, 'upstream_error', e.message);
		}
		throw e;
	}
});
