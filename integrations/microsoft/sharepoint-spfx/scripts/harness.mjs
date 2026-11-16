#!/usr/bin/env node
/**
 * Headless render check for the built .sppkg.
 *
 * Serves the exact ClientSideAssets bytes from sharepoint/solution/*.sppkg to
 * the SPFx host stand-in in scripts/harness/ under the Content Security
 * Policy SharePoint Online sends on modern pages (script-src only, with
 * 'unsafe-eval', 'self', a nonce and the tenant's Trusted script sources),
 * then drives both web parts and the Viva Connections card in Chromium
 * against live three.ws data:
 *
 *   agent web part   setup state, property pane search (results, empty),
 *                    pick a real agent, live <agent-3d>, strong theme
 *                    variant, unknown agent error state, click-to-load poster
 *   model web part   Forge search and pick, live model, direct GLB URL
 *   agent card       ready card from a real agent, quick view
 *   CSP              runtime refused when the trusted source is missing,
 *                    and the web part names the exact entry to add
 *
 * Fails (exit 1) on any console error, page error, CSP violation in the
 * trusted runs, or a state that never appears. Screenshots and report.json
 * land in harness-output/ (gitignored).
 *
 *   node scripts/harness.mjs            run every scenario headless
 *   node scripts/harness.mjs --serve    only serve http://localhost:3135
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PACKAGE_ROOT, defaultPackagePath, readZip } from './lib/sppkg.mjs';

const PORT = Number(process.env.HARNESS_PORT || 3135);
const ORIGIN = 'https://three.ws';
const OUT = join(PACKAGE_ROOT, 'harness-output');
const require = createRequire(join(PACKAGE_ROOT, 'package.json'));

const runtimeSource = readFileSync(join(PACKAGE_ROOT, 'src/lib/runtime.ts'), 'utf8');
const RUNTIME_VERSION = /RUNTIME_VERSION = '([^']+)'/.exec(runtimeSource)[1];
const TRUSTED_SOURCE = `${ORIGIN}/agent-3d/${RUNTIME_VERSION}/`;

/** The script-src SharePoint Online emits (Microsoft Learn, "Support for CSP in SharePoint Online"). */
function sharePointCsp(trusted) {
	const nonce = randomBytes(9).toString('base64url');
	const sources = ["'unsafe-eval'", ...(trusted ? [TRUSTED_SOURCE] : []), "'self'", 'https://res-1.cdn.office.net', 'https://public-cdn.sharepointonline.com', `'nonce-${nonce}'`];
	return `script-src ${sources.join(' ')}`;
}

function loadPackage() {
	const path = defaultPackagePath();
	if (!existsSync(path)) {
		console.error(`No package at ${path}. Run npm run package:sharepoint first.`);
		process.exit(1);
	}
	const files = readZip(readFileSync(path));
	const assets = new Map();
	for (const [name, bytes] of files) {
		if (name.startsWith('ClientSideAssets/')) assets.set(name.slice('ClientSideAssets/'.length), bytes);
	}
	if (!assets.size) throw new Error(`${path} has no ClientSideAssets; includeClientSideAssets must be true`);
	return { path, assets };
}

function vendorFile(pkg, file) {
	return join(dirname(require.resolve(`${pkg}/package.json`)), 'dist', file);
}

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

