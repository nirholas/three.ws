// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.
// Slug is "news-wire-*" (not "news-*") to avoid colliding with the
// unrelated pre-existing "news-pulse" ticker-sentiment service.

export default {
	slug: 'news-wire-pulse',
	title: 'Global News Wire Pulse',
	category: 'live-data',
	useCase: 'three.ws Global News Wire Pulse: $0.002 USDC per call returns only the GDELT articles indexed since a cursor, with a fresh cursor for the next poll, for building a live news feed without re-fetching.',
	path: '/api/x402/news-wire-pulse',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws News Wire',
	tags: ['news', 'live-data', 'gdelt', 'media-monitoring', 'polling'],
	description: 'three.ws Global News Wire Pulse: pay $0.002 USDC per call to get only the GDELT articles that have appeared for your query since a cursor you supply, plus a fresh cursor for the next poll. Built for agents running a repeated poll loop against Global News Wire Search without re-fetching the same articles. Start with News Wire Search to get a query working, then switch to Pulse for ongoing monitoring.',
	input: { q: 'earthquake relief', cursor: '20261014000000' },
	inputSchema: {
		type: 'object',
		required: ['q', 'cursor'],
		properties: {
			q: { type: 'string', description: 'Search query, same syntax as News Wire Search.' },
			cursor: { type: 'string', description: 'GDELT timestamp (YYYYMMDDHHMMSS) or ISO-8601 timestamp to poll since.' },
			maxRecords: { type: 'integer', minimum: 1, maximum: 75, default: 50 },
		},
	},
	outputExample: {
		query: 'earthquake relief',
		cursor: '20261014000000',
		nextCursor: '20261014001200',
		newArticleCount: 1,
		truncated: false,
		articles: [
			{ title: 'Example wire story', url: 'https://example.com/a', domain: 'example.com', language: 'English', sourceCountry: 'United States', seenDate: '20261014T001100Z', socialImage: null },
		],
		source: 'gdelt-doc-2.0',
		retrievedAt: '2026-10-14T00:12:00Z',
	},
	storefronts: ['x402scan'],
};
