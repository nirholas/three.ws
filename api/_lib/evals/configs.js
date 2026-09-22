// The agent configuration an eval scores: a preset, or a real agent.
//
// A configuration is everything about an agent that changes how it behaves on
// a task except the model: the system prompt, the tools it may call and the
// sampling temperature. Its version is a short content hash of exactly those
// fields, so the Evaluate tab can plot score history per configuration and a
// prompt edit shows up as a new version automatically, with no counter to keep.
//
// Presets:
//   default   the platform agent loop as /api/agent/run serves it: no persona,
//             every read-only server tool.
//   <id>      a strategy preset from data/agent-strategies.json: its persona,
//             its tool allowlist and its temperature.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_TOOLS } from '../agent-tools.js';

const STRATEGIES_PATH = fileURLToPath(new URL('../../../data/agent-strategies.json', import.meta.url));
const ALL_TOOLS = Object.keys(AGENT_TOOLS);

export const DEFAULT_PRESET = 'default';

function readStrategies() {
	try {
		const doc = JSON.parse(readFileSync(STRATEGIES_PATH, 'utf8'));
		return Array.isArray(doc?.strategies) ? doc.strategies : [];
	} catch (err) {
		if (err?.code === 'ENOENT') return [];
		throw err;
	}
}

/** Short content hash of the fields that define a configuration. */
export function configVersion({ systemPrompt, tools, temperature }) {
	const canonical = JSON.stringify({
		systemPrompt: systemPrompt || '',
		tools: [...(tools || [])].sort(),
		temperature: temperature ?? null,
	});
	return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function finish(config) {
	const tools = (config.tools || ALL_TOOLS).filter((t) => AGENT_TOOLS[t]);
	const out = { ...config, tools };
	out.version = configVersion(out);
	return out;
}

/** Every preset an eval can name, with a one-line summary. */
export function listPresets() {
	return [
		{ id: DEFAULT_PRESET, name: 'Platform default', summary: 'The general agent loop with no persona and every read-only server tool.' },
		...readStrategies().map((s) => ({ id: s.id, name: s.name, summary: s.summary })),
	];
}

/**
 * Resolve a preset id into a configuration.
 * @param {string} id
 * @param {{ temperature?: number }} [defaults]  suite defaults for fields the preset leaves open
 */
export function presetConfig(id, defaults = {}) {
	if (id === DEFAULT_PRESET) {
		return finish({ kind: 'preset', id, label: 'Platform default', systemPrompt: null, tools: ALL_TOOLS, temperature: defaults.temperature ?? 0.2, model: null });
	}
	const s = readStrategies().find((x) => x.id === id);
	if (!s) {
		const known = listPresets().map((p) => p.id).join(', ');
		const err = new Error(`No preset named "${id}". Presets: ${known}`);
		err.status = 404;
		err.code = 'unknown_preset';
		throw err;
	}
	return finish({
		kind: 'preset',
		id,
		label: s.name,
		systemPrompt: s.persona,
		tools: s.toolsAllowed,
		temperature: typeof s.temperature === 'number' ? s.temperature : defaults.temperature ?? 0.2,
		model: null,
	});
}

/**
 * Build the configuration of a real agent from its agent_identities row. The
 * system prompt is the agent's own persona prompt; an agent that only has a
 * description speaks as itself from that. Tools follow the agent's strategy
 * preset when it has one, else every read-only server tool.
 */
export function agentConfig(row, defaults = {}) {
	const runtime = row?.meta?.runtime || {};
	const strategy = runtime.strategy ? readStrategies().find((s) => s.id === runtime.strategy) : null;
	const systemPrompt = row.persona_prompt?.trim()
		? row.persona_prompt.trim()
		: row.description?.trim()
			? `You are ${row.name}. ${row.description.trim()}`
			: row.name
				? `You are ${row.name}.`
				: null;
	return finish({
		kind: 'agent',
		id: row.id,
		label: row.name || 'Agent',
		systemPrompt,
		tools: Array.isArray(runtime.toolsAllowed) && runtime.toolsAllowed.length ? runtime.toolsAllowed : strategy?.toolsAllowed || ALL_TOOLS,
		temperature: typeof runtime.temperature === 'number' ? runtime.temperature : defaults.temperature ?? 0.2,
		model: typeof runtime.model === 'string' ? runtime.model : null,
	});
}

/** The owner-safe snapshot of a configuration stored with every eval. */
export function configSnapshot(config) {
	return {
		kind: config.kind,
		id: config.id,
		label: config.label,
		version: config.version,
		systemPrompt: config.systemPrompt,
		tools: config.tools,
		temperature: config.temperature,
		model: config.model,
	};
}
