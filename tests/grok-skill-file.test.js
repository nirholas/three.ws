// public/grok-skill.md is the file a Grok user uploads to Grok's Skills, and that
// Grok Bot reads from its machine. An agent follows it literally, so every link it
// carries has to land on something the production server actually serves, and it
// must say the same thing as public/skill.md about every shared fact. Links are
// resolved with the production resolver (server/route-resolve.mjs), not a copy.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { loadRouteTable, resolvePhase1, resolveApiHandler } from '../server/route-resolve.mjs';
import { collectSkills, renderGrokSkill, renderRootSkill } from '../scripts/build-skills-pack.mjs';
import { renderFacts, skillFacts } from '../scripts/lib/skill-md-facts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { phase1Routes } = loadRouteTable(path.join(ROOT, 'vercel.json'));
const API_ROOT = path.join(ROOT, 'api');

const SITE = 'three.ws';
// The source repository: raw SKILL.md links must point at a file in this tree.
const RAW_SKILLS = 'https://raw.githubusercontent.com/nirholas/three.ws/main/';

// After the phase-1 rewrites, the filesystem phase serves the built page or the
// copied public/ file. These are the source locations each of those comes from.
function staticFileExists(sitePath) {
	const rel = decodeURIComponent(sitePath).replace(/^\/+/, '');
	if (!rel) return fs.existsSync(path.join(ROOT, 'index.html'));
	return [`public/${rel}`, `pages/${rel}`, rel].some((candidate) => {
		const full = path.join(ROOT, candidate);
		return fs.existsSync(full) && fs.statSync(full).isFile();
	});
}

/** Does the production server answer this three.ws path with something real? */
function serverKnows(pathname) {
	const r = resolvePhase1(phase1Routes, { headers: {} }, new URL(`https://${SITE}${pathname}`));
	if (r.terminal === 'status') return r.status < 400;
	if (r.terminal === 'external') return true;
	if (r.status && r.status >= 400) return false;
	if (r.path.startsWith('/api/')) return Boolean(resolveApiHandler(API_ROOT, r.path));
	if (!staticFileExists(r.path)) return false;
	// /docs/<slug> is one shell page that fetches the doc; without the doc it 404s.
	const doc = pathname.match(/^\/docs\/([a-z0-9-]+)\/?$/);
	return doc ? fs.existsSync(path.join(ROOT, 'docs', `${doc[1]}.md`)) : true;
}

function urlsIn(text) {
	return [...new Set([...text.matchAll(/https?:\/\/[^\s)`'"<>]+/g)].map((m) => m[0].replace(/[.,;:]+$/, '')))];
}

function unresolved(text) {
	const bad = [];
	for (const raw of urlsIn(text)) {
		const url = new URL(raw);
		if (url.hostname === SITE) {
			if (!serverKnows(url.pathname)) bad.push(raw);
		} else if (raw.startsWith(RAW_SKILLS)) {
			if (!fs.existsSync(path.join(ROOT, raw.slice(RAW_SKILLS.length)))) bad.push(raw);
		} else if (!['github.com', 'agentskills.io'].includes(url.hostname)) {
			bad.push(raw);
		}
	}
	return bad;
}

const grokSkill = read('public/grok-skill.md');

describe('public/grok-skill.md', () => {
	it('is the current render of its template', async () => {
		const facts = await skillFacts();
		expect(renderGrokSkill(read('data/grok-skill-md.template.md'), facts)).toBe(grokSkill);
	});

	it('links only to routes the server knows', () => {
		const urls = urlsIn(grokSkill);
		expect(urls.length).toBeGreaterThan(10);
		expect(unresolved(grokSkill)).toEqual([]);
	});

	it('carries frontmatter a skill loader can route on', () => {
		const fm = grokSkill.match(/^---\n([\s\S]*?)\n---\n/);
		expect(fm).not.toBeNull();
		expect(fm[1]).toMatch(/^name: three-ws-grok$/m);
		const description = fm[1].match(/^description: (.+)$/m)?.[1] || '';
		expect(description.length).toBeGreaterThan(40);
		expect(description.length).toBeLessThanOrEqual(1024);
	});

	it('names the Grok connector and runs its HTTP examples against the free server', async () => {
		const { values } = await skillFacts();
		expect(grokSkill).toContain(`Add a custom MCP server called three-ws at ${values.GROK_MCP}`);
		const examples = [...grokSkill.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
		expect(examples.length).toBeGreaterThanOrEqual(4);
		for (const example of examples) {
			expect(example).toContain(`curl -s`);
			expect(example).toContain(values.FREE_MCP);
			const body = JSON.parse(example.match(/-d '(\{.*\})'/)[1]);
			expect(body.jsonrpc).toBe('2.0');
		}
	});

	it('only calls tools with arguments their schemas accept', async () => {
		const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
		const catalog = new Map(toolCatalogFor('full').map((t) => [t.name, t.inputSchema]));
		for (const [, json] of grokSkill.matchAll(/-d '(\{.*\})'/g)) {
			const { method, params } = JSON.parse(json);
			if (method !== 'tools/call') continue;
			const schema = catalog.get(params.name);
			expect(schema, `${params.name} is not on the free server`).toBeTruthy();
			for (const key of Object.keys(params.arguments)) expect(schema.properties, `${params.name}.${key}`).toHaveProperty(key);
			for (const key of schema.required || []) expect(params.arguments, `${params.name} needs ${key}`).toHaveProperty(key);
		}
	});
});

describe('public/skill.md', () => {
	it('is the current render of its template and links only to routes the server knows', async () => {
		const skill = read('public/skill.md');
		const facts = await skillFacts();
		expect(renderRootSkill(collectSkills(), read('data/skill-md.template.md'), facts)).toBe(skill);
		expect(unresolved(skill)).toEqual([]);
	});
});

describe('the shared skill facts', () => {
	it('state the same server URLs and mint in both files', async () => {
		const { values } = await skillFacts();
		const skill = read('public/skill.md');
		for (const key of ['FREE_MCP', 'MCP_DIRECTORY', 'THREE_MINT']) {
			expect(skill, key).toContain(values[key]);
			expect(grokSkill, key).toContain(values[key]);
		}
		expect(skill).toContain(`Up to ${values.FREE_GEN_PER_HOUR} generation calls an hour`);
		expect(grokSkill).toContain(`and ${values.FREE_GEN_PER_HOUR} an hour`);
	});

	it('refuse a tool, prompt or fact that does not exist', async () => {
		const facts = await skillFacts();
		expect(() => renderFacts('{{tool:forge_freee}}', facts, 't')).toThrow(/names a tool/);
		expect(() => renderFacts('{{prompt:no-such-prompt}}', facts, 't')).toThrow(/names a prompt/);
		expect(() => renderFacts('{{NO_SUCH_FACT}}', facts, 't')).toThrow(/unknown placeholder/);
		expect(renderFacts('{{tool:forge_free}} {{prompt:asset-pack}}', facts, 't')).toBe('forge_free asset-pack');
	});
});
