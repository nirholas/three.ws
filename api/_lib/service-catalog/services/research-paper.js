// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'research-paper',
	title: 'Paper Detail & Citation Graph',
	category: 'live-data',
	useCase: 'three.ws Paper Detail: $0.003 USDC per call returns metadata, abstract, TL;DR, and a two-sided citation graph for a DOI, arXiv id, or Semantic Scholar id.',
	path: '/api/x402/research-paper',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '3000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Research',
	tags: ['research', 'academic', 'live-data', 'citations'],
	description: 'three.ws Paper Detail: pay $0.003 USDC per call for a single paper\'s full metadata (title, abstract, TL;DR, year, venue, authors, fields of study, open-access PDF link) plus a two-sided citation graph (top citations and references) from Semantic Scholar, keyed by DOI, arXiv id, or Semantic Scholar id. Falls back to Crossref metadata (marked partial, no citation graph) when Semantic Scholar is unreachable for a DOI.',
	input: { id: '10.48550/arXiv.1706.03762' },
	inputSchema: {
		type: 'object',
		required: ['id'],
		properties: {
			id: { type: 'string', description: 'A DOI, arXiv id (e.g. "1706.03762"), or Semantic Scholar paper id.' },
		},
	},
	outputExample: {
		id: '1706.03762',
		resolvedAs: 'ARXIV:1706.03762',
		title: 'Attention Is All You Need',
		abstract: 'The dominant sequence transduction models...',
		year: 2017,
		venue: 'NeurIPS',
		authors: ['Ashish Vaswani', 'Noam Shazeer'],
		citationGraph: { citationCount: 142000, referenceCount: 45, topCitations: [], references: [] },
		source: 'semantic-scholar',
	},
	storefronts: ['x402scan'],
};
