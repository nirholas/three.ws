// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'research-search',
	title: 'Scholarly Search',
	category: 'live-data',
	useCase: 'three.ws Scholarly Search: $0.002 USDC per call returns a ranked, de-duplicated merge of arXiv, Crossref, and Semantic Scholar hits for a query, with authors, venue, DOI, abstract, and citation count.',
	path: '/api/x402/research-search',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '2000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Research',
	tags: ['research', 'academic', 'live-data', 'arxiv', 'crossref'],
	description: 'three.ws Scholarly Search: live public-data endpoint, no API key anywhere in the chain. Pay $0.002 USDC (or use the free daily per-IP quota) to query arXiv, Crossref, and Semantic Scholar in parallel and get a merged, de-duplicated ranking of papers with authors, year, venue, DOI, arXiv id, abstract, and citation count. A source failing or rate-limiting is reported per-source rather than failing the whole call.',
	input: { q: 'transformer attention mechanism', limit: 10 },
	inputSchema: {
		type: 'object',
		required: ['q'],
		properties: {
			q: { type: 'string', description: 'Search query.' },
			limit: { type: 'integer', minimum: 1, maximum: 25, default: 10, description: 'Max papers to return.' },
		},
	},
	outputExample: {
		query: 'transformer attention mechanism',
		count: 2,
		papers: [
			{
				title: 'Attention Is All You Need',
				authors: ['Ashish Vaswani', 'Noam Shazeer'],
				year: 2017,
				venue: 'NeurIPS',
				doi: null,
				arxivId: '1706.03762',
				url: 'https://arxiv.org/abs/1706.03762',
				abstract: 'The dominant sequence transduction models...',
				citationCount: 142000,
				source: 'semantic-scholar',
			},
		],
		sources: { arxiv: 'ok', crossref: 'ok', semanticScholar: 'ok' },
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
