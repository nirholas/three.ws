// GET /api/v1/hood-portfolios/health: is the chain answering, and how fresh is the universe.
//
// Free and keyless. Used by the /markets/robinhood/portfolios surfaces to decide whether to show a
// live board or an honest degraded state, so it must answer even when the chain
// does not.

import { defineEndpoint } from '../../_lib/gateway.js';
import { portfoliosHealth } from '../../_lib/hood-portfolios.js';

export default defineEndpoint({
	name: 'v1.hood-portfolios.health',
	method: 'GET',
	auth: 'public',
	handler: async ({ res }) => {
		res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15');
		return portfoliosHealth();
	},
});
