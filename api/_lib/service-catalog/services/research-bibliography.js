// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'research-bibliography',
	title: 'Bibliography Formatter',
	category: 'live-data',
	useCase: 'three.ws Bibliography: $0.005 USDC per call returns formatted BibTeX and APA 7 entries for up to 25 DOIs in one request.',
	path: '/api/x402/research-bibliography',
	method: 'POST',
	free: false,
	status: 'live',
	priceAtomics: '5000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Research',
	tags: ['research', 'academic', 'live-data', 'citations', 'bibliography'],
	description: 'three.ws Bibliography: pay $0.005 USDC per call to get formatted BibTeX and/or APA 7 citation entries for up to 25 DOIs in one request, sourced live from Crossref.',
	input: { dois: ['10.1038/nature14539'], format: 'both' },
	inputSchema: {
		type: 'object',
		required: ['dois'],
		properties: {
			dois: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 25, description: 'DOIs to format, 1 to 25 per call.' },
			format: { type: 'string', enum: ['bibtex', 'apa', 'both'], default: 'both', description: 'Citation format to return.' },
		},
	},
	outputExample: {
		format: 'both',
		count: 1,
		entries: [
			{
				doi: '10.1038/nature14539',
				status: 'ok',
				bibtex: '@article{...}',
				apa: 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539',
			},
		],
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
