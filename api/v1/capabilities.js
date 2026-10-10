// GET /api/v1/capabilities: what an agent can do on three.ws, by tool group,
// with per-call prices, plan limits and approval rules. Generated from the
// policy registry at request time (api/_lib/platform-capabilities.js).
//
// Not to be confused with /api/agents/capabilities, which manages scoped
// session keys for one agent's wallet.

import { defineEndpoint } from '../_lib/gateway.js';
import { buildCapabilities } from '../_lib/platform-capabilities.js';

let cached = null;

export default defineEndpoint({
	name: 'v1.capabilities',
	method: 'GET',
	auth: 'public',
	handler: ({ res }) => {
		cached ||= buildCapabilities();
		res.setHeader('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=600');
		return { ...cached, generated_at: new Date().toISOString() };
	},
});
