// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.
// Slug is "news-wire-*" (not "news-*") to avoid colliding with the
// unrelated pre-existing "news-pulse" ticker-sentiment service.

export default {
	slug: 'news-wire-query',
	title: 'Global News Wire Search',
	category: 'live-data',
	useCase: 'three.ws Global News Wire Search: $0.003 USDC per call searches worldwide news coverage via the GDELT Project (65+ languages, updated every 15 minutes) and returns matching articles plus a coverage-volume timeline.',
	path: '/api/x402/news-wire-query',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '3000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws News Wire',
	tags: ['news', 'live-data', 'gdelt', 'media-monitoring'],
	description: 'three.ws Global News Wire Search: live public-data endpoint, no API key anywhere in the chain. Pay $0.003 USDC (or use the free daily per-IP quota) to search the GDELT Project\'s real-time index of worldwide news media in 65+ languages. Returns matching articles (title, URL, domain, language, source country, seen date) plus a coverage-volume timeline over the chosen timespan. GDELT throttles to roughly one upstream request per 5 seconds per IP; this endpoint serializes calls to respect that.',
	input: { q: 'earthquake relief', timespan: '3d' },
	inputSchema: {
		type: 'object',
		required: ['q'],
		properties: {
			q: { type: 'string', description: 'Search query. Free text is quoted automatically; GDELT operators (AND, OR, sourcelang:, etc) pass through as-is.' },
			timespan: { type: 'string', default: '3d', description: 'GDELT lookback window, e.g. 1d, 3d, 1w, 1m.' },
			maxRecords: { type: 'integer', minimum: 1, maximum: 75, default: 25 },
			sourceLang: { type: 'string', description: 'Restrict to a GDELT source language code, e.g. eng.' },
			sourceCountry: { type: 'string', description: 'Restrict to a GDELT source country code, e.g. us.' },
			includeTimeline: { type: 'boolean', default: true, description: 'Include the coverage-volume timeline (one extra upstream call).' },
		},
	},
	outputExample: {
		query: 'earthquake relief',
		effectiveQuery: '"earthquake relief"',
		timespan: '3d',
		count: 2,
		articles: [
			{ title: 'Example wire story', url: 'https://example.com/a', domain: 'example.com', language: 'English', sourceCountry: 'United States', seenDate: '20261014T120000Z', socialImage: null },
		],
		volumeTimeline: [{ date: '20261013T000000Z', value: 1.2 }],
		timelineStatus: 'ok',
		source: 'gdelt-doc-2.0',
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
