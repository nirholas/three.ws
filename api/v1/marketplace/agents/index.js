// GET /api/v1/marketplace/agents: browse agents listed for sale.
//
// Query: q (name, description or skill), sort (ending | newest | price_asc |
// price_desc | most_bids), limit (1-48), cursor (from next_cursor). Public; a
// signed-in viewer additionally sees which listings are their own. Every other
// marketplace route lives in [...route].js beside this file.

import { defineEndpoint } from '../../../_lib/gateway.js';
import { browseListings } from '../../../_lib/agent-market/service.js';

export default defineEndpoint({
	name: 'v1.marketplace.agents.browse',
	method: 'GET',
	auth: 'optional',
	scope: 'agents:read',
	handler: ({ query, principal }) =>
		browseListings({
			q: query.q || '',
			sort: query.sort || 'ending',
			limit: query.limit,
			cursor: query.cursor,
			viewerId: principal?.userId || null,
		}),
});
