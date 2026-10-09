// GET /api/v1/robinhood/paired-coins: every paired coin, newest first.
//
// Free, keyless. Read from the paired launchpad itself (tokenCount/tokenAt),
// so the list is exactly the coins the chain has, whoever launched them. Each
// coin carries its pools (quote asset, weight, price, raise, % sold) priced in
// dollars, its descriptor when it hashes to the on-chain commitment, and the
// three.ws agent that launched it when there is one. `?agent=<uuid>` narrows
// to one agent's coins.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { asOf } from '../../_lib/robinhood.js';
import { pairedCoinList } from '../../_lib/paired-directory.js';

const CACHE_CONTROL = 'public, max-age=15, s-maxage=15, stale-while-revalidate=30';

export default defineEndpoint({
	name: 'v1.robinhood.paired-coins',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, query, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const agentId = query.agent ? String(query.agent) : null;
		if (agentId && !isUuid(agentId)) fail(400, 'validation_error', 'agent must be an agent id');
		const list = await pairedCoinList({
			limit: Math.min(48, Math.max(1, Number(query.limit) || 24)),
			offset: Math.max(0, Number(query.offset) || 0),
			agentId,
		});

		res.setHeader('cache-control', CACHE_CONTROL);
		return { ...list, asOf: asOf() };
	},
});
