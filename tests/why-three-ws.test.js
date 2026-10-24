// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('/why-three-ws wiring', () => {
	it('is routed, built, indexed and in the nav', () => {
		expect(JSON.parse(read('vercel.json')).routes.some((r) => r.src === '/why-three-ws/?' && r.dest === '/why-three-ws.html')).toBe(true);
		expect(read('vite.config.js')).toContain("'why-three-ws': resolve(__dirname, 'pages/why-three-ws.html')");
		const pages = JSON.parse(read('data/pages.json'));
		expect(pages.sections.flatMap((s) => s.pages).some((p) => p.path === '/why-three-ws')).toBe(true);
		expect(read('public/nav-data.js')).toContain("href: '/why-three-ws'");
	});

	it('types no figures into the page or module and names no platform', () => {
		const html = read('pages/why-three-ws.html');
		const body = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
		const text = body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\b3D\b|x402/g, '');
		expect(text).not.toMatch(/\d/);
		expect(read('src/why-three-ws.js')).not.toMatch(/\b\d{3,}\b/);
		expect(html + read('src/why-three-ws.js')).not.toMatch(/Competitor X|[\u2013\u2014]/);
	});
});

describe('/why-three-ws proof tiles', () => {
	beforeEach(() => {
		vi.resetModules();
		document.body.innerHTML = `<div id="yw-tiles"></div><div id="yw-error" hidden></div><button id="yw-retry"></button>`;
	});
	afterEach(() => vi.unstubAllGlobals());

	const metric = (key, unit, total, available = true) => ({ label: key, unit, total, available, method: 'm' });

	it('renders live values and marks an unreadable metric Unavailable, not zero', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ metrics: {
				agents: metric('Agents', 'count', 4321),
				coins_launched: metric('Coins', 'count', 7),
				creator_fees: metric('Fees', 'sol', null, false),
				x402_settlements: metric('Settlements', 'count', 99),
				models_generated: metric('Models', 'count', 12),
			} }),
		}));
		await import('../src/why-three-ws.js');
		await vi.waitFor(() => expect(document.querySelectorAll('.yw-tile').length).toBe(5));
		const tiles = [...document.querySelectorAll('.yw-tile')];
		expect(tiles[0].textContent).toContain((4321).toLocaleString());
		expect(tiles[2].classList.contains('is-unavailable')).toBe(true);
		expect(tiles[2].textContent).toContain('Unavailable');
		expect(document.getElementById('yw-error').hidden).toBe(true);
	});

	it('shows the error banner and Unavailable tiles when the API fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		await import('../src/why-three-ws.js');
		await vi.waitFor(() => expect(document.getElementById('yw-error').hidden).toBe(false));
		expect(document.querySelectorAll('.yw-tile.is-unavailable').length).toBe(5);
	});
});
