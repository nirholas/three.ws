// The review's page evidence reads live pages through createPageReader. It used to
// navigate with waitUntil: 'networkidle', so a page that keeps a request in flight
// (a 3D viewer streaming assets, a live feed polling) never resolved the goto: the
// reader reported "page answered HTTP 0" for a page that had answered 200, and every
// claim cited on three.ws/restyle failed review (2026-11-04).
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPageReader } from '../api/_lib/x-content/verify.js';

const BODY = 'Gold, chrome, copper and glass finishes, each a set of real PBR values. '.repeat(6);

let server;
let origin;

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === '/poll') {
			// Answer slowly and forever: the page re-polls on every reply, so the
			// network never stays quiet for the 500 ms networkidle waits for.
			setTimeout(() => res.end('{}'), 300);
			return;
		}
		res.setHeader('content-type', 'text/html');
		res.end(`<!doctype html><main><p>${BODY}</p></main><script>
			(function poll(){ fetch('/poll').then(poll, poll); })();
		</script>`);
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
	server.closeAllConnections?.();
	await new Promise((done) => server.close(done));
});

describe('createPageReader', () => {
	it('reads a page that never goes network-idle with its real status', async () => {
		const pages = createPageReader({ idleTimeout: 2000 });
		try {
			const result = await pages.text(`${origin}/restyle`);
			expect(result.status).toBe(200);
			expect(result.text).toContain('real pbr values');
		} finally {
			await pages.close();
		}
	}, 120_000);
});
