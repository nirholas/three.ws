import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pumpfun side-effect modules before AgentSkills is imported
vi.mock('../../src/agent-skills-pumpfun.js', () => ({ registerPumpFunSkills: vi.fn() }));
vi.mock('../../src/agent-skills-pumpfun-watch.js', () => ({ registerPumpFunWatchSkills: vi.fn() }));
vi.mock('../../src/agent-skills-pumpfun-autonomous.js', () => ({
	registerPumpFunAutonomousSkills: vi.fn(),
}));
vi.mock('../../src/agent-skills-pumpfun-compose.js', () => ({
	registerPumpFunComposeSkills: vi.fn(),
}));
vi.mock('../../src/agent-skills-pumpfun-hooks.js', () => ({ attachPumpFunMemoryHooks: vi.fn() }));

// Mock sandbox host so worker code doesn't run in Node
vi.mock('../../src/skills/sandbox-host.js', () => ({
	getHost: vi.fn(() => ({ invoke: vi.fn() })),
}));

import { AgentSkills } from '../../src/agent-skills.js';
import { AgentProtocol, ACTION_TYPES } from '../../src/agent-protocol.js';
import { SkillRegistry } from '../../src/skills/index.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeResponse(data, { ok = true, status = 200, asText = false } = {}) {
	return {
		ok,
		status,
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(asText ? data : JSON.stringify(data)),
	};
}

/**
 * Build a fetch stub that returns responses keyed by URL suffix.
 * Keys are matched via String.includes(); the first match wins.
 */
function makeFetch(routes = {}) {
	return vi.fn(async (url) => {
		const str = url.toString();
		for (const [pattern, response] of Object.entries(routes)) {
			if (str.includes(pattern)) return response;
		}
		return makeResponse(null, { ok: false, status: 404 });
	});
}

function fixtureManifest(overrides = {}) {
	return {
		name: 'test-skill',
		version: '1.0.0',
		description: 'A test skill',
		author: '0xowner',
		sandboxPolicy: 'sandboxed',
		...overrides,
	};
}

function fixtureRoutes(manifest = fixtureManifest(), { instructions = '', tools = [] } = {}) {
	return {
		'manifest.json': makeResponse(manifest),
		'SKILL.md': makeResponse(instructions, { asText: true }),
		'tools.json': makeResponse({ tools }),
		'handlers.js': makeResponse('export default {}', { asText: true }),
	};
}

// ── SkillRegistry – Installation & trust ─────────────────────────────────────

describe('SkillRegistry.install – trust modes', () => {
	it('any trust accepts a skill with any author', async () => {
		const manifest = fixtureManifest({ author: '0xstranger' });
		const registry = new SkillRegistry({
			fetchFn: makeFetch(fixtureRoutes(manifest)),
			trust: 'any',
		});
		const skill = await registry.install({ uri: 'https://example.com/skill/' });
		expect(skill.name).toBe('test-skill');
	});

	it('owned-only rejects a skill whose author does not match ownerAddress', async () => {
		const manifest = fixtureManifest({ author: '0xstranger' });
		const registry = new SkillRegistry({
			fetchFn: makeFetch(fixtureRoutes(manifest)),
			trust: 'owned-only',
			ownerAddress: '0xowner',
		});
		await expect(registry.install({ uri: 'https://example.com/skill/' })).rejects.toThrow(
			/not trusted under owned-only/,
		);
	});

	it('owned-only accepts a skill whose author matches ownerAddress (case-insensitive)', async () => {
		const manifest = fixtureManifest({ author: '0xOwner' });
		const registry = new SkillRegistry({
			fetchFn: makeFetch(fixtureRoutes(manifest)),
			trust: 'owned-only',
			ownerAddress: '0xowner',
		});
		const skill = await registry.install({ uri: 'https://example.com/skill/' });
		expect(skill.name).toBe('test-skill');
	});

	it('owned-only allows any skill when ownerAddress is not set', async () => {
		const manifest = fixtureManifest({ author: '0xanyone' });
		const registry = new SkillRegistry({
			fetchFn: makeFetch(fixtureRoutes(manifest)),
			trust: 'owned-only',
		});
		const skill = await registry.install({ uri: 'https://example.com/skill/' });
		expect(skill.name).toBe('test-skill');
	});

	it('whitelist mode is a no-op and does not reject skills (enforcement is a hook)', async () => {
		const registry = new SkillRegistry({
			fetchFn: makeFetch(fixtureRoutes()),
			trust: 'whitelist',
		});
		// No whitelist config → currently installs without error
		const skill = await registry.install({ uri: 'https://example.com/skill/' });
		expect(skill.name).toBe('test-skill');
	});
});

