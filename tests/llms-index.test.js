// public/llms.txt is the curated AI index (scripts/build-page-index.mjs renders
// it from site.official and site.llms in data/pages.json). These pin the two
// promises it makes: it names the official domain and $THREE mint, and it stays
// short enough for an agent to read whole, with every curated link a real page.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(resolve(root, 'data/pages.json'), 'utf8'));
const llms = readFileSync(resolve(root, 'public/llms.txt'), 'utf8');
const full = readFileSync(resolve(root, 'public/llms-full.txt'), 'utf8');
const pages = new Map(data.sections.flatMap((s) => s.pages).map((p) => [p.path, p]));
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

describe('llms.txt', () => {
	it('declares the official $THREE mint in data/pages.json', () => {
		expect(data.site.official.token.mint).toBe(THREE_MINT);
	});

	it('states the official domain and mint in both indexes', () => {
		for (const text of [llms, full]) {
			expect(text).toContain('## Official');
			expect(text).toContain(data.site.official.notice);
			expect(text).toContain(THREE_MINT);
		}
	});

	it('lists only real, indexable pages in its curated sections', () => {
		for (const group of data.site.llms) {
			for (const path of group.paths) {
				const page = pages.get(path);
				expect(page, `${path} in site.llms "${group.title}"`).toBeTruthy();
				expect(page.indexable, `${path} is not indexable`).not.toBe(false);
				const doc = /^\/docs\/([a-z0-9-]+)$/.exec(path);
				const href = doc && existsSync(resolve(root, 'docs', `${doc[1]}.md`)) ? `/docs/${doc[1]}.md` : path;
				expect(llms).toContain(`](${data.site.url}${href}): `);
			}
		}
	});

	it('stays curated: short enough for an agent to read whole', () => {
		expect(Buffer.byteLength(llms)).toBeLessThan(40_000);
		expect(llms).toContain(`${data.site.url}/llms-full.txt`);
	});
});

// llmstxt.org: H1, blockquote summary, H2 sections holding link lists. The
// server resolves a path from public/, a docs/<slug>.md copy, or a route in
// vercel.json or data/pages.json; a link matching none of them is a 404.
describe('llms.txt conformance', () => {
	const routes = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')).routes.filter((r) => r.src);
	const resolves = (path) =>
		existsSync(resolve(root, 'public', path.slice(1))) ||
		(path.startsWith('/docs/') && path.endsWith('.md') && existsSync(resolve(root, path.slice(1)))) ||
		pages.has(path) ||
		routes.some((r) => new RegExp(`^${r.src}$`).test(path));
	const links = [...llms.matchAll(/^- \[[^\]]+\]\((https:\/\/three\.ws[^)]*)\)/gm)].map((m) => new URL(m[1]).pathname);

	it('opens with an H1 then a blockquote summary', () => {
		const lines = llms.split('\n');
		expect(lines[0]).toMatch(/^# \S/);
		expect(lines.slice(1, 4).some((l) => l.startsWith('> '))).toBe(true);
	});

	it('groups links under H2 sections as "- [title](url): note" items', () => {
		const h2 = llms.split('\n').filter((l) => l.startsWith('## '));
		expect(h2.length).toBeGreaterThanOrEqual(4);
		expect(links.length).toBeGreaterThan(30);
		expect(llms).toContain('## Optional');
	});

	it('links curated docs as /docs/<slug>.md', () => {
		const md = links.filter((l) => l.startsWith('/docs/') && l.endsWith('.md'));
		expect(md.length).toBeGreaterThanOrEqual(3);
		for (const l of md) expect(existsSync(resolve(root, l.slice(1))), l).toBe(true);
	});

	it('every link resolves to a route the server serves', () => {
		for (const l of links) expect(resolves(l), `${l} resolves`).toBe(true);
	});

	it('llms-full.txt inlines doc bodies, none naming another project', () => {
		const bodies = [...full.matchAll(/<doc title="[^"]+" url="([^"]+)">([\s\S]*?)<\/doc>/g)];
		expect(bodies.length).toBeGreaterThanOrEqual(3);
		for (const [, url, body] of bodies) {
			expect(body.length, url).toBeGreaterThan(500);
			expect(body, url).not.toMatch(/\b(bnb|binance|uniswap|jupiter|raydium)\b/i);
		}
	});
});

describe('install.md', () => {
	const install = readFileSync(resolve(root, 'public/install.md'), 'utf8');
	const dir = JSON.parse(readFileSync(resolve(root, 'public/.well-known/mcp.json'), 'utf8'));

	it('has an H1, a blockquote, the setup command and every hosted endpoint', () => {
		expect(install.split('\n')[0]).toMatch(/^# /);
		expect(install).toMatch(/^> /m);
		expect(install).toContain(dir.setup.command);
		for (const s of dir.servers) expect(install).toContain(s.endpoint);
	});

	it('is linked from llms.txt', () => {
		expect(llms).toContain(`${data.site.url}/install.md`);
	});
});
