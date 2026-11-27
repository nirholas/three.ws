// @vitest-environment jsdom
/**
 * /nim-forge (pages/nim-forge.html + src/nim-forge.js) when the deployment has
 * no self-hosted TRELLIS NIM wired, which is production's state on 2026-11-27
 * (GET /api/nim-forge answers {"configured":false}).
 *
 * The page showed a small "NIM not configured" badge and then still invited a
 * photo and a Generate press, which could only end in an error panel. It must
 * say what is missing, keep Generate off, and point to the two places that do
 * work: the hosted Forge and /forge-nim with your own endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'pages/nim-forge.html'), 'utf8');
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);

let posts;
async function loadPage(health) {
	vi.resetModules();
	document.body.innerHTML = main;
	posts = [];
	globalThis.fetch = vi.fn(async (url, init = {}) => {
		if ((init.method || 'GET') === 'POST') {
			posts.push(url);
			return new Response(JSON.stringify({ message: 'should not be called' }), { status: 503 });
		}
		return typeof health === 'function' ? health() : new Response(JSON.stringify(health), { status: 200 });
	});
	await import('../src/nim-forge.js');
	await vi.waitFor(() => expect(document.getElementById('status-badge').dataset.state).not.toBe('checking'));
}

const $ = (id) => document.getElementById(id);

describe('/nim-forge with no NIM wired', () => {
	beforeEach(async () => {
		await loadPage({ configured: false, endpoint: '/v1/infer' });
	});

	it('explains what is missing in the stage, with the routes that work', () => {
		const panel = $('panel-offline');
		expect(panel).not.toBeNull();
		expect(panel.classList.contains('is-active')).toBe(true);
		expect($('panel-empty').classList.contains('is-active')).toBe(false);
		expect(panel.textContent).toMatch(/NIM_TRELLIS_URL/);
		const hrefs = [...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(expect.arrayContaining(['/forge', '/forge-nim']));
	});

	it('keeps Generate off and says why, even once a prompt is typed', async () => {
		expect($('generate').disabled).toBe(true);
		expect($('generate').textContent).toMatch(/not configured/i);
		$('mode-text').click();
		$('prompt').value = 'a worn leather armchair';
		$('prompt').dispatchEvent(new Event('input'));
		expect($('generate').disabled).toBe(true);
		expect($('generate').textContent).toMatch(/not configured/i);
		$('generate').click();
		expect(posts).toHaveLength(0);
	});
});

describe('/nim-forge with a NIM wired', () => {
	it('keeps the normal empty state and enables Generate once there is input', async () => {
		await loadPage({ configured: true, endpoint: '/v1/infer' });
		expect($('panel-offline')?.classList.contains('is-active') ?? false).toBe(false);
		expect($('panel-empty').classList.contains('is-active')).toBe(true);
		$('mode-text').click();
		$('prompt').value = 'a worn leather armchair';
		$('prompt').dispatchEvent(new Event('input'));
		expect($('generate').disabled).toBe(false);
	});
});

describe('/nim-forge when the health check itself fails', () => {
	it('does not lock the page: a later Generate can still reach the server and report its error', async () => {
		await loadPage(() => {
			throw new TypeError('Failed to fetch');
		});
		expect($('status-badge').dataset.state).toBe('down');
		$('mode-text').click();
		$('prompt').value = 'a worn leather armchair';
		$('prompt').dispatchEvent(new Event('input'));
		expect($('generate').disabled).toBe(false);
	});
});
