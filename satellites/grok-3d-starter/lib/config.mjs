// Every setting the starter reads, in one place. Values come from the
// environment (and from .env, loaded by server.mjs before this runs).

// The current Grok flagship, copied from three.ws's model catalog
// (GROK_MODELS in api/_lib/chat-models.js) on 2026-11-20. To use another
// model, set XAI_MODEL; the live list is at https://docs.x.ai/developers/models.
export const DEFAULT_MODEL = 'grok-4.7';

export const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
export const XAI_API_KEY_URL = 'https://api.x.ai/v1/api-key';
export const DEFAULT_MCP_URL = 'https://three.ws/api/mcp-grok';
export const SERVER_LABEL = 'three-ws';

// Search, generate, refine and job status. Nothing else on the server is
// reachable by the model, so it cannot call a tool by surprise.
export const ALLOWED_TOOLS = Object.freeze(['search_catalog', 'forge_free', 'refine_model', 'check_job', 'get_job']);

export const KEY_HELP = Object.freeze({
	XAI_API_KEY: {
		label: 'xAI API key',
		url: 'https://console.x.ai/team/default/api-keys',
		example: 'XAI_API_KEY=xai-...',
		why: 'Grok runs the conversation and decides which three.ws tool to call.',
	},
	THREE_WS_API_KEY: {
		label: 'three.ws API key',
		url: 'https://three.ws/dashboard/api-keys',
		example: 'THREE_WS_API_KEY=sk_live_...',
		why: 'Making a model needs a three.ws account. A free account is enough.',
	},
});

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

// A key as pasted: surrounding space and a leading "Bearer " are forgiven.
function keyFrom(value) {
	return String(value || '')
		.trim()
		.replace(/^Bearer\s+/i, '');
}

// Header values must be visible ASCII. A smart quote or a pasted space would
// make fetch throw before the request leaves, which reads like a network
// failure, so it is caught here and named instead.
function malformed(key) {
	return Boolean(key) && !/^[\x21-\x7e]+$/.test(key);
}

function intFrom(value, fallback, { min, max }) {
	const n = Number.parseInt(value ?? '', 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

export function loadConfig(env = process.env) {
	const effort = String(env.XAI_REASONING_EFFORT || 'low').toLowerCase();
	return Object.freeze({
		xaiApiKey: keyFrom(env.XAI_API_KEY),
		threeWsApiKey: keyFrom(env.THREE_WS_API_KEY),
		trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
		model: (env.XAI_MODEL || DEFAULT_MODEL).trim(),
		reasoningEffort: EFFORTS.has(effort) ? effort : 'low',
		mcpUrl: (env.THREE_WS_MCP_URL || DEFAULT_MCP_URL).trim(),
		xaiUrl: (env.XAI_RESPONSES_URL || XAI_RESPONSES_URL).trim(),
		port: intFrom(env.PORT, 8080, { min: 1, max: 65535 }),
		host: env.HOST || '0.0.0.0',
		rateLimitPerMinute: intFrom(env.RATE_LIMIT_PER_MINUTE, 8, { min: 1, max: 600 }),
		maxRenderWaitSeconds: intFrom(env.MAX_RENDER_WAIT_SECONDS, 900, { min: 30, max: 3600 }),
	});
}

/**
 * Which keys are missing or unusable, with where to create each one.
 * `problem` is 'missing' or 'malformed'.
 */
export function missingKeys(config) {
	const missing = [];
	for (const [name, key] of [
		['XAI_API_KEY', config.xaiApiKey],
		['THREE_WS_API_KEY', config.threeWsApiKey],
	]) {
		if (!key) missing.push({ name, problem: 'missing', ...KEY_HELP[name] });
		else if (malformed(key)) missing.push({ name, problem: 'malformed', ...KEY_HELP[name] });
	}
	return missing;
}
