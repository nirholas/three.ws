/**
 * The unified MCP registry (api/_mcpall/registry.js) mounts every tool of every
 * hosted server once. These tests pin the rules that keep that safe: names are
 * group-namespaced, a collision is a boot failure unless declared, a tool with
 * no policy row is refused, and the real registry builds clean.
 */
import { describe, it, expect } from 'vitest';
import { POLICY } from '@three-ws/mcp-policy';
import { buildRegistry, bootProblems, unifiedName, makeRenamer, renameResult, summarize, SHADOWED, TOOL_NAME_RE } from '../api/_mcpall/registry.js';
import { SOURCES } from '../api/_mcpall/sources.js';

const def = (name) => ({ name, description: `does ${name}`, inputSchema: { type: 'object', properties: {} } });
const src = (id, names, extra = {}) => ({
	id,
	policyServer: id,
	title: id,
	endpoint: `/api/${id}`,
	tools: () => names.map((n) => ({ def: def(n), scope: null, impl: extra.impl?.[n] || {}, run: async () => ({ content: [] }) })),
	isPublic: () => false,
	x402Amount: () => null,
	...extra.source,
});
const policyOf = (rows) => rows;

describe('unifiedName', () => {
	it('prefixes the group unless the name already leads with it', () => {
		expect(unifiedName('assets', 'inspect_model')).toBe('assets_inspect_model');
		expect(unifiedName('wallet', 'wallet_status')).toBe('wallet_status');
		expect(unifiedName('x402', 'x402')).toBe('x402');
	});
});

describe('buildRegistry (synthetic sources)', () => {
	it('mounts a tool under its group-namespaced name and keeps the legacy name as an alias', () => {
		const r = buildRegistry({
			sources: [src('a', ['inspect'])],
			policy: policyOf({ a: { inspect: { group: 'assets', tier: 'read' } } }),
			shadowed: [],
		});
		expect(r.problems).toEqual([]);
		expect(r.byName.has('assets_inspect')).toBe(true);
		expect(r.aliases.get('inspect')).toEqual(['assets_inspect']);
	});

	it('fails the boot on two servers defining the same unified name with separate handlers', () => {
		const rows = { group: 'assets', tier: 'read' };
		const r = buildRegistry({
			sources: [src('a', ['inspect']), src('b', ['inspect'])],
			policy: policyOf({ a: { inspect: rows }, b: { inspect: rows } }),
			shadowed: [],
		});
		const fatal = bootProblems(r.problems);
		expect(fatal).toHaveLength(1);
		expect(fatal[0].kind).toBe('collision');
		expect(fatal[0].message).toContain('assets_inspect');
	});

	it('treats a shared handler module as one tool', () => {
		const impl = { inspect: () => {} };
		const rows = { group: 'assets', tier: 'read' };
		const r = buildRegistry({
			sources: [src('a', ['inspect'], { impl }), src('b', ['inspect'], { impl })],
			policy: policyOf({ a: { inspect: rows }, b: { inspect: rows } }),
			shadowed: [],
		});
		expect(r.problems).toEqual([]);
		expect(r.tools).toHaveLength(1);
		expect(r.tools[0].alsoOn).toEqual(['b']);
	});

	it('lets a declared SHADOWED pair through and flags a stale declaration', () => {
		const rows = { group: 'assets', tier: 'read' };
		const sources = [src('a', ['inspect']), src('b', ['inspect'])];
		const policy = policyOf({ a: { inspect: rows }, b: { inspect: rows } });
		const declared = buildRegistry({ sources, policy, shadowed: [{ source: 'a', by: 'b', tools: ['inspect'], reason: 'test' }] });
		expect(bootProblems(declared.problems)).toEqual([]);
		expect(declared.byName.get('assets_inspect').source).toBe('b');

		const stale = buildRegistry({
			sources: [src('a', ['inspect'])],
			policy: policyOf({ a: { inspect: rows } }),
			shadowed: [{ source: 'a', by: 'b', tools: ['inspect'], reason: 'test' }],
		});
		expect(stale.problems.map((p) => p.kind)).toContain('stale_shadow');
	});

	it('reports a tool with no policy row instead of mounting it', () => {
		const r = buildRegistry({ sources: [src('a', ['mystery'])], policy: policyOf({ a: {} }), shadowed: [] });
		expect(r.problems.map((p) => p.kind)).toEqual(['missing_policy']);
		expect(r.tools).toHaveLength(0);
	});

	it('rejects a name MCP clients refuse', () => {
		const r = buildRegistry({
			sources: [src('a', ['bad.name'])],
			policy: policyOf({ a: { 'bad.name': { group: 'assets', tier: 'read' } } }),
			shadowed: [],
		});
		expect(bootProblems(r.problems).map((p) => p.kind)).toEqual(['invalid_name']);
	});

	it('does not offer an ambiguous legacy name as a single alias', () => {
		const r = buildRegistry({
			sources: [src('a', ['status']), src('b', ['status'])],
			policy: policyOf({ a: { status: { group: 'wallet', tier: 'read' } }, b: { status: { group: 'agents', tier: 'read' } } }),
			shadowed: [],
		});
		expect(r.aliases.get('status')).toHaveLength(2);
	});
});

