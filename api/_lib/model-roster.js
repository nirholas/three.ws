// The open-model roster: every open-weights and Gemini model a user can pick
// for an agent's brain, with the ordered transport routes that serve it.
//
// One row per model. A row is the whole truth about that model on this
// platform: what to call it, who makes it, how much context it takes, whether
// it can call tools, what it costs per million tokens, whether the free tier
// covers it, and the ordered list of upstream routes that can serve it.
//
// Routes are tried in order and every route serves the SAME model (never a
// look-alike), so a failover never changes what the user picked. Free lanes the
// platform already holds lead; Vertex AI Model Garden (GCP credits, standing
// owner approval) is the route every paid model starts on and the credits-funded
// tail of the free ones that have a Vertex twin. When every route of a model
// fails, the caller's normal platform chain takes over behind it
// (llm-tool-chain.js providerChainFor, brain/chat.js freeFallbackChain), so a
// dead model degrades to an answer from another model rather than to an error.
//
// Lanes (the `lane` field of a route):
//   vertex          Vertex AI OpenAI-compatible endpoint (endpoints/openapi).
//                   Serves Gemini and every Model Garden MaaS model (Llama,
//                   DeepSeek, Qwen, Kimi). Keyless: a GCP OAuth token per call.
//   vertex-mistral  Mistral partner models on Vertex. Not on endpoints/openapi;
//                   served by publishers/mistralai/models/<id>:streamRawPredict,
//                   which takes and returns the Mistral chat format (OpenAI wire).
//   nvidia | groq | ovh | openrouter | mistral | sambanova | cerebras | gemini
//                   The platform's existing free lanes (docs/ops/llm-lanes.md).
//
// Prices are the Vertex list price per million tokens [input, output], which is
// what the platform meters a paid route at (llm-pricing.js reads them from
// here). A free model's price is still shown: it is what a message costs the
// platform when the free lanes are exhausted and a paid tail answers.
//
// Verified 2026-09-22 with a real tool-calling request per free route:
//   groq qwen/qwen3.8-27b, ovh Mistral-Small-3.2-24B-Instruct-2506 and nvidia
//   deepseek-ai/deepseek-v4.1-flash each returned a get_price tool call. OVH
//   answered 429 to this workspace's shared egress IP (it serves from the Cloud
//   Run egress, docs/ops/llm-lanes.md). Every Vertex route answered 403
//   "Lightning dunning decision is deny", a billing hold on the whole GCP
//   project that only the owner can clear. The Vertex ids and regions below are
//   the Model Garden MaaS ids; they serve the moment the hold lifts, and
//   llm-health.js probeRosterHealth reports each route's live state so the
//   picker shows "provider degraded" until then.

/**
 * @typedef {{ lane: string, model: string, location?: string }} RosterRoute
 * @typedef {{
 *   id: string,
 *   label: string,
 *   family: string,
 *   description: string,
 *   context: number,
 *   maxOutput: number,
 *   tools: boolean,
 *   free: boolean,
 *   reasoning?: boolean,
 *   price: [number, number],
 *   routes: RosterRoute[],
 * }} RosterModel
 */

