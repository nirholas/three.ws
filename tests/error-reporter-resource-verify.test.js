// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://three.ws/avatars/b1c8b43a-8f44-484a-b621-e36dcd239b74?lang=ko"}
//
// public/error-reporter.js reported every same-origin <img>/<script>/<link>
// load failure as-is. A renderer that blocks images (seen 2026-11-25 walking
// every ?lang= variant of /avatars/<id> with a plain Chrome UA) produced about
// 1,700 "failed to load img https://three.ws/three.svg" reports in 6 hours
// while /three.svg served 200 the whole time. The reporter now re-checks a
// failed same-origin resource before it reports: an asset that serves fine is
// the client's own refusal and is dropped, and a real failure goes out with the
// HTTP status so a 404 is told apart from a blip.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(process.cwd(), 'public/error-reporter.js'), 'utf8');

let posts;
let heads;

function loadReporter(headStatus) {
	delete window.__threeErrorReporter;
	delete window.__threeErrCap;
	posts = [];
	heads = [];
	navigator.sendBeacon = undefined;
	globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
		if (init.method === 'HEAD') {
			heads.push(String(url));
			if (headStatus instanceof Error) throw headStatus;
			return new Response(null, { status: headStatus });
		}
		posts.push(JSON.parse(init.body));
		return new Response(null, { status: 202 });
	});
	window.eval(SRC);
}

function failImage(src) {
	const img = document.createElement('img');
	img.setAttribute('src', src);
	document.body.appendChild(img);
	window.__threeErrQ.push({ type: 'error', target: img });
}

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
	window.dispatchEvent(new Event('pagehide'));
}

beforeEach(() => {
	document.body.innerHTML = '';
	window.__threeErrQ = [];
});

describe('same-origin resource failures', () => {
	it('are dropped when the asset serves fine on a re-check', async () => {
		loadReporter(200);
		failImage('/three.svg');
		failImage('/three.svg');
		await settle();
		expect(heads).toEqual(['https://three.ws/three.svg']);
		expect(posts).toEqual([]);
	});

	it('are reported with the status when the asset is really missing', async () => {
		loadReporter(404);
		failImage('/marks/gone.svg');
		await settle();
		expect(posts).toHaveLength(1);
		expect(posts[0].events[0]).toMatchObject({ type: 'resource', source: 'https://three.ws/marks/gone.svg', status: 404 });
	});

	it('are dropped when the re-check itself cannot reach the server', async () => {
		loadReporter(new TypeError('Failed to fetch'));
		failImage('/three.svg');
		await settle();
		expect(posts).toEqual([]);
	});
});
