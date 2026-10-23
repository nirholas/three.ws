// data/agent-templates.json is what the /create-agent template gallery renders
// and what a click prefills into the wizard. These checks keep it honest: every
// template fits the wizard's own field limits, names only MCP tools that are
// registered, states a Solana scope, and carries no address or third-party
// project name (the gallery is product copy, not an endorsement list).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const { templates, version } = JSON.parse(read('data/agent-templates.json'));

// Registered MCP tool names, parsed statically from the tool modules so the
// check does not need the whole API dependency graph (three, ajv, db) to load.
const MCP_TOOLS = new Set();
const toolsDir = join(ROOT, 'api/_mcp/tools');
for (const file of readdirSync(toolsDir).filter((f) => f.endsWith('.js'))) {
	for (const m of read(`api/_mcp/tools/${file}`).matchAll(/^\t\tname: '([a-z][a-z0-9_]*)',/gm)) {
		MCP_TOOLS.add(m[1]);
	}
}

const wizardSrc = read('src/create-agent.js');
const OPTIONAL_SKILL_IDS = new Set(
	[...wizardSrc.match(/const OPTIONAL_SKILLS = \[([\s\S]*?)\n\];/)[1].matchAll(/id: '([^']+)'/g)].map(
		(m) => m[1],
	),
);

const BASE58_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const EVM_ADDRESS = /\b0x[0-9a-fA-F]{40}\b/;
const FOREIGN_TERMS =
	/\b(sperax|usds|vespa|ethereum|erc-?20|gwei|solidity|flashbots|uniswap|aave|compound|lido|arbitrum|optimism|polygon|bitcoin)\b/i;

function strings(value) {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('agent template catalog', () => {
	it('loads with a version and a gallery-sized set of templates', () => {
		expect(version).toBe(1);
		expect(templates.length).toBeGreaterThanOrEqual(20);
	});

	it('has unique kebab-case ids and unique names', () => {
		const ids = templates.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		const names = templates.map((t) => t.name.toLowerCase());
		expect(new Set(names).size).toBe(names.length);
	});

	it('discovers the registered MCP tool names it validates against', () => {
		for (const known of ['crypto_data', 'token_snapshot', 'pumpfun_token_intel', 'sentiment_scout']) {
			expect(MCP_TOOLS.has(known)).toBe(true);
		}
		expect(OPTIONAL_SKILL_IDS.has('pump-fun')).toBe(true);
	});

	describe.each(templates.map((t) => [t.id, t]))('%s', (_id, t) => {
		it('has every field the gallery renders, within the wizard limits', () => {
			expect(Object.keys(t).sort()).toEqual(
				[
					'category',
					'greeting',
					'id',
					'name',
					'persona',
					'prompts',
					'scope',
					'skills',
					'tagline',
					'tags',
					'tools',
				].sort(),
			);
			expect(t.name.length).toBeGreaterThan(0);
			expect(t.name.length).toBeLessThanOrEqual(60);
			expect(t.tagline.length).toBeGreaterThan(0);
			expect(t.tagline.length).toBeLessThanOrEqual(120);
			expect(t.persona.length).toBeGreaterThan(300);
			expect(t.persona.length).toBeLessThanOrEqual(2000);
			expect(t.greeting.length).toBeGreaterThan(0);
			expect(t.greeting.length).toBeLessThanOrEqual(200);
			expect(t.tags.length).toBeGreaterThan(0);
			expect(t.tags.length).toBeLessThanOrEqual(8);
			expect(t.prompts.length).toBeGreaterThanOrEqual(3);
			expect(t.prompts.length).toBeLessThanOrEqual(4);
			for (const p of t.prompts) expect(p.length).toBeLessThanOrEqual(200);
		});

		it('is filed under the finance category', () => {
			expect(t.category).toBe('finance');
		});

		it('names only registered MCP tools and known wizard skills', () => {
			for (const tool of t.tools) expect(MCP_TOOLS.has(tool), `unknown tool ${tool}`).toBe(true);
			expect(new Set(t.tools).size).toBe(t.tools.length);
			for (const skill of t.skills) {
				expect(OPTIONAL_SKILL_IDS.has(skill), `unknown skill ${skill}`).toBe(true);
			}
		});

		it('states its Solana scope', () => {
			expect(t.scope).toMatch(/solana/i);
			expect(t.persona).toMatch(/solana/i);
			expect(t.persona).toMatch(/scope:/i);
		});

		it('tells the model to use each listed tool by name', () => {
			for (const tool of t.tools) {
				expect(t.persona, `persona never mentions ${tool}`).toContain(tool);
			}
		});

		it('contains no wallet address, third-party project name, dash glyph or emoji', () => {
			for (const s of strings(t)) {
				expect(s).not.toMatch(BASE58_ADDRESS);
				expect(s).not.toMatch(EVM_ADDRESS);
				expect(s).not.toMatch(FOREIGN_TERMS);
				expect(s).not.toMatch(/[\u2013\u2014]/);
				expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
			}
		});
	});
});

describe('finance category wiring', () => {
	const listIn = (src) => src.match(/const CATEGORIES = \[([\s\S]*?)\];/)[1];

	it('is offered by the wizard, the marketplace API and the spec generator', () => {
		expect(listIn(wizardSrc)).toContain("'finance'");
		expect(listIn(read('api/marketplace/[action].js'))).toContain("'finance'");
		expect(listIn(read('api/agents/suggest-spec.js'))).toContain("'finance'");
	});

	it('is a selectable option wherever a category is picked', () => {
		for (const page of ['pages/marketplace.html', 'pages/agent-edit.html']) {
			expect(read(page)).toMatch(/<option value="finance"/);
		}
	});
});
