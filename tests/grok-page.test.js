// /grok tells a Grok Bot user which tools it will call, which guided prompts
// to schedule and what to name the connector. Grok Bot follows those words
// literally, so every tool and prompt the page names must be one the
// /api/mcp-grok surface really serves, and every connector name must be the
// one the shared connector card (src/grok-connector.js) and /connect use.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';

const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
const { GROK_ACCOUNT_TOOLS } = await import('../api/_mcp-studio/account-tools.js');
const { PROMPTS } = await import('../api/_mcp/prompts.js');
const { GROK_ENDPOINT, grokAuthFor, grokSentence, slugForEndpoint } = await import('../src/grok-connector.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'pages/grok.html'), 'utf8');
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attrs = (name) => [...html.matchAll(new RegExp(`${name}="([^"]+)"`, 'g'))].map((m) => decode(m[1]));

const SERVED_TOOLS = new Set([...toolCatalogFor('grok').map((t) => t.name), ...GROK_ACCOUNT_TOOLS]);
const AGENT_PROMPTS = new Set(PROMPTS.filter((p) => p.agent).map((p) => p.name));
const SLUG = slugForEndpoint(GROK_ENDPOINT);

describe('/grok names only what /api/mcp-grok serves', () => {
	it('every tool chip and recipe step is a served tool', () => {
		const named = attrs('data-tool');
		expect(named.length).toBeGreaterThan(15);
		expect(named.filter((name) => !SERVED_TOOLS.has(name))).toEqual([]);
	});

	it('every recipe links a guided prompt written for an unattended agent', () => {
		const prompts = attrs('data-prompt');
		expect(prompts).toHaveLength(4);
		expect(prompts.filter((name) => !AGENT_PROMPTS.has(name))).toEqual([]);
	});

	it('every "run the X prompt" instruction names a real prompt', () => {
		const asked = attrs('data-ask').flatMap((text) => [...text.matchAll(/run the ([a-z0-9-]+) prompt/gi)].map((m) => m[1]));
		expect(asked.length).toBeGreaterThanOrEqual(4);
		expect(asked.filter((name) => !AGENT_PROMPTS.has(name))).toEqual([]);
	});

	it('the recipe link lands on the guided-prompts heading of docs/grok.md', () => {
		const doc = fs.readFileSync(path.join(ROOT, 'docs/grok.md'), 'utf8');
		const anchors = doc
			.split('\n')
			.filter((line) => line.startsWith('## '))
			.map((line) => line.slice(3).toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-'));
		for (const href of new Set(attrs('href').filter((h) => h.startsWith('/docs/grok#')))) {
			expect(anchors).toContain(href.split('#')[1]);
		}
	});
});

describe('one connector name everywhere', () => {
	it('the Grok server slug follows the CLI rule', () => {
		expect(SLUG).toBe('three-ws-grok');
	});

	it('every sentence on the page uses that name', () => {
		const text = decode(html);
		const called = [...text.matchAll(/custom MCP server called ([a-z0-9-]+)/g)].map((m) => m[1]);
		const uses = [...text.matchAll(/(?:Use|from) (three-ws[a-z0-9-]*)/g)].map((m) => m[1]);
		expect(called.length).toBeGreaterThan(0);
		expect(uses.length).toBeGreaterThan(0);
		expect([...new Set([...called, ...uses])]).toEqual([SLUG]);
	});

	it('the hero sentence is the one the connector card generates', () => {
		const hero = html.match(/id="gk-say-text">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
		// Making a model needs a free account, so the sentence a visitor copies
		// signs the connector in rather than leaving it anonymous.
		expect(hero).toBe(grokSentence({ endpoint: `${GROK_ENDPOINT}?auth=oauth`, auth: 'OAuth 2.1' }));
	});

	it('the skill file and the guide use the same name', () => {
		for (const rel of ['public/grok-skill.md', 'docs/grok.md']) {
			const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
			expect(body, rel).toContain(`called ${SLUG} at ${GROK_ENDPOINT}`);
			expect(body, rel).not.toMatch(/called three-ws at /);
		}
	});
});

describe('grokAuthFor', () => {
	it('maps every directory auth string to the form field Grok Bot takes', () => {
		expect(grokAuthFor({ auth: 'none' })).toBe('none');
		expect(grokAuthFor({ auth: 'none for the read-only tools; API key or x402 for uploads' })).toBe('none');
		expect(grokAuthFor({ auth: 'OAuth 2.1 or x402 pay-per-call', signIn: `${GROK_ENDPOINT}?auth=oauth` })).toBe('none');
		expect(grokAuthFor({ auth: 'x402 pay-per-call' })).toBe('key');
		expect(grokAuthFor({ auth: 'OAuth 2.1' })).toBe('oauth');
		expect(grokSentence({ endpoint: 'https://three.ws/api/mcp', auth: 'OAuth 2.1' })).toBe(
			'Add a custom MCP server called three-ws-main at https://three.ws/api/mcp with OAuth authentication',
		);
	});
});

describe('Grok Bot task templates', () => {
	const section = html.match(/<section class="gk-sec" aria-labelledby="gk-templates-h">([\s\S]*?)<\/section>/)?.[1] ?? '';
	const cards = [...section.matchAll(/<article class="gk-recipe">([\s\S]*?)<\/article>/g)].map((m) => m[1]);
	const guide = fs.readFileSync(path.join(ROOT, 'docs/grok-bot.md'), 'utf8');
	const templates = guide.split('\n## Task templates\n')[1]?.split('\n## ')[0] ?? '';
	const FREE_TOOLS = new Set(toolCatalogFor('grok').map((t) => t.name));

	it('the page shows the templates docs/grok-bot.md publishes, each with its exact prompt', () => {
		expect(cards.length).toBeGreaterThanOrEqual(4);
		expect(cards.length).toBeLessThanOrEqual(5);
		for (const card of cards) {
			const ask = decode(card.match(/data-ask="([^"]+)"/)[1]);
			expect(ask).toContain(`three-ws-grok`);
			expect(templates).toContain(ask);
		}
	});

	it('every card states its connector, expected output and measured runtime', () => {
		for (const card of cards) {
			const labels = [...card.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
			expect(labels).toEqual(['Connector', 'Output', 'Runtime']);
			expect(card).toMatch(/<dd><code>three-ws-grok<\/code><\/dd>/);
			expect(card).toMatch(/<dt>Runtime<\/dt><dd>[^<]*\d[^<]*<\/dd>/);
		}
	});

	it('templates call only free studio tools, never an account or spending tool', () => {
		const steps = cards.flatMap((card) => [...card.matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]));
		expect(steps.length).toBeGreaterThan(0);
		expect(steps.filter((name) => !FREE_TOOLS.has(name))).toEqual([]);
	});

	it('the card link lands on the Task templates heading of docs/grok-bot.md', () => {
		const links = [...section.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
		expect(links.length).toBe(cards.length);
		expect([...new Set(links)]).toEqual(['/docs/grok-bot#task-templates']);
		expect(templates.length).toBeGreaterThan(0);
	});
});