describe('SkillRegistry.install – dependency loading', () => {
	it('recursively installs each dependency URI listed in manifest.dependencies', async () => {
		const depManifest = fixtureManifest({ name: 'dep-skill', dependencies: undefined });
		const rootManifest = fixtureManifest({
			dependencies: { 'https://cdn.example.com/dep/': '1.0.0' },
		});

		const fetchFn = makeFetch({
			// root skill
			'example.com/skill/manifest.json': makeResponse(rootManifest),
			'example.com/skill/SKILL.md': makeResponse('', { asText: true }),
			'example.com/skill/tools.json': makeResponse({ tools: [] }),
			'example.com/skill/handlers.js': makeResponse('', { asText: true }),
			// dependency
			'cdn.example.com/dep/manifest.json': makeResponse(depManifest),
			'cdn.example.com/dep/SKILL.md': makeResponse('', { asText: true }),
			'cdn.example.com/dep/tools.json': makeResponse({ tools: [] }),
			'cdn.example.com/dep/handlers.js': makeResponse('', { asText: true }),
		});

		const registry = new SkillRegistry({ fetchFn, trust: 'any' });
		await registry.install({ uri: 'https://example.com/skill/' });

		const names = registry.all().map((s) => s.name);
		expect(names).toContain('dep-skill');
	});

	it('installing the same URI twice returns the cached skill and does not duplicate', async () => {
		const fetchFn = makeFetch(fixtureRoutes());
		const registry = new SkillRegistry({ fetchFn, trust: 'any' });

		await registry.install({ uri: 'https://example.com/skill/' });
		await registry.install({ uri: 'https://example.com/skill/' });

		expect(registry.all()).toHaveLength(1);
		// fetchFn called only for the first install (3 files; handlers.js is a 4th)
		expect(fetchFn).toHaveBeenCalledTimes(4);
	});
});

// ── SkillRegistry – Skill lookup ──────────────────────────────────────────────

describe('SkillRegistry – skill lookup', () => {
	let registry;
	beforeEach(async () => {
		registry = new SkillRegistry({ fetchFn: makeFetch(fixtureRoutes()), trust: 'any' });
		await registry.install({ uri: 'https://example.com/skill/' });
	});

	it('installed skill is discoverable via all()', () => {
		const found = registry.all().find((s) => s.name === 'test-skill');
		expect(found).toBeDefined();
		expect(found.name).toBe('test-skill');
	});

	it('uninstalled skill name returns undefined from all().find()', () => {
		const found = registry.all().find((s) => s.name === 'nonexistent');
		expect(found).toBeUndefined();
	});

	it('findSkillForTool returns null for an unknown tool', () => {
		expect(registry.findSkillForTool('ghost-tool')).toBeNull();
	});

	it('findSkillForTool returns the skill that owns a registered tool', async () => {
		const tools = [{ name: 'do-thing', description: 'does thing' }];
		const reg2 = new SkillRegistry({
			fetchFn: makeFetch(fixtureRoutes(fixtureManifest({ name: 'tool-skill' }), { tools })),
			trust: 'any',
		});
		await reg2.install({ uri: 'https://cdn.example.com/tool-skill/' });
		const skill = reg2.findSkillForTool('do-thing');
		expect(skill).not.toBeNull();
		expect(skill.name).toBe('tool-skill');
	});
});

// ── SkillRegistry – Manifest loading ─────────────────────────────────────────

