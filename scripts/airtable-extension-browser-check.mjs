#!/usr/bin/env node
// Drives the Forge Airtable extension in a real Chromium against the real Forge API.
//
// The Blocks CLI only serves an extension inside an Airtable base, so this bundles
// integrations/airtable/test/harness.jsx (the real extension inside Airtable's TestDriver
// with the fixture catalog base) and serves it from a local origin. Production CORS does
// not admit localhost, so the same server passes /api/forge straight through to three.ws;
// the extension still makes every real request, only the hop is same-origin.
//
// Usage:
//   THREE_WS_API_KEY=sk_live_... node scripts/airtable-extension-browser-check.mjs \
//     [--shots <dir>] [--prompt "a carved wooden owl bookend"]
//   --prompt replaces the fixture teapot prompt so Forge runs a fresh (uncached) generation.
//   FORGE_BASE_URL overrides https://three.ws. Exits non-zero on any console error, page
//   error, or a generation that does not land in the record.
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'integrations/airtable');
const FORGE = (process.env.FORGE_BASE_URL || 'https://three.ws').replace(/\/$/, '');
const API_KEY = process.env.THREE_WS_API_KEY || '';
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > -1 ? path.resolve(process.argv[shotsArg + 1]) : null;
const promptArg = process.argv.indexOf('--prompt');
const PROMPT = promptArg > -1 ? process.argv[promptArg + 1] : 'a ceramic teapot with a bamboo handle';
const TIMEOUT_MS = 7 * 60 * 1000;