describe('renamer', () => {
	it('rewrites legacy names with an underscore and leaves plain words alone', () => {
		const rename = makeRenamer(new Map([['inspect_model', 'assets_inspect_model'], ['remember', 'memory_remember']]));
		expect(rename('call inspect_model then remember it')).toBe('call assets_inspect_model then remember it');
		expect(rename('my_inspect_model stays')).toBe('my_inspect_model stays');
	});

	it('renames text blocks of a tool result only', () => {
		const rename = makeRenamer(new Map([['inspect_model', 'assets_inspect_model']]));
		const out = renameResult({ content: [{ type: 'text', text: 'use inspect_model' }, { type: 'image', data: 'inspect_model' }] }, rename);
		expect(out.content[0].text).toBe('use assets_inspect_model');
		expect(out.content[1].data).toBe('inspect_model');
	});
});

describe('the real registry', () => {
	const registry = buildRegistry();

	it('builds with no fatal problems and no missing policy rows', () => {
		expect(registry.problems).toEqual([]);
	});

	it('gives every tool a valid name, a known group and a tier', () => {
		const groups = new Set(Object.values(POLICY).flatMap((rows) => Object.values(rows).map((r) => r.group)));
		for (const t of registry.tools) {
			expect(TOOL_NAME_RE.test(t.name), t.name).toBe(true);
			expect(groups.has(t.group), `${t.name} group ${t.group}`).toBe(true);
			expect(['read', 'write', 'financial']).toContain(t.tier);
		}
		expect(new Set(registry.tools.map((t) => t.name)).size).toBe(registry.tools.length);
	});

	it('mounts every source tool: no source is silently dropped', () => {
		const unified = new Set(registry.tools.flatMap((t) => [t.source, ...t.alsoOn]));
		for (const s of SOURCES) expect(unified.has(s.id), s.id).toBe(true);
	});

	it('only declares shadows that still exist', () => {
		expect(SHADOWED.length).toBeGreaterThan(0);
		expect(registry.problems.some((p) => p.kind === 'stale_shadow')).toBe(false);
	});

	it('summarizes counts that add up', () => {
		const s = summarize(registry);
		expect(s.tool_count).toBe(registry.tools.length);
		expect(s.tiers.read + s.tiers.write + s.tiers.financial).toBe(s.tool_count);
		expect(s.default_tool_count).toBe(s.tiers.read + s.tiers.write);
		expect(s.groups.reduce((n, g) => n + g.tools, 0)).toBe(s.tool_count);
		expect(s.sources.reduce((n, x) => n + x.tools, 0)).toBe(s.tool_count - registry.tools.filter((t) => t.source === 'unified').length);
	});
});
