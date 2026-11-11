// server/dev-api-pages.mjs: the dev server answers every page URL that
// production rewrites to an api/ handler with that same handler, resolved by
// the production route table and resolver.

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadRouteTable } from '../server/route-resolve.mjs';
import { devHandlerRoute, devApiPagesMiddleware, devDirectoryIndexUrl } from '../server/dev-api-pages.mjs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(root, 'api');
const table = loadRouteTable(path.join(root, 'vercel.json'));
const BINGBOT = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const AGENT = '009914b5-323d-4694-9e72-9d60b56828a8';

const route = (url, ua = BROWSER) => devHandlerRoute(table, apiRoot, { url, headers: { 'user-agent': ua } });
const rel = (r) => r && path.relative(root, r.file);

describe('devHandlerRoute', () => {
	it('routes the sitemap index and paged children to their handlers', () => {
		expect(rel(route('/sitemap.xml'))).toBe('api/sitemap.js');
		const child = route('/sitemap/avatars-2.xml');
		expect(rel(child)).toBe('api/sitemap/[type].js');
		expect(child.query.type).toBe('avatars-2');
	});

	it('gives a crawler the server-rendered agent page and a browser the SPA', () => {
		const bot = route(`/agents/${AGENT}`, BINGBOT);
		expect(rel(bot)).toBe('api/agent-detail-og.js');
		expect(bot.query.id).toBe(AGENT);
		expect(route(`/agents/${AGENT}`, BROWSER)).toBeNull();
	});

	it('routes widget and news story pages for every user agent', () => {
		expect(rel(route('/w/wdgt_2R4TTLhdjEJ4frRf'))).toBe('api/widgets/page.js');
		const story = route('/markets/news/2026-11/e1755a16ed7d2be0-some-headline');
		expect(rel(story)).toBe('api/news/story-page.js');
		expect(story.query).toMatchObject({ month: '2026-11', id: 'e1755a16ed7d2be0', slug: 'some-headline' });
	});

	it('leaves /api calls, Vite modules, static files and plain pages to Vite', () => {
		expect(route('/api/sitemap')).toBeNull();
		expect(route('/src/main.js')).toBeNull();
		expect(route('/@vite/client')).toBeNull();
		expect(route('/logo.png')).toBeNull();
		expect(route('/pricing')).toBeNull();
	});

	it('merges the request query under the rewrite query', () => {
		const r = route('/sitemap/core.xml?type=evil&x=1');
		expect(r.query).toMatchObject({ type: 'core', x: '1' });
	});

	it('keeps the original pathname and merges the rewrite query into req.url, as server/index.mjs does', () => {
		const r = route(`/agents/${AGENT}?ref=x`, BINGBOT);
		const u = new URL(r.url, 'http://x');
		expect(u.pathname).toBe(`/agents/${AGENT}`);
		expect(u.searchParams.get('id')).toBe(AGENT);
		expect(u.searchParams.get('ref')).toBe('x');
		expect(route('/sitemap.xml').url).toBe('/sitemap.xml');
	});
});

