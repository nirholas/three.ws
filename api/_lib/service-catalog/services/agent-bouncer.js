// Service-catalog descriptor — the single written-once listing for this
// service. api/wk.js derives its /.well-known/x402.json resource entry from
// this file via api/_lib/service-catalog/index.js (toBazaarDiscovery), and
// the OKX storefront projection reads the same record (toOkxCatalog).
// Contract: specs/service-catalog.md. Do not re-add a hand-written mirror
// for this route in api/wk.js — edit this descriptor instead.

export default {
	slug: 'agent-bouncer',
	title: 'Agent Bouncer',
	category: 'trust',
	useCase: 'Agent Bouncer — the Pole Club door check, opened to the whole platform’s Solana reputation.',
	path: '/api/x402/agent-bouncer',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '10000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Agent Bouncer',
	tags: ['reputation', 'trust', 'gate', 'agent', 'solana'],
	description: 'Agent Bouncer — the Pole Club door check, opened to the whole platform’s Solana reputation. Given a three.ws agent_id and an optional trust policy, read the agent’s Solana track record (confirmed on-chain payments, distinct payers, payment failure rate, distribute/buyback follow-through, signed Solana attestations, Club ban/tip ledger) and return an admit/refuse verdict with a door tier (newcomer / regular / trusted / vip). Vet a counterparty before paying, hiring, or delegating.',
	input: {
		agent_id: '7b9a4f30-2d11-4e2d-9d12-1cdb1f6a3a55',
		min_payments: 10,
		min_distinct_payers: 3,
		max_failure_rate: 0.2,
	},
	inputSchema: {
		type: 'object',
		required: ['agent_id'],
		properties: {
			agent_id: {
				type: 'string',
				format: 'uuid',
			},
			// Defaults are the permissive policy the handler applies when a
			// threshold is omitted (api/x402/agent-bouncer.js parseCount / parseRate).
			min_payments: {
				type: 'integer',
				minimum: 0,
			},
			min_distinct_payers: {
				type: 'integer',
				minimum: 0,
			},
			max_failure_rate: {
				type: 'number',
				minimum: 0,
				maximum: 1,
				default: 1,
			},
			min_attestations: {
				type: 'integer',
				minimum: 0,
			},
			allow_newcomers: {
				type: 'boolean',
				default: true,
			},
		},
	},
	storefronts: ['x402scan'],
};
