// GET /api/status: which keys are present and whether each service accepts
// its key, checked with the cheapest call each offers and cached, so the page
// can show the right setup or error state before the first message.
//   three.ws: tools/list on the MCP server (401 on a bad key)
//   xAI:      GET /v1/api-key (https://docs.x.ai/developers/rest-api-reference/inference/other)

import { listTools } from './mcp.mjs';
import { KEY_HELP, XAI_API_KEY_URL, missingKeys } from './config.mjs';
import { mapXaiError, toAppError, xaiUnreachable } from './errors.mjs';

const OK_TTL_MS = 10 * 60_000;

// A rejected key stops every turn, so the page shows the error instead of the
// chat. An outage or a network blip may clear by the next message, so those
// only warn and the chat stays usable.
export const BLOCKING_CODES = Object.freeze(['xai_unauthorized', 'xai_bad_key', 'xai_forbidden', 'three_ws_bad_key']);
const FAIL_TTL_MS = 30_000;

async function checkThreeWs(config, fetchImpl) {
	await listTools({ url: config.mcpUrl, apiKey: config.threeWsApiKey, fetchImpl, signal: AbortSignal.timeout(10_000) });
	return { ok: true };
}

async function checkXai(config, fetchImpl) {
	let res;
	try {
		res = await fetchImpl(XAI_API_KEY_URL, { headers: { authorization: `Bearer ${config.xaiApiKey}` }, signal: AbortSignal.timeout(10_000) });
	} catch (err) {
		throw xaiUnreachable(err);
	}
	const text = await res.text().catch(() => '');
	if (!res.ok) throw mapXaiError(res.status, text, res.headers);
	let info = {};
	try {
		info = JSON.parse(text);
	} catch {
		info = {};
	}
	if (info.api_key_blocked || info.team_blocked || info.api_key_disabled) {
		throw mapXaiError(403, JSON.stringify({ error: info.team_blocked ? 'The team is blocked.' : 'The API key is blocked or disabled.' }), null);
	}
	return { ok: true };
}

export function createStatusChecker({ config, fetchImpl = fetch, now = Date.now }) {
	const cache = new Map();

	async function cached(name, run) {
		const hit = cache.get(name);
		if (hit && hit.expires > now()) return hit.value;
		let value;
		try {
			value = await run();
		} catch (err) {
			value = { ok: false, error: toAppError(err).toJSON() };
		}
		cache.set(name, { value, expires: now() + (value.ok ? OK_TTL_MS : FAIL_TTL_MS) });
		return value;
	}

	return {
		async status() {
			const missing = missingKeys(config);
			const missingNames = new Set(missing.map((m) => m.name));
			const [threeWs, xai] = await Promise.all([
				missingNames.has('THREE_WS_API_KEY') ? null : cached('three_ws', () => checkThreeWs(config, fetchImpl)),
				missingNames.has('XAI_API_KEY') ? null : cached('xai', () => checkXai(config, fetchImpl)),
			]);
			const problems = [xai, threeWs].filter((check) => check && !check.ok).map((check) => check.error);
			const problem = problems.find((p) => BLOCKING_CODES.includes(p.code)) || null;
			const warning = problem ? null : problems[0] || null;
			return {
				ready: missing.length === 0 && !problem,
				model: config.model,
				missing,
				checks: { xai, threeWs },
				problem,
				warning,
				keyHelp: KEY_HELP,
			};
		},
		forget() {
			cache.clear();
		},
	};
}
