// public/grok-skill.md is the file a Grok user hands to Grok Skills or Grok Bot,
// so a dead link or a stale number in it is advice the model repeats to a person.
// These tests lock three contracts: the file is the committed render of its
// template, every three.ws URL in it resolves to a route this server serves, and
// the limits it quotes are the ones the handler enforces.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { loadSkillFacts, renderGrokSkill } from '../scripts/build-skills-pack.mjs';
import { TOOL_NAMES } from '../api/_mcp-studio/tools.js';
import { toolsFor } from '../api/_mcp-studio/dispatch.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const rendered = read('public/grok-skill.md');
const facts = loadSkillFacts();

const vercel = JSON.parse(read('vercel.json'));
const isCatchAll = (src) => src === '/(.*)' || src.startsWith('/(.*\\.');
const routes = (vercel.routes || [])
	.filter((r) => (r.dest || (r.status >= 300 && r.status < 400)) && !(r.status >= 400) && !isCatchAll(r.src))
	.map((r) => new RegExp(`^${r.src.replace(/^\^/, '').replace(/\$$/, '')}$`));

const isFile = (rel) => {
	try {
		return fs.statSync(path.join(ROOT, rel)).isFile();
	} catch {
		return false;
	}
};

function resolves(urlPath) {
	if (urlPath.startsWith('/api/')) {
		const base = urlPath.replace(/^\//, '');
		return routes.some((re) => re.test(urlPath)) || isFile(`${base}.js`) || isFile(`${base}/index.js`);
	}
	if (routes.some((re) => re.test(urlPath))) return true;
	const p = urlPath.replace(/^\/+|\/+$/g, '');
	return [`public/${p}`, `public/${p}.html`, `pages/${p}.html`, `${p}.html`, `${p}.md`, `${p}/index.html`].some(isFile);
}

function siteUrls(text) {
	const found = new Set();
	for (const m of text.matchAll(/https?:\/\/[^\s)'"`<>]+/g)) {
		const url = m[0].replace(/[.,;:]+$/, '');
		found.add(url);
	}
	return [...found];
}

describe('public/grok-skill.md', () => {
	it('is the committed render of data/grok-skill-md.template.md', () => {
		expect(rendered).toBe(renderGrokSkill(read('data/grok-skill-md.template.md')));
	});

	it('has frontmatter a skill loader can route on', () => {
		const fm = rendered.match(/^---\n([\s\S]*?)\n---\n/);
		expect(fm, 'missing frontmatter').not.toBeNull();
		expect(fm[1]).toMatch(/^name: [a-z0-9-]+$/m);
		const description = fm[1].match(/^description: (.+)$/m)?.[1] ?? '';
		expect(description.length).toBeGreaterThan(40);
		expect(description.length).toBeLessThanOrEqual(1024);
	});

	it('leaves no unfilled marker', () => {
		expect(rendered).not.toMatch(/\{\{[A-Z_]+\}\}/);
	});

	it('points only at three.ws URLs that resolve to a route the server knows', () => {
		// The frontmatter `source` is the public repository, not a page of ours.
		const urls = siteUrls(rendered).filter((u) => u !== 'https://github.com/nirholas/three.ws');
		expect(urls.length).toBeGreaterThan(5);
		for (const url of urls) {
			const u = new URL(url);
			expect(u.origin, `${url} is not on the official site`).toBe('https://three.ws');
			expect(resolves(u.pathname), `${url} resolves to no route, page or handler`).toBe(true);
		}
	});

	it('names only tools the Grok surface serves', () => {
		const served = new Set(Object.keys(toolsFor('grok')));
		const mentioned = [...rendered.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
		const studio = mentioned.filter((n) => TOOL_NAMES.includes(n));
		expect(studio.length).toBeGreaterThan(8);
		for (const name of studio) expect(served.has(name), `${name} is not served on /api/mcp-grok`).toBe(true);
	});

	it('quotes the generation limits and call budget the handler enforces', () => {
		const handler = read('api/_mcp-studio/handler.js');
		expect(handler).toContain(`${facts.BURST_LIMIT} generations per minute`);
		expect(handler).toContain(`${facts.HOURLY_LIMIT} generations per hour`);
		const dispatch = read('api/_mcp-studio/dispatch.js');
		expect(dispatch).toContain(`GROK_CALL_BUDGET_MS = ${facts.CALL_BUDGET_SECONDS}_000`);
		expect(rendered).toContain(`${facts.BURST_LIMIT} generations per minute`);
		expect(rendered).toContain(`${facts.HOURLY_LIMIT} per hour`);
	});

	it('never lists a wallet, payment or launch tool', () => {
		expect(rendered).not.toMatch(/`(?:send_|swap_|pay_|launch_|transfer_)[a-z_]*`/);
		expect(rendered).toMatch(/Money needs the user's yes/);
	});
});

describe('shared facts', () => {
	it('are used by both entry-point templates', () => {
		const base = read('data/skill-md.template.md');
		const grok = read('data/grok-skill-md.template.md');
		for (const name of ['STUDIO_URL']) expect(base).toContain(`{{${name}}}`);
		for (const name of ['GROK_URL', 'GROK_OAUTH_URL', 'BURST_LIMIT', 'HOURLY_LIMIT', 'CALL_BUDGET_SECONDS']) {
			expect(grok).toContain(`{{${name}}}`);
		}
	});
});
