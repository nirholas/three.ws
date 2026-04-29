// Skill runtime — server-side dispatcher for in-process skill invocation.
//
// Skills under examples/skills/<name>/handlers.js export tool functions.
// This module gives them the `ctx` they expect:
//   ctx.skills.invoke('skill.tool', args)  → call sibling skill
//   ctx.skillConfig                        → manifest.config merged with overrides
//   ctx.memory.note(tag, value)            → no-op stub (DB persistence is opt-in)
//   ctx.fetch                              → globalThis.fetch (overridable in tests)
//   ctx.wallet                             → injected by callers that need signing
//
// Cold-start friendly: skill modules are imported lazily on first use.

const SKILL_MAP = {
	'pump-fun': '../../examples/skills/pump-fun/handlers.js',
	'pump-fun-trade': '../../examples/skills/pump-fun-trade/handlers.js',
	'pump-fun-compose': '../../examples/skills/pump-fun-compose/handlers.js',
	'pump-fun-strategy': '../../examples/skills/pump-fun-strategy/handlers.js',
	'solana-wallet': '../../examples/skills/solana-wallet/handlers.js',
};

const MANIFEST_MAP = {
	'pump-fun': '../../examples/skills/pump-fun/manifest.json',
	'pump-fun-trade': '../../examples/skills/pump-fun-trade/manifest.json',
	'pump-fun-compose': '../../examples/skills/pump-fun-compose/manifest.json',
	'pump-fun-strategy': '../../examples/skills/pump-fun-strategy/manifest.json',
	'solana-wallet': '../../examples/skills/solana-wallet/manifest.json',
};

const _modCache = new Map();
const _cfgCache = new Map();

async function loadSkill(name) {
	if (_modCache.has(name)) return _modCache.get(name);
	const path = SKILL_MAP[name];
	if (!path) throw new Error(`unknown skill: ${name}`);
	const mod = await import(path);
	_modCache.set(name, mod);
	return mod;
}

async function loadManifest(name) {
	if (_cfgCache.has(name)) return _cfgCache.get(name);
	const path = MANIFEST_MAP[name];
	if (!path) return {};
	try {
		const mod = await import(path, { with: { type: 'json' } });
		_cfgCache.set(name, mod.default ?? mod);
		return mod.default ?? mod;
	} catch {
		_cfgCache.set(name, {});
		return {};
	}
}

/**
 * Build a context for invoking skills from a serverless endpoint.
 *
 * @param {object} opts
 * @param {object} [opts.configOverrides] - per-skill config overrides keyed by skill name
 * @param {object} [opts.wallet] - solana wallet contract for signing skills
 * @param {(event: object) => void} [opts.onEvent] - notified on every memory.note call
 * @param {object} [opts.fetch] - fetch impl (defaults to globalThis.fetch)
 */
export function makeRuntime(opts = {}) {
	const { configOverrides = {}, wallet, onEvent, fetch = globalThis.fetch } = opts;

	async function invoke(qualified, args) {
		const [skillName, toolName] = qualified.split('.');
		if (!skillName || !toolName) throw new Error(`bad tool: ${qualified}`);
		const mod = await loadSkill(skillName);
		const fn = mod[toolName];
		if (typeof fn !== 'function') {
			return { ok: false, error: `tool not found: ${qualified}` };
		}
		const manifest = await loadManifest(skillName);
		const skillConfig = { ...(manifest.config ?? {}), ...(configOverrides[skillName] ?? {}) };
		const ctx = {
			skills: { invoke },
			skillConfig,
			wallet,
			fetch,
			memory: {
				note: (tag, value) => {
					try {
						onEvent?.({ skill: skillName, tool: toolName, tag, value, t: Date.now() });
					} catch {}
				},
				recall: async () => null,
			},
		};
		try {
			return await fn(args ?? {}, ctx);
		} catch (e) {
			return { ok: false, error: e?.message ?? String(e) };
		}
	}

	return { invoke };
}