/** @type {RosterModel[]} */
export const ROSTER = [
	// ── Meta Llama ────────────────────────────────────────────────────────────
	{
		id: 'llama-3.3-70b',
		label: 'Llama 3.3 70B',
		family: 'Meta',
		description: 'Meta’s proven open 70B. Reliable tool use, free tier.',
		context: 131_072,
		maxOutput: 8192,
		tools: true,
		free: true,
		price: [0.72, 0.72],
		routes: [
			{ lane: 'ovh', model: 'Meta-Llama-3_3-70B-Instruct' },
			{ lane: 'sambanova', model: 'Meta-Llama-3.3-70B-Instruct' },
			{ lane: 'cerebras', model: 'llama-3.3-70b' },
			{ lane: 'vertex', model: 'meta/llama-3.3-70b-instruct-maas', location: 'us-central1' },
		],
	},
	{
		id: 'llama-4-maverick',
		label: 'Llama 4 Maverick',
		family: 'Meta',
		description: 'Llama 4 flagship: 128-expert MoE, long context, strong multilingual tool use.',
		context: 524_288,
		maxOutput: 8192,
		tools: true,
		free: false,
		price: [0.35, 1.15],
		routes: [{ lane: 'vertex', model: 'meta/llama-4-maverick-17b-128e-instruct-maas', location: 'us-east5' }],
	},
	{
		id: 'llama-4-scout',
		label: 'Llama 4 Scout',
		family: 'Meta',
		description: 'Efficient Llama 4 with a very long context window. Fast and cheap.',
		context: 1_310_720,
		maxOutput: 8192,
		tools: true,
		free: false,
		price: [0.25, 0.7],
		routes: [{ lane: 'vertex', model: 'meta/llama-4-scout-17b-16e-instruct-maas', location: 'us-east5' }],
	},

	// ── DeepSeek ──────────────────────────────────────────────────────────────
	{
		id: 'deepseek-v4-flash',
		label: 'DeepSeek V4.1 Flash',
		family: 'DeepSeek',
		description: 'Current DeepSeek generation, tuned for speed. Tool calling, free tier.',
		context: 1_048_576,
		maxOutput: 8192,
		tools: true,
		free: true,
		reasoning: true,
		price: [0.15, 0.6],
		routes: [{ lane: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' }],
	},
	{
		id: 'deepseek-v3.1',
		label: 'DeepSeek V3.1',
		family: 'DeepSeek',
		description: 'Hybrid thinking model. Strong coding and agentic tool use.',
		context: 163_840,
		maxOutput: 8192,
		tools: true,
		free: false,
		price: [0.6, 1.7],
		routes: [{ lane: 'vertex', model: 'deepseek-ai/deepseek-v3.1-maas', location: 'us-west2' }],
	},
	{
		id: 'deepseek-r1',
		label: 'DeepSeek R1',
		family: 'DeepSeek',
		description: 'Open reasoning model for math, code and planning. Chat only: no tool calling.',
		context: 163_840,
		maxOutput: 8192,
		tools: false,
		free: false,
		reasoning: true,
		price: [1.35, 5.4],
		routes: [{ lane: 'vertex', model: 'deepseek-ai/deepseek-r1-0528-maas', location: 'us-central1' }],
	},

	// ── Moonshot Kimi ─────────────────────────────────────────────────────────
	{
		id: 'kimi-k2',
		label: 'Kimi K2 Thinking',
		family: 'Moonshot',
		description: 'Long-horizon agentic model built for long chains of sequential tool calls.',
		context: 262_144,
		maxOutput: 8192,
		tools: true,
		free: false,
		reasoning: true,
		price: [0.6, 2.5],
		routes: [{ lane: 'vertex', model: 'moonshotai/kimi-k2-thinking-maas', location: 'global' }],
	},

	// ── Mistral ───────────────────────────────────────────────────────────────
	{
		id: 'mistral-small',
		label: 'Mistral Small 3',
		family: 'Mistral',
		description: 'Compact 24B with native function calling. Fast, free tier.',
		context: 131_072,
		maxOutput: 8192,
		tools: true,
		free: true,
		price: [0.1, 0.3],
		routes: [
			{ lane: 'ovh', model: 'Mistral-Small-3.2-24B-Instruct-2506' },
			{ lane: 'mistral', model: 'mistral-small-latest' },
			{ lane: 'vertex-mistral', model: 'mistral-small-2503', location: 'us-central1' },
		],
	},
	{
		id: 'mistral-large',
		label: 'Mistral Large',
		family: 'Mistral',
		description: 'Mistral’s flagship. Top-tier reasoning, multilingual, function calling.',
		context: 131_072,
		maxOutput: 8192,
		tools: true,
		free: false,
		price: [2, 6],
		routes: [
			{ lane: 'vertex-mistral', model: 'mistral-large-2411', location: 'us-central1' },
			{ lane: 'mistral', model: 'mistral-large-latest' },
		],
	},

	// ── Qwen ──────────────────────────────────────────────────────────────────
	{
		id: 'qwen3.8-27b',
		label: 'Qwen 3.8 27B',
		family: 'Qwen',
		description: 'Latest dense Qwen 3. Fast, sharp tool use, three free lanes behind it.',
		context: 131_072,
		maxOutput: 8192,
		tools: true,
		free: true,
		price: [0.42, 3],
		routes: [
			{ lane: 'groq', model: 'qwen/qwen3.8-27b' },
			{ lane: 'openrouter', model: 'qwen/qwen3.8-27b:free' },
			{ lane: 'ovh', model: 'Qwen3.8-27B' },
		],
	},
	{
		id: 'qwen3-235b',
		label: 'Qwen 3 235B',
		family: 'Qwen',
		description: 'Qwen 3 flagship MoE. Excellent multilingual reasoning and tool use.',
		context: 262_144,
		maxOutput: 8192,
		tools: true,
		free: false,
		price: [0.22, 0.88],
		routes: [{ lane: 'vertex', model: 'qwen/qwen3-235b-a22b-instruct-2507-maas', location: 'us-south1' }],
	},

	// ── Google Gemini ─────────────────────────────────────────────────────────
	{
		id: 'gemini-2.5-pro',
		label: 'Gemini 2.5 Pro',
		family: 'Google',
		description: 'Google’s most capable 2.5 model. 1M context, deep reasoning.',
		context: 1_048_576,
		maxOutput: 16384,
		tools: true,
		free: false,
		reasoning: true,
		price: [1.25, 10],
		routes: [
			{ lane: 'vertex', model: 'google/gemini-2.5-pro', location: 'global' },
			{ lane: 'gemini', model: 'gemini-2.5-pro' },
		],
	},
	{
		id: 'gemini-2.5-flash',
		label: 'Gemini 2.5 Flash',
		family: 'Google',
		description: 'Fast, 1M-context Gemini with thinking. Great price to performance.',
		context: 1_048_576,
		maxOutput: 16384,
		tools: true,
		free: false,
		reasoning: true,
		price: [0.3, 2.5],
		routes: [
			{ lane: 'vertex', model: 'google/gemini-2.5-flash', location: 'global' },
			{ lane: 'gemini', model: 'gemini-2.5-flash' },
		],
	},
];

const BY_ID = new Map(ROSTER.map((m) => [m.id, m]));

/** The roster row for a model id, or null. */
export function rosterModel(id) {
	return (typeof id === 'string' && BY_ID.get(id)) || null;
}

/** Whether an id names a roster model. */
export function isRosterModel(id) {
	return BY_ID.has(id);
}

/** Roster ids the free tier covers. */
export function freeRosterIds() {
	return ROSTER.filter((m) => m.free).map((m) => m.id);
}

/** Whether a route runs on Vertex (billed to GCP credits). */
export function isVertexRoute(route) {
	return route?.lane === 'vertex' || route?.lane === 'vertex-mistral';
}

/** Vertex host for a location: the global endpoint has no region prefix. */
export function vertexHost(location) {
	return location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
}

/**
 * The full URL a Vertex route is called on. `vertex` routes use the
 * OpenAI-compatible chat-completions endpoint; `vertex-mistral` routes use the
 * partner rawPredict surface (streaming or not).
 * @param {RosterRoute} route
 * @param {{ stream?: boolean }} [opts]
 */
export function vertexRouteUrl(route, { stream = true } = {}) {
	const project = process.env.GOOGLE_CLOUD_PROJECT;
	const location = route.location || 'global';
	const root = `https://${vertexHost(location)}/v1/projects/${project}/locations/${location}`;
	if (route.lane === 'vertex-mistral') {
		return `${root}/publishers/mistralai/models/${route.model}:${stream ? 'streamRawPredict' : 'rawPredict'}`;
	}
	return `${root}/endpoints/openapi/chat/completions`;
}
