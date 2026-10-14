// Service-catalog descriptor: see news-pulse.js for the contract notes.
// Do not re-add a hand-written mirror for this route in api/wk.js.

export default {
	slug: 'books-read',
	title: 'Book Read',
	category: 'live-data',
	useCase: 'three.ws Book Read: $0.01 USDC per call delivers a complete public-domain Project Gutenberg book, boilerplate stripped and split into chapters, as markdown JSON.',
	path: '/api/x402/books-read',
	method: 'GET',
	free: false,
	status: 'live',
	priceAtomics: '10000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Books',
	tags: ['books', 'live-data', 'gutenberg', 'full-text'],
	description: 'three.ws Book Read: pay $0.01 USDC per call to receive the complete text of a public-domain Project Gutenberg book, with the licence boilerplate stripped and the text split into chapters, delivered as markdown JSON in the response body. Find a gutenbergId with Book Search first.',
	input: { gutenbergId: 1342 },
	inputSchema: {
		type: 'object',
		required: ['gutenbergId'],
		properties: {
			gutenbergId: { type: 'integer', description: 'Project Gutenberg ebook id, from Book Search.' },
		},
	},
	outputExample: {
		source: 'gutenberg',
		gutenbergId: 1342,
		title: 'Pride and Prejudice',
		authors: ['Jane Austen'],
		chapterCount: 61,
		wordCount: 122000,
		chapters: [{ index: 1, title: 'Chapter I', markdown: 'It is a truth universally acknowledged...', wordCount: 450 }],
	},
	storefronts: ['x402scan'],
};
