// `ibm_granite_getting_started` — FREE meta tool: orient a caller before they pay.
//
// Unlike the five `ibm_granite_*` inference tools, this one is NOT wrapped in
// `paid()`. It returns immediately with no x402 PaymentRequired envelope, so any
// MCP client — including ones that can't (yet) settle USDC on Solana, or hosts
// like watsonx Orchestrate that aren't x402-capable — can call it to learn what
// the server offers, what each tool costs, and how the payment flow works.

import { createRequire } from 'node:module';

import { z } from 'zod';

// Read the package version once so the payload can never drift from the
// published package version.
const require = createRequire(import.meta.url);
const PACKAGE_VERSION = require('../../package.json').version;

const TOOL_NAME = 'ibm_granite_getting_started';
const TOOL_DESCRIPTION =
	'FREE — start here. Returns an overview of this server: the IBM Granite tools available, ' +
	'their per-call USDC prices, how the x402 pay-per-call flow works, setup requirements, and ' +
	'runnable example calls. No payment required. Call this first to orient before invoking a paid tool.';

// Single in-file catalog of the paid tools. Kept in sync with src/tools/*.js,
// SERVER_INSTRUCTIONS in index.js, and README.md / CATALOG.md.
const TOOLS = [
	{
		name: 'ibm_granite_chat',
		price: '$0.02',
		summary: 'Conversational AI via IBM Granite 3 8B Instruct.',
		params: 'messages[] (role/content), model?, max_new_tokens? (≤4096, default 1024), temperature? (0–2, default 0.7)',
		example: {
			messages: [{ role: 'user', content: 'Explain quantum entanglement in two sentences.' }],
		},
	},
	{
		name: 'ibm_granite_code',
		price: '$0.025',
		summary: 'Code generate / review / refactor / explain / test / document.',
		params: 'task (enum), prompt (description or pasted code), language?, context?',
		example: { task: 'review', prompt: 'def roi(rev, cost): return rev / cost', language: 'Python' },
	},
	{
		name: 'ibm_granite_embed',
		price: '$0.005',
		summary: 'Batch text embeddings (granite-embedding-278m-multilingual) for RAG and search.',
		params: 'inputs[] (1–64 texts, ≤8000 chars each), model?',
		example: { inputs: ['enterprise data governance', 'cloud-native AI pipeline'] },
	},
	{
		name: 'ibm_granite_analyze',
		price: '$0.04',
		summary: 'Structured document analysis: entities, sentiment, risk flags, summary, next steps.',
		params: 'document (≤24000 chars), analysis_type? (general|contract|financial|technical|medical|sentiment), language?',
		example: { document: 'This Services Agreement is entered into between...', analysis_type: 'contract' },
	},
	{
		name: 'ibm_granite_forecast',
		price: '$0.05',
		summary: 'Zero-shot time-series forecasting via IBM Granite TTM (no training).',
		params: 'timestamps[] (64–1024, ISO-8601), values[] (same length), freq (e.g. 1h/1D/1W), prediction_length? (≤96), label?',
		example: { timestamps: ['2025-01-01T00:00:00Z'], values: [1200], freq: '1D', prediction_length: 7 },
	},
];

const PAYMENT_FLOW = [
	'Call any ibm_granite_* tool. With no payment in _meta, the server replies with an x402 PaymentRequired envelope quoting the exact USDC price and a Solana pay-to address.',
	'Your client signs a Solana USDC transfer for that amount and retries the call with the signed payload in _meta["x402/payment"].',
	'The server verifies + settles the payment through the x402 facilitator, runs the IBM watsonx.ai inference, and returns the result.',
	'The settlement receipt comes back in _meta["x402/payment-response"]. x402-capable MCP clients perform steps 2–4 automatically.',
];

