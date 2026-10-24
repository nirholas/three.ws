// Catalog entry for GET /api/crypto/due-diligence: holder-quality fields for a
// Solana token. Plain, serializable, no imports, no side effects.

export default {
	slug: 'due-diligence',
	method: 'GET',
	path: '/api/crypto/due-diligence',
	title: 'Token Due Diligence',
	summary:
		'Who holds a Solana token, not just what its contract can do: insider hold rate, sniper share, bundler exposure, fresh-wallet ratio and smart-money holders as shares of supply, computed from chain data and our own tracked wallet history, with a two-hop funding graph of the largest holders. Cached per mint for five minutes; a field is null when its data could not be read.',
	inputSchema: {
		type: 'object',
		required: ['address'],
		properties: {
			address: { type: 'string', description: 'Solana token mint to inspect (base58).' },
		},
	},
	outputSchema: {
		type: 'object',
		properties: {
			address: { type: 'string' },
			chain: { type: 'string' },
			computed_at: { type: 'string', format: 'date-time' },
			ttl_seconds: { type: 'integer' },
			fields: {
				type: 'object',
				properties: {
					insider_pct: { type: ['number', 'null'] },
					sniper_pct: { type: ['number', 'null'] },
					bundler_pct: { type: ['number', 'null'] },
					fresh_wallet_pct: { type: ['number', 'null'] },
					fresh_wallet_ratio: { type: ['number', 'null'] },
					smart_money_holders: { type: ['integer', 'null'] },
					smart_money_pct: { type: ['number', 'null'] },
				},
			},
			holders: { type: 'array', items: { type: 'object' } },
			clusters: { type: 'array', items: { type: 'object' } },
			coverage: { type: 'object' },
			notes: { type: 'array', items: { type: 'string' } },
			graph: { type: 'object' },
			thresholds: { type: 'object' },
			definitions: { type: 'object' },
		},
	},
	example: '/api/crypto/due-diligence?address=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
};