function fakeRes() {
	const headers = {};
	return {
		statusCode: 200,
		headersSent: false,
		body: undefined,
		setHeader(k, v) { headers[k.toLowerCase()] = v; },
		getHeader(k) { return headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
		headers,
	};
}

describe('devDirectoryIndexUrl', () => {
	// Production serves /agents from /agents/index.html with a 200 (a vercel.json
	// rewrite); Vite's static server answers the slashless path with a 301 to
	// /agents/, which the SEO audit then reports as a redirect in the sitemap.
	const dir = (url) => devDirectoryIndexUrl(table, { url, headers: { 'user-agent': BROWSER } });

	it('serves a rewritten directory index in place instead of redirecting', () => {
		expect(dir('/agents')).toBe('/agents/');
		expect(dir('/agents?q=scout')).toBe('/agents/?q=scout');
	});

	it('leaves slashed paths, handler routes and plain pages alone', () => {
		expect(dir('/agents/')).toBeNull();
		expect(dir('/sitemap.xml')).toBeNull();
		expect(dir('/pricing')).toBeNull();
	});
});

describe('devApiPagesMiddleware', () => {
	it('runs the local handler with the rewrite query when a database is configured', async () => {
		const handler = vi.fn((req, res) => res.status(200).send(`type=${req.query.type}`));
		const load = vi.fn(async () => ({ default: handler }));
		const mw = devApiPagesMiddleware({ root, upstream: 'https://up.example', table: () => table, load, hasDatabase: () => true });
		const res = fakeRes();
		const next = vi.fn();
		await mw({ method: 'GET', url: '/sitemap/widgets.xml', headers: {} }, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(path.relative(root, load.mock.calls[0][0])).toBe('api/sitemap/[type].js');
		expect(res.body).toBe('type=widgets');
	});

	it('forwards to the upstream with the caller user agent when no database is configured', async () => {
		const fetchImpl = vi.fn(async () => new Response('<html>agent</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
		const load = vi.fn();
		const mw = devApiPagesMiddleware({ root, upstream: 'https://up.example', table: () => table, load, hasDatabase: () => false, fetchImpl });
		const res = fakeRes();
		await mw({ method: 'GET', url: `/agents/${AGENT}`, headers: { 'user-agent': BINGBOT } }, res, vi.fn());
		expect(load).not.toHaveBeenCalled();
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe(`https://up.example/agents/${AGENT}`);
		expect(init.headers['user-agent']).toBe(BINGBOT);
		expect(res.headers['content-type']).toBe('text/html');
		expect(Buffer.from(res.body).toString()).toBe('<html>agent</html>');
	});

	it('forwards the session cookie and returns the upstream cookies, so a signed-in OAuth authorize reaches consent', async () => {
		// /oauth/authorize is a vercel.json page route to api/oauth/[action]. Without
		// the cookie the upstream saw no session and bounced a signed-in user to
		// /login on every attempt (the PowerPoint add-in sign-in loop in dev).
		const fetchImpl = vi.fn(async () => {
			const headers = new Headers({ 'content-type': 'text/html' });
			headers.append('set-cookie', '__Host-csrf=a; Path=/; Secure; HttpOnly');
			headers.append('set-cookie', 'tws_seen=1; Path=/');
			return new Response('<form>consent</form>', { status: 200, headers });
		});
		const mw = devApiPagesMiddleware({ root, upstream: 'http://localhost:3147', table: () => table, load: vi.fn(), hasDatabase: () => false, fetchImpl });
		const res = fakeRes();
		await mw({ method: 'GET', url: '/oauth/authorize?response_type=code&client_id=c1', headers: { host: 'localhost:3102', cookie: '__Host-sid=s1; theme=dark', 'user-agent': BROWSER } }, res, vi.fn());
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('http://localhost:3147/oauth/authorize?response_type=code&client_id=c1');
		expect(init.headers.cookie).toBe('__Host-sid=s1; theme=dark');
		expect(res.headers['set-cookie']).toEqual(['__Host-csrf=a; Path=/; Secure; HttpOnly', 'tws_seen=1; Path=/']);
		expect(Buffer.from(res.body).toString()).toBe('<form>consent</form>');
	});

	it('passes everything else, and non-GET methods, to the next middleware', async () => {
		const mw = devApiPagesMiddleware({ root, upstream: 'https://up.example', table: () => table, load: vi.fn(), hasDatabase: () => true });
		const next = vi.fn();
		await mw({ method: 'GET', url: '/pricing', headers: {} }, fakeRes(), next);
		await mw({ method: 'POST', url: '/sitemap.xml', headers: {} }, fakeRes(), next);
		expect(next).toHaveBeenCalledTimes(2);
	});

	it('rewrites a directory index path in place and hands it to Vite', async () => {
		const mw = devApiPagesMiddleware({ root, upstream: 'https://up.example', table: () => table, load: vi.fn(), hasDatabase: () => true });
		const next = vi.fn();
		const req = { method: 'GET', url: '/agents', headers: {} };
		await mw(req, fakeRes(), next);
		expect(req.url).toBe('/agents/');
		expect(next).toHaveBeenCalledTimes(1);
	});

	it('answers 502 with the handler path when the handler throws', async () => {
		const load = vi.fn(async () => ({ default: () => { throw new Error('db down'); } }));
		const mw = devApiPagesMiddleware({ root, upstream: 'https://up.example', table: () => table, load, hasDatabase: () => true });
		const res = fakeRes();
		await mw({ method: 'GET', url: '/sitemap.xml', headers: {} }, res, vi.fn());
		expect(res.statusCode).toBe(502);
		expect(res.body).toContain('api/sitemap.js failed in dev: db down');
	});
});

describe('importFresh', () => {
	// A crawler handler renders through shared helpers (api/_lib/crawler-page.js).
	// Re-importing only the handler kept the old helper, so an edit to the helper
	// never reached the dev server until it was restarted. Vitest runs its own
	// module loader, so this drives Node's real one in a child process.
	it('re-imports the modules a handler imports after a new generation starts', () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'dev-api-pages-'));
		const script = `
			import { writeFileSync } from 'node:fs';
			const { importFresh, bumpModuleGeneration } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/dev-api-pages.mjs')).href)});
			const dir = ${JSON.stringify(dir)};
			writeFileSync(dir + '/handler.mjs', "export { value } from './helper.mjs';");
			writeFileSync(dir + '/helper.mjs', "export const value = 'old';");
			const before = (await importFresh(dir + '/handler.mjs')).value;
			writeFileSync(dir + '/helper.mjs', "export const value = 'new';");
			bumpModuleGeneration();
			const after = (await importFresh(dir + '/handler.mjs')).value;
			process.stdout.write(before + ' ' + after);
		`;
		const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
		expect(out).toBe('old new');
	});
});
