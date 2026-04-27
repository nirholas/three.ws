import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const p = (...parts) => resolve(repoRoot, ...parts);

describe('discover/my-agents rename — static page contents', () => {
	it('/discover serves the community ERC-8004 directory page', () => {
		const path = p('public/discover/index.html');
		expect(existsSync(path)).toBe(true);
		const html = readFileSync(path, 'utf8');
		expect(html).toContain('<title>Discover · 3D Agent</title>');
		expect(html).toContain('ERC-8004 Agent Directory');
	});

	it('/my-agents serves the personal On-chain Agents page', () => {
		const path = p('public/my-agents/index.html');
		expect(existsSync(path)).toBe(true);
		const html = readFileSync(path, 'utf8');
		expect(html).toContain('<title>My Agents · 3D Agent</title>');
		expect(html).toContain('On-chain Agents');
	});

	it('/discover no longer shows the previous personal "On-chain Agents" content', () => {
		const html = readFileSync(p('public/discover/index.html'), 'utf8');
		expect(html).not.toContain('On-chain Agents');
	});

	it('/explore directory has been removed (moved to /discover)', () => {
		expect(existsSync(p('public/explore'))).toBe(false);
	});
});

describe('discover/my-agents rename — vercel.json routing', () => {
	const vercel = JSON.parse(readFileSync(p('vercel.json'), 'utf8'));
	const routes = vercel.routes || [];

	it('redirects /explore → /discover with status 301', () => {
		const r = routes.find((x) => x.src === '/explore');
		expect(r).toBeTruthy();
		expect(r.status).toBe(301);
		expect(r.headers?.Location).toBe('/discover');
	});

	it('redirects /explore/ → /discover with status 301', () => {
		const r = routes.find((x) => x.src === '/explore/');
		expect(r).toBeTruthy();
		expect(r.status).toBe(301);
		expect(r.headers?.Location).toBe('/discover');
	});

	it('serves /discover from public/discover/index.html', () => {
		const r = routes.find((x) => x.src === '/discover');
		expect(r?.dest).toBe('/discover/index.html');
	});

	it('serves /my-agents from public/my-agents/index.html', () => {
		const r = routes.find((x) => x.src === '/my-agents');
		expect(r?.dest).toBe('/my-agents/index.html');
	});

	it('does not redirect /discover → /my-agents (would shadow the page)', () => {
		const bad = routes.find(
			(x) => x.src === '/discover' && x.headers?.Location === '/my-agents',
		);
		expect(bad).toBeFalsy();
	});

	it('places /explore redirects after /discover and /my-agents rewrites', () => {
		const idx = (src) => routes.findIndex((x) => x.src === src);
		expect(idx('/explore')).toBeGreaterThan(idx('/discover'));
		expect(idx('/explore')).toBeGreaterThan(idx('/my-agents'));
	});
});