describe('SkillRegistry – manifest loading', () => {
	it('loads a skill from an https:// URL, normalizing the trailing slash', async () => {
		const fetchFn = makeFetch(fixtureRoutes());
		const registry = new SkillRegistry({ fetchFn, trust: 'any' });
		// No trailing slash — should be added automatically
		const skill = await registry.install({ uri: 'https://example.com/skill' });
		expect(skill).toBeDefined();
		expect(skill.uri).toBe('https://example.com/skill/');
	});

	it('resolves an ipfs:// URI to a dweb.link gateway URL before fetching', async () => {
		// ipfs://QmTest → https://dweb.link/ipfs/QmTest/
		const fetchFn = makeFetch({
			'dweb.link/ipfs/QmTest/manifest.json': makeResponse(fixtureManifest()),
			'dweb.link/ipfs/QmTest/SKILL.md': makeResponse('', { asText: true }),
			'dweb.link/ipfs/QmTest/tools.json': makeResponse({ tools: [] }),
			'dweb.link/ipfs/QmTest/handlers.js': makeResponse('', { asText: true }),
		});
		const registry = new SkillRegistry({ fetchFn, trust: 'any' });
		const skill = await registry.install({ uri: 'ipfs://QmTest' });
		expect(skill).toBeDefined();
		expect(skill.uri).toContain('dweb.link/ipfs/QmTest');
	});
});

// ── AgentSkills – Execution lifecycle ────────────────────────────────────────

describe('AgentSkills.perform – execution lifecycle', () => {
	let protocol, memory, skills;

	beforeEach(() => {
		protocol = new AgentProtocol();
		memory = { add: vi.fn(() => 'mem-1'), query: vi.fn(() => []) };
		skills = new AgentSkills(protocol, memory);
		// Register a minimal custom skill for execution tests
		skills.register({
			name: 'echo',
			description: 'echoes args',
			handler: vi.fn(async (args) => ({ success: true, output: args.text ?? 'ok' })),
		});
	});

	it('invokes the handler with (args, ctx)', async () => {
		const handler = skills.get('echo').handler;
		await skills.perform('echo', { text: 'hello' });
		expect(handler).toHaveBeenCalledOnce();
		const [args, ctx] = handler.mock.calls[0];
		expect(args).toEqual({ text: 'hello' });
		expect(ctx).toHaveProperty('protocol', protocol);
		expect(ctx).toHaveProperty('memory', memory);
	});

	it('emits PERFORM_SKILL before the handler runs', async () => {
		const events = [];
		protocol.on(ACTION_TYPES.PERFORM_SKILL, (a) => events.push(a));
		const handler = skills.get('echo').handler;
		handler.mockImplementation(async () => {
			expect(events).toHaveLength(1); // already emitted
			return { success: true, output: 'ok' };
		});
		await skills.perform('echo', {});
		expect(events[0].payload.skill).toBe('echo');
	});

	it('emits SKILL_DONE with the result on success', async () => {
		const done = vi.fn();
		protocol.on(ACTION_TYPES.SKILL_DONE, done);
		await skills.perform('echo', { text: 'hi' });
		expect(done).toHaveBeenCalledOnce();
		expect(done.mock.calls[0][0].payload).toMatchObject({
			skill: 'echo',
			result: { success: true, output: 'hi' },
		});
	});

	it('emits SKILL_ERROR and returns a failure result when the handler throws', async () => {
		skills.register({
			name: 'bad-skill',
			description: 'always throws',
			handler: async () => {
				throw new Error('something went wrong');
			},
		});
		const errEvents = vi.fn();
		protocol.on(ACTION_TYPES.SKILL_ERROR, errEvents);

		const result = await skills.perform('bad-skill', {});

		expect(result.success).toBe(false);
		expect(result.output).toContain('something went wrong');
		expect(errEvents).toHaveBeenCalledOnce();
		expect(errEvents.mock.calls[0][0].payload).toMatchObject({
			skill: 'bad-skill',
			error: 'something went wrong',
		});
	});

	it('returns a failure result for an unknown skill without throwing', async () => {
		const result = await skills.perform('no-such-skill', {});
		expect(result.success).toBe(false);
		expect(result.output).toContain('no-such-skill');
	});

	it('auto-speaks the result output when isBrowser is true', async () => {
		const speaks = vi.fn();
		protocol.on(ACTION_TYPES.SPEAK, speaks);
		await skills.perform('echo', { text: 'greetings' }, { isBrowser: true });
		expect(speaks).toHaveBeenCalledOnce();
		expect(speaks.mock.calls[0][0].payload.text).toBe('greetings');
	});

	it('does not auto-speak when isBrowser is false', async () => {
		const speaks = vi.fn();
		protocol.on(ACTION_TYPES.SPEAK, speaks);
		await skills.perform('echo', { text: 'greetings' }, { isBrowser: false });
		expect(speaks).not.toHaveBeenCalled();
	});
});

