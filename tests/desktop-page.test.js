import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS, NATIVE_APPS, ALL_APPS } from '../src/desktop/apps.js';
import { isInternalPath } from '../src/desktop/layout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const vercel = JSON.parse(read('vercel.json'));

describe('desktop page', () => {
	const html = read('pages/desktop.html');

	it('lists every windowed app as a crawlable link', () => {
		for (const app of APPS) expect(html, app.title).toContain(`href="${app.href}"`);
		expect(html).toContain('href="/classic"');
	});

	it('only registers apps with same-origin paths and unique ids', () => {
		for (const a of APPS) expect(isInternalPath(a.href), a.id).toBe(true);
		const ids = ALL_APPS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
		NATIVE_APPS.forEach((a) => expect(a.native).toBe(true));
	});

	it('honours the saved classic-view preference', () => {
		expect(html).toContain("localStorage.getItem('tws:view')==='classic'");
		expect(html).toContain("localStorage.setItem('tws:view','desktop')");
	});
});

describe('desktop routing', () => {
	const route = (src) => vercel.routes.find((r) => r.src === src);
	it('serves the desktop at / and the previous homepage at /classic', () => {
		expect(route('/').dest).toBe('/desktop.html');
		expect(route('/classic/?').dest).toBe('/home.html');
	});
	it('offers the way back from the classic page', () => {
		expect(read('pages/home.html')).toContain('href="/?view=desktop"');
	});
});
