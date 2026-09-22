// Turn an open-model roster route (api/_lib/model-roster.js) into a concrete
// OpenAI-wire transport: the URL to POST, how to authenticate, and the upstream
// model id. One resolver for every consumer, so the tool loop
// (llm-tool-chain.js), /brain streaming (brain/chat.js) and the health probe
// (llm-health.js) can never disagree about where a model lives.
//
// A transport has the shape streamRound() in llm-tool-chain.js already takes:
//   { name, url, key, model, catalogModel, extraHeaders?, getHeaders? }
// `name` is the ledger provider (llm-pricing.js prices it), `catalogModel` is
// the roster id the user picked, `model` is what the upstream is sent.
// A route whose lane has no credential on this deployment resolves to null and
// is skipped, exactly like a provider with no key in the platform chains.

import { env } from './env.js';
import { getGcpAccessToken } from './gcp-auth.js';
import { rosterModel, vertexRouteUrl } from './model-roster.js';

const OPENROUTER_HEADERS = { 'HTTP-Referer': 'https://three.ws', 'X-Title': 'three.ws' };

// Keyed lanes: URL plus the env credential that unlocks them. OVH is keyless
// (its documented anonymous tier), so its key resolves to null and is allowed.
const KEYED_LANES = {
	groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: () => env.GROQ_API_KEY },
	nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: () => env.NVIDIA_API_KEY },
	sambanova: { url: 'https://api.sambanova.ai/v1/chat/completions', key: () => env.SAMBANOVA_API_KEY },
	cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', key: () => env.CEREBRAS_API_KEY },
	mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: () => env.MISTRAL_API_KEY },
	gemini: {
		url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
		key: () => env.GEMINI_API_KEY,
	},
	ovh: { url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', key: () => null, keyless: true },
};

async function vertexHeaders() {
	const token = await getGcpAccessToken();
	return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function openrouterKeys() {
	return [...new Set([env.OPENROUTER_API_KEY, ...(env.OPENROUTER_FALLBACK_KEYS || [])].filter(Boolean))];
}

/**
 * Resolve one route to zero or more transports. OpenRouter `:free` routes fan
 * out to one transport per key (every key has its own free quota), matching
 * how the platform chain treats that lane.
 * @param {import('./model-roster.js').RosterRoute} route
 * @param {string} catalogModel the roster id
 * @returns {object[]}
 */
export function routeTransports(route, catalogModel) {
	if (route.lane === 'vertex' || route.lane === 'vertex-mistral') {
		if (!process.env.GOOGLE_CLOUD_PROJECT) return [];
		return [
			{
				name: route.lane === 'vertex' ? 'vertex' : 'vertex-mistral',
				url: vertexRouteUrl(route, { stream: true }),
				key: null,
				model: route.model,
				catalogModel,
				location: route.location || 'global',
				getHeaders: vertexHeaders,
			},
		];
	}
	if (route.lane === 'openrouter') {
		// Only genuinely free routes ride the fallback keys; those accounts are
		// unfunded and a paid id would 402 on every one of them.
		if (!route.model.endsWith(':free')) return [];
		return openrouterKeys().map((key, i) => ({
			name: i === 0 ? 'openrouter' : `openrouter#${i + 1}`,
			url: 'https://openrouter.ai/api/v1/chat/completions',
			key,
			model: route.model,
			catalogModel,
			extraHeaders: OPENROUTER_HEADERS,
		}));
	}
	const lane = KEYED_LANES[route.lane];
	if (!lane) return [];
	const key = lane.key();
	if (!key && !lane.keyless) return [];
	const transport = { name: route.lane, url: lane.url, key, model: route.model, catalogModel };
	// A keyless lane still needs a content-type header and must not send a
	// literal "Bearer null", so it authenticates through getHeaders.
	if (lane.keyless) transport.getHeaders = async () => ({ 'content-type': 'application/json' });
	return [transport];
}

/**
 * Every transport that can serve a roster model on this deployment, in route
 * order. Empty when the id is not a roster model or no route is reachable.
 * @param {string} modelId
 */
export function rosterTransports(modelId) {
	const row = rosterModel(modelId);
	if (!row) return [];
	return row.routes.flatMap((route) => routeTransports(route, modelId));
}

/** Whether any route of a roster model is reachable on this deployment. */
export function rosterModelAvailable(modelId) {
	return rosterTransports(modelId).length > 0;
}

/**
 * Headers for one call on a transport: a keyless/token lane mints its own, a
 * keyed lane sends its bearer.
 * @param {object} transport
 */
export async function transportHeaders(transport) {
	const base = transport.getHeaders
		? await transport.getHeaders()
		: { 'content-type': 'application/json', authorization: `Bearer ${transport.key}` };
	return { ...base, ...(transport.extraHeaders || {}) };
}