function startServer({ assets }) {
	const state = { trusted: true };
	const vendor = {
		'/vendor/adaptivecards.min.js': vendorFile('adaptivecards', 'adaptivecards.min.js'),
		'/vendor/adaptivecards-templating.min.js': vendorFile('adaptivecards-templating', 'adaptivecards-templating.min.js'),
	};
	const harnessDir = join(PACKAGE_ROOT, 'scripts/harness');
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://localhost:${PORT}`);
		const send = (status, body, type) => {
			res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
			res.end(body);
		};
		if (url.pathname === '/' || url.pathname === '/index.html') {
			res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store', 'content-security-policy': sharePointCsp(state.trusted) });
			res.end(readFileSync(join(harnessDir, 'page.html')));
			return;
		}
		if (url.pathname === '/harness/assets.json') return send(200, JSON.stringify([...assets.keys()]), TYPES['.json']);
		if (url.pathname === '/harness/host.js' || url.pathname === '/harness/host.css') {
			return send(200, readFileSync(join(harnessDir, url.pathname.slice('/harness/'.length))), TYPES[extname(url.pathname)]);
		}
		if (url.pathname.startsWith('/assets/')) {
			const bytes = assets.get(decodeURIComponent(url.pathname.slice('/assets/'.length)));
			if (bytes) return send(200, bytes, TYPES[extname(url.pathname)] || 'application/octet-stream');
		}
		if (vendor[url.pathname]) return send(200, readFileSync(vendor[url.pathname]), TYPES['.js']);
		send(404, 'Not found', 'text/plain');
	});
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(PORT, '127.0.0.1', () => resolve({ server, state }));
	});
}

async function fetchJson(path) {
	const res = await fetch(`${ORIGIN}${path}`);
	if (!res.ok) throw new Error(`${path} answered ${res.status}`);
	return res.json();
}