if (!/^sk_(live|test)_/.test(API_KEY)) {
	console.error('Set THREE_WS_API_KEY to a three.ws API key (create one at https://three.ws/dashboard/api).');
	process.exit(2);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const outDir = mkdtempSync(path.join(tmpdir(), 'airtable-ext-'));
await build({
	entryPoints: [path.join(EXT, 'test/harness.jsx')],
	absWorkingDir: EXT,
	bundle: true,
	outfile: path.join(outDir, 'harness.js'),
	platform: 'browser',
	format: 'iife',
	jsx: 'transform',
	jsxFactory: 'React.createElement',
	jsxFragment: 'React.Fragment',
	define: { 'process.env.NODE_ENV': '"development"', global: 'window' },
	logLevel: 'warning',
});
const bundle = readFileSync(path.join(outDir, 'harness.js'));
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge for Airtable</title>
<style>html,body{margin:0;height:100%;font-family:-apple-system,system-ui,sans-serif}</style></head>
<body><script src="/harness.js"></script></body></html>`;

const exchanges = [];
const server = http.createServer(async (req, res) => {
	try {
		if (req.url.startsWith('/api/forge')) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const headers = {};
			for (const name of ['authorization', 'content-type', 'x-forge-client', 'accept']) {
				if (req.headers[name]) headers[name] = req.headers[name];
			}
			const upstream = await fetch(FORGE + req.url, {
				method: req.method,
				headers,
				body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
			});
			const passHeaders = {};
			for (const name of ['content-type', 'retry-after']) {
				const value = upstream.headers.get(name);
				if (value) passHeaders[name] = value;
			}
			exchanges.push(`${req.method} ${upstream.status}`);
			res.writeHead(upstream.status, passHeaders);
			res.end(Buffer.from(await upstream.arrayBuffer()));
			return;
		}
		if (req.url === '/harness.js') {
			res.writeHead(200, { 'content-type': 'text/javascript' });
			res.end(bundle);
			return;
		}
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(page);
	} catch (error) {
		res.writeHead(502, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'proxy_failed', message: error.message }));
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;

const problems = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 560, height: 760 }, deviceScaleFactor: 2 });
const tab = await context.newPage();
// Chromium logs every non-2xx fetch as a console error. A 429 the extension waited out and
// retried is handled behavior, counted separately; any other console error or warning fails.
let handled429 = 0;
tab.on('console', (msg) => {
	if (!['error', 'warning'].includes(msg.type())) return;
	if (/^Failed to load resource: .*status of 429/.test(msg.text())) handled429 += 1;
	else problems.push(`console.${msg.type()}: ${msg.text()}`);
});
tab.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
const imagesLoaded = () =>
	tab.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 30_000 });
const shot = async (name) => {
	if (!SHOTS) return;
	await imagesLoaded();
	await tab.screenshot({ path: path.join(SHOTS, name) });
};

let exitCode = 0;
try {
	const query = new URLSearchParams({ configured: '1', base: origin, prompt: PROMPT });
	await tab.goto(`${origin}/?${query}`);
	await tab.getByRole('heading', { name: 'Set up Forge' }).waitFor();
	await shot('01-setup.png');

	await tab.getByLabel('API key').fill(API_KEY);
	await tab.getByRole('button', { name: 'Save key' }).click();
	await tab.getByRole('heading', { name: 'Forge 3D models' }).waitFor();
	const storedInConfig = await tab.evaluate(() => JSON.stringify(window.testDriver.globalConfig.get([])));
	if (storedInConfig && storedInConfig.includes('sk_')) problems.push('API key leaked into globalConfig');
	await tab.getByText('1 of 2 records with a prompt have a model.').waitFor();
	await shot('02-records.png');

	const started = Date.now();
	await tab.getByRole('button', { name: `Generate: ${PROMPT}` }).click();
	// A cached prompt finishes before any progress paints, so progress is only captured when seen.
	const progress = await tab
		.getByText(/^(In line|Generating|three\.ws is busy, retrying) · ([3-9]|\d{2,})s$/)
		.first()
		.waitFor({ timeout: 60_000 })
		.then(() => true, () => false);
	if (progress) await shot('03-generating.png');
	await tab.getByText('2 of 2 records with a prompt have a model.').waitFor({ timeout: TIMEOUT_MS });
	await tab.locator('img[src^="http"]').first().waitFor({ timeout: 30_000 });
	await shot('04-saved.png');

	const mutations = await tab.evaluate(() => window.forgeMutations || []);
	const update = mutations.find((m) => m.type === 'setMultipleRecordsCellValues');
	const cells = update?.records?.[0]?.cellValuesByFieldId || {};
	const glbUrl = cells.fldModel?.[0]?.url;
	if (!glbUrl || !/\.glb$/.test(glbUrl)) problems.push(`no GLB written to the model field: ${JSON.stringify(cells)}`);
	if (cells.fldStatus !== 'Done') problems.push(`status field is ${JSON.stringify(cells.fldStatus)}, expected "Done"`);
	if (glbUrl) {
		const head = await fetch(glbUrl, { method: 'HEAD' });
		if (!head.ok) problems.push(`GLB ${glbUrl} answered ${head.status}`);
		console.log(`GLB ${glbUrl} -> ${head.status} ${head.headers.get('content-type')}`);
	}
	console.log(`3D page: ${cells.fldPage}`);
	console.log(`Progress captured: ${progress ? 'yes' : 'no (finished before a 3s progress frame painted)'}`);
	console.log(`Forge exchanges: ${exchanges.join(', ')}`);
	if (handled429) console.log(`Rate-limit answers waited out and retried: ${handled429}`);
	console.log(`Generated and saved in ${Math.round((Date.now() - started) / 1000)}s`);
} catch (error) {
	problems.push(`flow failed: ${error.message.split('\n')[0]}`);
	await shot('error.png').catch(() => {});
} finally {
	await browser.close();
	server.close();
}

if (problems.length) {
	exitCode = 1;
	console.error(problems.join('\n'));
} else {
	console.log('Airtable extension browser check passed: no console errors, model saved to the record.');
	if (SHOTS) console.log(`Screenshots in ${SHOTS}`);
}
process.exit(exitCode);
