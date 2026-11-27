// Service-catalog descriptor — the single written-once listing for this
// service. api/wk.js derives its /.well-known/x402.json resource entry from
// this file via api/_lib/service-catalog/index.js (toBazaarDiscovery), and
// the OKX storefront projection reads the same record (toOkxCatalog).
// Contract: specs/service-catalog.md. Do not re-add a hand-written mirror
// for this route in api/wk.js — edit this descriptor instead.

export default {
	slug: 'llm-proxy',
	title: 'LLM Inference Proxy',
	category: 'agent-infra',
	useCase: 'three.ws LLM Inference Proxy — pay per completion with no API key required.',
	path: '/api/x402/llm-proxy',
	method: 'POST',
	free: false,
	status: 'live',
	priceAtomics: '5000',
	acceptsBuilder: 'standard',
	serviceName: 'three.ws LLM Inference Proxy',
	tags: ['llm', 'inference', 'completion', 'proxy', 'benchmark'],
	description: 'three.ws LLM Inference Proxy: pay per completion with no API key required. Runs one-shot text prompts through commercially licensed providers only (Vertex AI Gemini and Claude, paid OpenAI). Response includes measured latency, token counts, and the provider actually used. Ideal for latency benchmarking, agent pipelines, and one-off completions. Model aliases: "fast" (sub-second) · "smart" (quality backstop). Price: $0.005 USDC per completion on Base or Solana.',
	input: {
		model: 'fast',
		prompt: 'Count to 3.',
		max_tokens: 10,
	},
	inputSchema: {
		type: 'object',
		required: ['prompt'],
		properties: {
			model: {
				type: 'string',
				default: 'fast',
			},
			prompt: {
				type: 'string',
				minLength: 1,
				maxLength: 4000,
			},
			max_tokens: {
				type: 'integer',
				minimum: 1,
				maximum: 2048,
				default: 256,
			},
		},
	},
	storefronts: ['x402scan'],
};
