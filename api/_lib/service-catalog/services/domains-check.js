// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'domains-check',
	title: 'Domain Check (RDAP)',
	category: 'live-data',
	useCase: 'three.ws Domain Check: $0.001 USDC per call returns live registration status for one domain, straight from its authoritative RDAP server (RFC 9082/9083), no WHOIS scraping, no API key.',
	path: '/api/x402/domains-check',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '1000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Domain Intelligence',
	tags: ['domains', 'rdap', 'live-data', 'dns'],
	description: 'three.ws Domain Check: live public-data endpoint, no API key anywhere in the chain. Pay $0.001 USDC (or use the free daily per-IP quota) to query the authoritative RDAP server for a domain (resolved via the IANA bootstrap registry, with an rdap.org fallback) and get its registration status, registrar, creation/update/expiry dates, nameservers, status flags, and DNSSEC signing state.',
	input: { domain: 'example.com' },
	inputSchema: {
		type: 'object',
		required: ['domain'],
		properties: {
			domain: { type: 'string', description: 'Domain name to check, e.g. "example.com".' },
		},
	},
	outputExample: {
		domain: 'example.com',
		status: 'registered',
		available: false,
		registrar: 'RESERVED-Internet Assigned Numbers Authority',
		registrarIanaId: '376',
		createdAt: '1995-08-14T04:00:00Z',
		updatedAt: '2024-08-14T07:01:38Z',
		expiresAt: '2025-08-13T04:00:00Z',
		nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
		statusFlags: ['client delete prohibited', 'client transfer prohibited', 'client update prohibited'],
		dnssecSigned: true,
		rdapServer: 'https://rdap.verisign.com/com/v1/domain/example.com',
		source: 'rdap',
		checkedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