/** A live public agent with a 3D body and a poster, found the way the picker finds it. */
async function pickLiveAgent() {
	const { agents } = await fetchJson('/api/agents/public?limit=50');
	const agent = agents.find((a) => a.avatar_model_url && a.avatar_thumbnail && /^[\w .'-]{3,40}$/.test(a.name || ''));
	if (!agent) throw new Error('No public agent with a body and poster on three.ws right now');
	return agent;
}

const checks = [];
function check(name, ok, detail = '') {
	checks.push({ name, ok: !!ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function run() {
	const pkg = loadPackage();
	const { server, state } = await startServer(pkg);
	const base = `http://localhost:${PORT}/`;
	if (process.argv.includes('--serve')) {
		console.log(`Harness serving ${pkg.path} at ${base}`);
		return;
	}
	mkdirSync(OUT, { recursive: true });
	const { chromium } = require('playwright');
	const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
	const shots = [];
	const consoleErrors = [];
	const agent = await pickLiveAgent();
	console.log(`Live agent: ${agent.name} (${agent.id})`);

	async function newPage({ reducedMotion = 'no-preference' } = {}) {
		const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion });
		const page = await context.newPage();
		page.on('console', (msg) => {
			if (msg.type() === 'error') consoleErrors.push({ url: page.url(), text: msg.text() });
		});
		page.on('pageerror', (err) => consoleErrors.push({ url: page.url(), text: `pageerror: ${err.message}` }));
		await page.goto(base);
		await page.waitForFunction(() => window.__harness).then(() => page.evaluate(() => window.__harness.ready));
		return page;
	}
	async function shot(page, name) {
		const file = join(OUT, `${name}.png`);
		await page.screenshot({ path: file });
		shots.push(file);
	}
	const violations = (page) => page.evaluate(() => window.__harness.log.violations);
	const agentReady = (page, timeout = 120000) =>
		page.waitForFunction(
			() => {
				const node = document.querySelector('agent-3d');
				return node && !node.parentElement.querySelector('[role=status]');
			},
			null,
			{ timeout },
		);

	try {
		// Agent web part ------------------------------------------------------
		state.trusted = true;
		let page = await newPage();
		await page.evaluate(() => window.__harness.mountWebPart({ bundle: 'three-ws-agent-web-part', title: 'three.ws Agent', properties: { height: 520, background: 'transparent', framing: 'full', autoplay: true, chat: true, namePlate: true } }));
		const setup = page.getByRole('button', { name: 'Choose an agent' });
		await setup.waitFor();
		check('agent web part renders the setup state in edit mode', await setup.isVisible());
		await shot(page, '01-agent-setup');

		await setup.click();
		const combo = page.locator('#pane [role=combobox]');
		await combo.waitFor();
		check('setup button opens the property pane with the agent search', await combo.isVisible());
		await combo.fill('zzqxv no such agent 9137');
		await page.getByText('No agents match').waitFor({ timeout: 20000 });
		check('picker shows the empty state for a query with no agents', true);
		await shot(page, '02-agent-picker-empty');

		await combo.fill(agent.name);
		const option = page.locator('#pane [role=option]', { hasText: agent.name }).first();
		await option.waitFor({ timeout: 20000 });
		check('picker lists live agents from /api/agents/public', await page.locator('#pane [role=option]').count(), `${await page.locator('#pane [role=option]').count()} results for "${agent.name}"`);
		await shot(page, '03-agent-picker-results');
		await option.click();
		const props = await page.evaluate(() => window.__harness.properties());
		check('choosing an agent stores its id and name', props.agentId === agent.id && props.agentName === agent.name, props.agentId);
		await page.evaluate(() => window.__harness.closePane());
		await agentReady(page);
		const attrs = await page.evaluate(() => {
			const n = document.querySelector('agent-3d');
			return { id: n.getAttribute('agent-id'), chat: n.getAttribute('chat'), canvas: !!(n.shadowRoot || n).querySelector('canvas') };
		});
		check('live <agent-3d> mounts for the chosen agent and finishes loading', attrs.id === agent.id, `chat=${attrs.chat} canvas=${attrs.canvas}`);
		check('runtime loads under the SharePoint CSP with the documented trusted source', (await violations(page)).length === 0, JSON.stringify(await violations(page)));
		await page.waitForTimeout(1500);
		await shot(page, '04-agent-live');

		await page.evaluate(() => window.__harness.setTheme('strong'));
		const strongText = await page.evaluate(() => document.querySelector('[data-bundle]').style.getPropertyValue('--tw-text'));
		check('strong section theme variant re-themes the web part', strongText.trim() === '#ffffff', `--tw-text ${strongText}`);
		await shot(page, '05-agent-theme-strong');
		await page.evaluate(() => window.__harness.setTheme('neutral'));

		await page.evaluate(() => window.__harness.setProperty('agentId', '00000000-0000-4000-8000-000000000000'));
		const alert = page.getByRole('alert');
		await alert.waitFor({ timeout: 20000 });
		check('unknown agent id shows an actionable error with a retry', await page.getByRole('button', { name: 'Try again' }).isVisible(), (await alert.innerText()).split('\n')[0]);
		await shot(page, '06-agent-error');
		await page.context().close();

		// Click-to-load poster, reduced motion, read mode
		page = await newPage({ reducedMotion: 'reduce' });
		await page.evaluate((id) => window.__harness.mountWebPart({ bundle: 'three-ws-agent-web-part', title: 'three.ws Agent', displayMode: 'read', properties: { agentId: id, height: 480, background: 'light', framing: 'portrait', autoplay: false, chat: false, namePlate: true } }), agent.id);
		const play = page.getByRole('button', { name: new RegExp(`Meet the agent: ${agent.name}`) });
		await play.waitFor({ timeout: 20000 });
		check('autoplay off shows the poster and a labelled "Meet the agent" button', await page.locator('[data-bundle] img').count() > 0);
		check('nothing heavy loads before the click', (await page.locator('script[data-three-ws-runtime]').count()) === 0);
		await shot(page, '07-agent-poster');
		await play.click();
		await agentReady(page);
		check('click mounts the agent with chat off', (await page.locator('agent-3d').getAttribute('chat')) === 'off');
		await page.context().close();

		// Model web part ------------------------------------------------------
		page = await newPage();
		await page.evaluate(() => window.__harness.mountWebPart({ bundle: 'three-ws-model-web-part', title: 'three.ws 3D Model', properties: { height: 520, background: 'transparent', framing: 'full', autoplay: true, namePlate: true } }));
		await page.locator('[data-bundle] button').first().click();
		const modelCombo = page.locator('#pane [role=combobox]');
		await modelCombo.fill('robot');
		const modelOption = page.locator('#pane [role=option]').first();
		await modelOption.waitFor({ timeout: 20000 });
		check('model picker lists live Forge models from /api/search', true, `${await page.locator('#pane [role=option]').count()} results for "robot"`);
		await shot(page, '08-model-picker-results');
		await modelOption.click();
		const modelProps = await page.evaluate(() => window.__harness.properties());
		check('choosing a model stores its id and title', !!modelProps.modelRef && !!modelProps.modelName, `${modelProps.modelName} ${modelProps.modelRef}`);
		await page.evaluate(() => window.__harness.closePane());
		await agentReady(page);
		const body = await page.locator('agent-3d').getAttribute('body');
		check('live Forge model renders in the three.ws viewer', /^https:\/\/three\.ws\/cdn\/forge\/.+\.glb$/.test(body || ''), body);
		check('model web part loads with no CSP violation', (await violations(page)).length === 0, JSON.stringify(await violations(page)));
		await page.waitForTimeout(1500);
		await shot(page, '09-model-live');

		const glb = body;
		await page.evaluate((url) => window.__harness.setProperty('modelRef', url), glb);
		await page.evaluate(() => window.__harness.setProperty('modelName', ''));
		await agentReady(page);
		check('a direct https GLB URL renders', (await page.locator('agent-3d').getAttribute('body')) === glb);
		await page.context().close();

		// Viva Connections card -----------------------------------------------
		page = await newPage();
		await page.evaluate((id) => window.__harness.mountCard({ bundle: 'three-ws-agent-card-adaptive-card-extension', title: 'three.ws Agent card', properties: { title: 'Digital colleague', agentId: id, agentName: '' } }), agent.id);
		await page.waitForFunction(() => window.__harness.log.cardViews.some((v) => /:ready$/.test(v)), null, { timeout: 20000 });
		const header = await page.locator('.card-header').innerText();
		check('card reaches ready with the live agent name', header.includes(agent.name), header);
		check('card shows the agent poster', (await page.locator('.card-image').getAttribute('src')) === agent.avatar_thumbnail || (await page.locator('.card-image').count()) === 1);
		await shot(page, '10-card-ready');
		await page.locator('.card-button').click();
		await page.locator('.quickview').waitFor();
		check('card button opens the Adaptive Card quick view', (await page.locator('.quickview .ac-adaptiveCard').count()) === 1);
		await shot(page, '11-card-quickview');
		await page.evaluate(() => window.__harness.openPane());
		await page.locator('#pane [role=combobox]').waitFor();
		check('card property pane loads the deferred chunk and the agent search', true);
		await page.context().close();

		// CSP: trusted source missing ----------------------------------------
		state.trusted = false;
		page = await newPage();
		await page.evaluate((id) => window.__harness.mountWebPart({ bundle: 'three-ws-agent-web-part', title: 'three.ws Agent', properties: { agentId: id, height: 420, background: 'transparent', framing: 'full', autoplay: true, chat: true, namePlate: true } }), agent.id);
		const blocked = page.getByRole('alert');
		await blocked.waitFor({ timeout: 30000 });
		const text = await blocked.innerText();
		check('without the trusted source the runtime is refused by CSP', (await violations(page)).some((v) => v.blockedURI.startsWith(TRUSTED_SOURCE)));
		check('the web part names the exact Trusted script sources entry', text.includes(TRUSTED_SOURCE), text.split('\n')[0]);
		await shot(page, '12-csp-blocked');
		// The expected refusal is logged as a console error by the browser itself; it is the point of this run.
		for (let i = consoleErrors.length - 1; i >= 0; i--) if (consoleErrors[i].text.includes('Content Security Policy')) consoleErrors.splice(i, 1);
		await page.context().close();
		state.trusted = true;
	} catch (err) {
		check(`scenario completed: ${err.message.split('\n')[0]}`, false);
	} finally {
		await browser.close();
		server.close();
	}

	check('no console errors or page errors', consoleErrors.length === 0, consoleErrors.map((e) => e.text).join(' | ').slice(0, 400));
	const failed = checks.filter((c) => !c.ok);
	writeFileSync(join(OUT, 'report.json'), JSON.stringify({ package: pkg.path, agent: { id: agent.id, name: agent.name }, trustedSource: TRUSTED_SOURCE, checks, consoleErrors, screenshots: shots }, null, 2));
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${OUT}`);
	process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
