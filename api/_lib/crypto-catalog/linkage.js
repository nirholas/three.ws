// Catalog entry for GET /api/crypto/linkage: the free wallet-linkage endpoint.
//
// The /api/crypto index merges this descriptor into the bundle's discovery doc
// + OpenAPI (via the STATIC_ENTRIES barrel in index.js). Plain, serializable,
// no imports, no side effects.

export default {
	slug: 'linkage',
	method: 'GET',
	path: '/api/crypto/linkage',
	title: 'Wallet Linkage',
	summary:
		'Are these Solana wallets the same person? Pairwise 0-100 same-controller scores with evidence (shared fee payer, first-funder, SPL token-account control, direct transfer, funding burst), combined by noisy-OR across 2-10 addresses. Keyless, live on-chain history.',
	inputSchema: {
		type: 'object',
		required: ['addresses'],
		properties: {
			addresses: {
				type: 'string',
				description: 'Comma-separated list of 2 to 10 Solana addresses to cross-check for shared control.',
			},
		},
	},
	outputSchema: {
		type: 'object',
		properties: {
			addresses: { type: 'array', items: { type: 'string' } },
			pairs: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						a: { type: 'string' },
						b: { type: 'string' },
						score: { type: 'integer' },
						band: { type: 'string', enum: ['none', 'weak', 'moderate', 'strong', 'confirmed'] },
						topSignal: { type: ['string', 'null'] },
						signals: { type: 'array', items: { type: 'string' } },
						evidence: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									weight: { type: 'number' },
									evidence: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												kind: { type: 'string' },
												account: { type: 'string' },
												signature: { type: 'string' },
												detail: { type: 'string' },
											},
										},
									},
								},
							},
						},
					},
				},
			},
			complete: { type: 'boolean' },
			ts: { type: 'string', format: 'date-time' },
		},
	},
	example: '/api/crypto/linkage?addresses=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump,11111111111111111111111111111111',
};
