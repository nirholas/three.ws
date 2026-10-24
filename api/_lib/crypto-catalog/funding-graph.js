// Catalog entry for GET /api/crypto/funding-graph: two-hop funding trace for a
// Solana wallet. Plain, serializable, no imports, no side effects.

export default {
	slug: 'funding-graph',
	method: 'GET',
	path: '/api/crypto/funding-graph',
	title: 'Wallet Funding Graph',
	summary:
		'Two-hop funding trace for a Solana wallet: who paid it into existence and who funded that account, as nodes and edges ready to render. A funder with history too long to reach (an exchange, a router) is flagged as a service and the trace stops there.',
	inputSchema: {
		type: 'object',
		required: ['wallet'],
		properties: {
			wallet: { type: 'string', description: 'Solana wallet address to trace (base58).' },
		},
	},
	outputSchema: {
		type: 'object',
		properties: {
			wallet: { type: 'string' },
			hops: { type: 'integer' },
			nodes: { type: 'array', items: { type: 'object' } },
			edges: { type: 'array', items: { type: 'object' } },
			truncated: { type: 'boolean' },
			ts: { type: 'string', format: 'date-time' },
		},
	},
	example: '/api/crypto/funding-graph?wallet=JUPW3tHBxmNRzVnLmTyYUsUDB6izZSEtupY6znBC5mo',
};