const SETUP = {
	endUsers: 'No IBM Cloud account needed. You only need an x402-capable wallet funded with USDC on Solana to pay per call. This getting_started tool is free.',
	operators: {
		required: {
			MCP_SVM_PAYMENT_ADDRESS: 'Your Solana wallet that receives USDC payments.',
			WATSONX_API_KEY: 'IBM Cloud API key — https://cloud.ibm.com/iam/apikeys',
			WATSONX_PROJECT_ID: 'watsonx.ai project id (or WATSONX_SPACE_ID).',
		},
		optional: 'WATSONX_URL (region, default us-south), WATSONX_MODEL_ID, WATSONX_EMBED_MODEL_ID, X402_FEE_PAYER_SOLANA, X402_FACILITATOR_URL.',
		run: 'npx @three-ws/ibm-x402-mcp',
	},
};

const LINKS = {
	homepage: 'https://three.ws',
	npm: 'https://www.npmjs.com/package/@three-ws/ibm-x402-mcp',
	source: 'https://github.com/nirholas/three.ws/tree/main/packages/ibm-x402-mcp',
	support: 'https://three.ws/support',
	x402: 'https://x402.org',
};

function buildPayload(section) {
	const overview =
		'x402 pay-per-use IBM Granite AI over MCP. Five inference tools, each settled in USDC on ' +
		'Solana via the x402 protocol — no IBM Cloud account required for callers. This tool is free; ' +
		'every other tool quotes its price below.';

	const full = {
		ok: true,
		server: 'ibm-x402-mcp',
		version: PACKAGE_VERSION,
		overview,
		tools: TOOLS,
		pricing: TOOLS.map((t) => `${t.name}: ${t.price}/call`),
		payment_flow: PAYMENT_FLOW,
		setup: SETUP,
		links: LINKS,
		next_step:
			'Pick a tool from `tools`, send the shown `example` as arguments, and your x402 client will ' +
			'handle the USDC payment automatically.',
	};

	if (section === 'pricing') return { ok: true, pricing: full.pricing, tools: TOOLS.map(({ name, price, summary }) => ({ name, price, summary })) };
	if (section === 'payment') return { ok: true, payment_flow: PAYMENT_FLOW, setup: SETUP };
	if (section === 'tools') return { ok: true, tools: TOOLS };
	if (section === 'setup') return { ok: true, setup: SETUP, links: LINKS };
	return full;
}

function renderText(payload) {
	if (!payload.overview) {
		// Focused section — return compact JSON the model can read directly.
		return JSON.stringify(payload, null, 2);
	}
	const lines = [
		'# IBM Granite x402 MCP — Getting Started',
		'',
		payload.overview,
		'',
		'## Tools (call any of these; this getting_started tool is free)',
		...payload.tools.map(
			(t) => `- ${t.name} — ${t.price}/call — ${t.summary}\n    params: ${t.params}`,
		),
		'',
		'## How payment works (x402)',
		...payload.payment_flow.map((s, i) => `${i + 1}. ${s}`),
		'',
		'## Run it (server operator)',
		`Required env: MCP_SVM_PAYMENT_ADDRESS, WATSONX_API_KEY, WATSONX_PROJECT_ID. Then: ${SETUP.operators.run}`,
		'',
		'## Links',
		...Object.entries(payload.links).map(([k, v]) => `- ${k}: ${v}`),
		'',
		`Next: ${payload.next_step}`,
	];
	return lines.join('\n');
}

export function buildGettingStartedTool() {
	const inputSchema = {
		section: z
			.enum(['overview', 'pricing', 'payment', 'tools', 'setup'])
			.optional()
			.describe(
				'Which part to return. Defaults to "overview" (everything). Use "pricing", "payment", "tools", or "setup" to focus.',
			),
	};

	async function handler(args) {
		const section = args?.section || 'overview';
		const payload = buildPayload(section);
		return {
			content: [{ type: 'text', text: renderText(payload) }],
			structuredContent: payload,
		};
	}

	return {
		name: TOOL_NAME,
		title: 'Getting Started (free)',
		description: TOOL_DESCRIPTION,
		// Static catalog content: read-only, fully deterministic, and answered
		// in-process — no external systems are contacted (closed world).
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
			idempotentHint: true,
		},
		inputSchema,
		handler,
	};
}
