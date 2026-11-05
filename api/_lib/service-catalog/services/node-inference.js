// Service-catalog descriptor: the single written-once listing for this
// service. api/wk.js derives its /.well-known/x402.json resource entry from
// this file via api/_lib/service-catalog/index.js (toBazaarDiscovery).
// Contract: specs/service-catalog.md. Do not re-add a hand-written mirror
// for this route in api/wk.js; edit this descriptor instead.

export default {
	slug: 'node-inference',
	title: 'Node Network Inference',
	category: 'agent-infra',
	useCase: 'Run one inference job on the open three.ws node network and pay only for a result whose node receipt verified.',
	path: '/api/x402/node-inference',
	method: 'POST',
	free: false,
	status: 'live',
	priceAtomics: '5000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws Node Network Inference',
	tags: ['inference', 'nodes', 'embedding', 'decentralized'],
	description: 'Run one inference job on the open three.ws node network. The platform enqueues the job for a live community node, verifies the node\'s ed25519 receipt against its own record of the job, and settles only for a verified result. Capabilities: text-embedding ($0.001 USDC) and text-generation ($0.005 USDC). No live node for the capability answers 503 and settles nothing.',
	input: {
		capability: 'text-embedding',
		input: { text: 'hello' },
	},
	inputSchema: {
		type: 'object',
		required: ['capability', 'input'],
		properties: {
			capability: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{1,63}$', description: 'Capability a live node advertises, e.g. text-embedding.' },
			model: { type: 'string', maxLength: 120 },
			input: { description: 'Capability-specific input payload (up to 20000 characters serialized).' },
		},
	},
	outputExample: {
		output: { embedding: [0.0132, -0.0478, 0.0911], dimensions: 384 },
		jobId: '7f3c2a9e-5b1d-4e8a-9c6f-2d4b8e1a0f37',
		node: 'THREEsyntheticNode1111111111111111111111111',
		receipt: { version: 'threews-node/v1', algorithm: 'ed25519', signature: '3kTzP9…' },
		capability: 'text-embedding',
		model: 'Xenova/all-MiniLM-L6-v2',
	},
	storefronts: ['x402scan'],
};
