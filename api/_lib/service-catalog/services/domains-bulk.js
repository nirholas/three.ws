// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'domains-bulk',
	title: 'Domain Check (Bulk RDAP)',
	category: 'live-data',
	useCase: 'three.ws Domain Check Bulk: $0.005 USDC per call checks up to 50 domains in one paid RDAP sweep, for domain-portfolio audits and brand-protection scans.',
	path: '/api/x402/domains-bulk',
	method: 'POST',
	free: false,
	status: 'live',
	priceAtomics: '5000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Domain Intelligence',
	tags: ['domains', 'rdap', 'live-data', 'dns', 'bulk'],
	description: 'three.ws Domain Check Bulk: pay $0.005 USDC per call to check up to 50 domains in one request against their authoritative RDAP servers, with bounded concurrency. Returns a per-domain registration breakdown plus registered/available/unknown counts, for domain-portfolio audits and brand-protection scans.',
	input: { domains: ['example.com', 'example.net', 'example.org'] },
	inputSchema: {
		type: 'object',
		required: ['domains'],
		properties: {
			domains: {
				type: 'array',
				items: { type: 'string' },
				minItems: 1,
				maxItems: 50,
				description: 'Domains to check, 1 to 50 per call.',
			},
		},
	},
	outputExample: {
		count: 3,
		registered: 2,
		available: 1,
		unknown: 0,
		results: [
			{ domain: 'example.com', status: 'registered', available: false },
			{ domain: 'example.net', status: 'registered', available: false },
			{ domain: 'a-free-name-example.com', status: 'available', available: true },
		],
	},
	storefronts: ['x402scan'],
};
