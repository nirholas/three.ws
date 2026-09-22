// agent.json: every setting the local agent reads, with defaults that work on
// a fresh machine. The file only holds what the person changed; `loadConfig`
// deep-merges it over the defaults, then applies environment overrides so a
// container or a CI job can configure the agent without writing a file.

import fs from 'node:fs';
import path from 'node:path';
import { configPath, systemEnv } from './paths.js';

export const DEFAULT_ORIGIN = 'https://three.ws';
export const THREE_WS_MODEL = 'three-ws/agent';

/** Approval modes per tool class. `financial` is pinned to `ask`: see enforceApprovalFloor. */
export const APPROVAL_MODES = Object.freeze(['ask', 'allow', 'deny']);
export const TOOL_CLASSES = Object.freeze(['read', 'write', 'shell', 'network', 'financial']);

export const DEFAULTS = Object.freeze({
	version: 1,
	origin: DEFAULT_ORIGIN,
	// provider `three-ws`: the metered OpenAI-compatible endpoint at <origin>/api/v1,
	// billed to the account's credits. provider `openai`: any OpenAI-compatible
	// base URL (a local llama.cpp or Ollama server, a hosted lane) with its own key.
	model: { provider: 'three-ws', baseUrl: null, apiKey: null, apiKeyEnv: null, model: THREE_WS_MODEL, maxTokens: 4096, temperature: 0.3 },
	agentId: null,
	mcp: { servers: ['/api/mcp-agent', '/api/mcp'], maxTools: 24 },
	approvals: { read: 'allow', write: 'ask', shell: 'ask', network: 'allow', financial: 'ask' },
	sandbox: { timeoutMs: 120_000, cpuSeconds: 60, maxOutputBytes: 200_000, maxFileMb: 256, passEnv: [] },
	webFetch: { allowPrivate: false, maxChars: 40_000 },
	budget: { maxToolRounds: 12, maxSteps: 40 },
	subagent: { maxToolRounds: 8, maxSteps: 24, maxConcurrent: 4 },
	avatar: { enabled: false, source: null, mode: 'blocks' },
	cron: { defaultMode: 'local', catchUp: true },
	gateway: { telegram: { token: null, tokenEnv: 'TELEGRAM_BOT_TOKEN' } },
});

function isPlainObject(v) {
	return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
	if (!isPlainObject(over)) return base;
	const out = { ...base };
	for (const [k, v] of Object.entries(over)) {
		out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
	}
	return out;
}

/**
 * Financial tools can never run without a person saying yes: a config file
 * that sets them to `allow` is read as `ask`. `deny` is honored.
 */
export function enforceApprovalFloor(approvals) {
	const out = { ...approvals };
	for (const cls of TOOL_CLASSES) {
		if (!APPROVAL_MODES.includes(out[cls])) out[cls] = DEFAULTS.approvals[cls];
	}
	if (out.financial === 'allow') out.financial = 'ask';
	return out;
}

function applyEnv(cfg, vars) {
	const next = deepMerge(cfg, {});
	if (vars.THREE_WS_ORIGIN) next.origin = String(vars.THREE_WS_ORIGIN);
	if (vars.THREE_WS_AGENT_ID) next.agentId = vars.THREE_WS_AGENT_ID;
	if (vars.THREE_WS_AGENT_BASE_URL) {
		next.model = { ...next.model, provider: 'openai', baseUrl: vars.THREE_WS_AGENT_BASE_URL };
		if (next.model.model === THREE_WS_MODEL) next.model.model = null;
	}
	if (vars.THREE_WS_AGENT_MODEL) next.model = { ...next.model, model: vars.THREE_WS_AGENT_MODEL };
	return next;
}

/** Raw file contents (what the person set), `{}` when there is no file yet. */
export function readConfigFile(env = systemEnv()) {
	const file = configPath(env);
	let raw;
	try {
		raw = fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return {};
		throw err;
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new Error(`${file} is not valid JSON (${err.message}). Fix it or delete it to start from defaults.`);
	}
}

export function loadConfig(env = systemEnv()) {
	const merged = applyEnv(deepMerge(DEFAULTS, readConfigFile(env)), env.vars);
	merged.origin = String(merged.origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
	merged.approvals = enforceApprovalFloor(merged.approvals);
	return merged;
}

/** Merge `patch` into the file (not the env-derived view) and write it back atomically. */
export function saveConfig(patch, env = systemEnv()) {
	const file = configPath(env);
	const next = deepMerge(readConfigFile(env), patch);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	return loadConfig(env);
}
