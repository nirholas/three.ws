// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'books-search',
	title: 'Book Search',
	category: 'live-data',
	useCase: 'three.ws Book Search: $0.001 USDC per call returns OpenLibrary editions for a title, each annotated with whether a clean Project Gutenberg full text is available to buy.',
	path: '/api/x402/books-search',
	method: 'GET',
	free: true,
	status: 'live',
	priceAtomics: '1000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Books',
	tags: ['books', 'live-data', 'openlibrary', 'gutenberg'],
	description: 'three.ws Book Search: live public-data endpoint, no API key anywhere in the chain. Pay $0.001 USDC (or use the free daily per-IP quota) to search OpenLibrary editions by title (and optionally author) and get each edition annotated with whether a cleaned Project Gutenberg full text can be bought from Book Read, resolved live via Gutendex with a gutenberg.org fallback.',
	input: { q: 'pride and prejudice', limit: 5 },
	inputSchema: {
		type: 'object',
		required: ['q'],
		properties: {
			q: { type: 'string', description: 'Title to search for.' },
			author: { type: 'string', description: 'Optional author filter.' },
			limit: { type: 'integer', minimum: 1, maximum: 25, default: 5, description: 'Max editions to return.' },
		},
	},
	outputExample: {
		source: 'openlibrary+gutenberg',
		query: { q: 'pride and prejudice', author: null, limit: 5 },
		totalFound: 120,
		count: 1,
		editions: [
			{
				key: '/works/OL66554W',
				title: 'Pride and Prejudice',
				authors: ['Jane Austen'],
				firstPublishYear: 1813,
				ebookAccess: 'public',
				gutenberg: { available: true, gutenbergId: 1342, readPath: '/read/1342' },
			},
		],
		retrievedAt: '2026-10-14T00:00:00Z',
	},
	storefronts: ['x402scan'],
};