// ── AgentSkills – Built-in skill: remember ────────────────────────────────────

describe('AgentSkills built-in – remember', () => {
	let protocol, memory, skills;

	beforeEach(() => {
		protocol = new AgentProtocol();
		memory = { add: vi.fn(() => 'mem-42'), query: vi.fn(() => []) };
		skills = new AgentSkills(protocol, memory);
	});

	it('emits REMEMBER on the protocol when isBrowser is true', async () => {
		const remembered = vi.fn();
		protocol.on(ACTION_TYPES.REMEMBER, remembered);
		await skills.perform('remember', { content: 'unit test ran' }, { isBrowser: true });
		expect(remembered).toHaveBeenCalledOnce();
		expect(remembered.mock.calls[0][0].payload.content).toBe('unit test ran');
	});

	it('does not emit REMEMBER when isBrowser is false', async () => {
		const remembered = vi.fn();
		protocol.on(ACTION_TYPES.REMEMBER, remembered);
		await skills.perform('remember', { content: 'silent' }, { isBrowser: false });
		expect(remembered).not.toHaveBeenCalled();
	});

	it('stores the memory entry via memory.add()', async () => {
		await skills.perform('remember', { content: 'important fact' }, { isBrowser: false });
		expect(memory.add).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'important fact' }),
		);
	});

	it('returns failure when content is missing', async () => {
		const result = await skills.perform('remember', {}, { isBrowser: false });
		expect(result.success).toBe(false);
	});
});

// ── AgentSkills – Registry API ────────────────────────────────────────────────

describe('AgentSkills – registry API', () => {
	let skills;

	beforeEach(() => {
		skills = new AgentSkills(new AgentProtocol(), {
			add: vi.fn(),
			query: vi.fn(() => []),
		});
	});

	it('get(name) returns the skill def for a registered skill', () => {
		const def = skills.get('greet');
		expect(def).toBeDefined();
		expect(def.name).toBe('greet');
		expect(typeof def.handler).toBe('function');
	});

	it('get(name) returns undefined for an unregistered skill', () => {
		expect(skills.get('not-here')).toBeUndefined();
	});

	it('list() includes all built-in skills', () => {
		const names = skills.list().map((s) => s.name);
		expect(names).toContain('greet');
		expect(names).toContain('remember');
		expect(names).toContain('help');
		expect(names).toContain('think');
	});

	it('unregister removes the skill from the registry', () => {
		skills.register({ name: 'temp', description: 'temp', handler: vi.fn() });
		expect(skills.get('temp')).toBeDefined();
		skills.unregister('temp');
		expect(skills.get('temp')).toBeUndefined();
	});

	it('toMcpTools() returns only mcpExposed skills', () => {
		const tools = skills.toMcpTools();
		// All returned tools should come from MCP-exposed skills
		const exposedNames = skills.list().filter((s) => s.mcpExposed).map((s) => s.name);
		expect(tools.length).toBe(exposedNames.length);
		// 'help' and 'think' are not MCP-exposed
		expect(tools.map((t) => t.name)).not.toContain('skill_help');
		expect(tools.map((t) => t.name)).not.toContain('skill_think');
	});
});
