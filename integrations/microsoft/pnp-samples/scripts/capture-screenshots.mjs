#!/usr/bin/env node
// Captures the 1920x1080 gallery screenshots for the three staged PnP samples
// from the samples' own code and live three.ws data. Nothing is mocked.
//
//   copilot   the API plugin's own response_semantics static_template (from
//             ai-plugin.json), filled by adaptivecards-templating with the real
//             /api/catalog response and drawn by the Adaptive Cards renderer
//   teams     the cards the message extension returns (compiled src/cards.ts)
//             for real catalog and agent results, drawn by the Adaptive Cards
//             renderer, plus the stage view page the "View in 3D" action opens
//   spfx      the web part bundle from the built .sppkg, mounted in the SPFx
//             host stand-in kept in integrations/microsoft/sharepoint-spfx
//
// Teams Copilot and SharePoint render these surfaces inside Microsoft chrome
// that needs a tenant; these captures show the same cards and bundles in a
// neutral frame. A gallery maintainer may ask for a tenant screenshot, and the
// owner can swap one in over the same file name.
//
// Usage (run each sample's own build first, see README.md in this folder):
//   node scripts/capture-screenshots.mjs --teams-dist <dist dir of msgext-threews-3d-models-ts> \
//        --sppkg <react-threews-3d-viewer.sppkg> --spfx-dir <the built SPFx sample folder, for its React 18 UMD files>
// Screenshots are written into each sample's assets/ folder.

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const repo = resolve(root, '..', '..', '..');
const require = createRequire(join(repo, 'package.json'));
const ORIGIN = 'https://three.ws';
const SIZE = { width: 1920, height: 1080 };

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : undefined;
}

const COPILOT_ASSETS = join(root, 'copilot-pro-dev-samples', 'da-threews-3d-studio', 'assets');
const TEAMS_ASSETS = join(root, 'teams-dev-samples', 'msgext-threews-3d-models-ts', 'assets');
const SPFX_ASSETS = join(root, 'sp-dev-fx-webparts', 'react-threews-3d-viewer', 'assets');

async function getJson(path) {
	const res = await fetch(`${ORIGIN}${path}`);
	if (!res.ok) throw new Error(`${path} answered ${res.status}`);
	return res.json();
}

const FRAME_CSS = `
	body{margin:0;background:#f5f5f5;font-family:'Segoe UI',system-ui,sans-serif;color:#242424}
	.bar{height:56px;background:#464775;color:#fff;display:flex;align-items:center;padding:0 28px;font-size:20px;font-weight:600}
	.stage{display:flex;gap:32px;padding:40px 56px;align-items:flex-start;flex-wrap:wrap}
	.col{width:560px}
	.who{font-size:15px;color:#616161;margin:0 0 8px}
	.bubble{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.18);padding:16px}
	.prompt{background:#e8ebfa;border-radius:8px;padding:14px 18px;font-size:18px;margin-bottom:24px;max-width:900px}
	.note{font-size:14px;color:#616161;margin-top:28px;padding:0 56px}
`;

async function cardPage(browser, { title, prompt, cards, note }) {
	const page = await browser.newPage({ viewport: SIZE });
	await page.setContent(`<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style>
		<div class="bar">${title}</div>
		<div class="stage"><div style="width:100%"><div class="prompt">${prompt}</div></div>
		${cards.map((_, i) => `<div class="col"><div class="bubble" id="card${i}"></div></div>`).join('')}</div>
		<div class="note">${note}</div>`);
	await page.addScriptTag({ path: require.resolve('adaptivecards/dist/adaptivecards.min.js') });
	await page.evaluate((payloads) => {
		/* global AdaptiveCards */
		payloads.forEach((payload, i) => {
			const card = new AdaptiveCards.AdaptiveCard();
			card.hostConfig = new AdaptiveCards.HostConfig({ fontFamily: "'Segoe UI', system-ui, sans-serif", spacing: { padding: 4 } });
			card.parse(payload);
			document.getElementById(`card${i}`).appendChild(card.render());
		});
	}, cards);
	await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30000 });
	return page;
}

async function copilot(browser) {
	const plugin = JSON.parse(readFileSync(join(root, 'copilot-pro-dev-samples', 'da-threews-3d-studio', 'appPackage', 'ai-plugin.json'), 'utf8'));
	const fn = plugin.functions.find((f) => f.name === 'searchModels');
	const template = fn.capabilities.response_semantics.static_template;
	const data = await getJson('/api/catalog?kind=object&limit=3&q=chair');
	const { Template } = require('adaptivecards-templating');
	const cards = data.items.slice(0, 3).map((item) => new Template(template).expand({ $root: item }));
	const page = await cardPage(browser, {
		title: 'Microsoft 365 Copilot: three.ws 3D Studio',
		prompt: 'Find free chair models I can put in a deck',
		cards,
		note: 'Response cards from the searchModels operation of the three.ws API plugin, filled with live results from https://three.ws/api/catalog.',
	});
	mkdirSync(COPILOT_ASSETS, { recursive: true });
	await page.screenshot({ path: join(COPILOT_ASSETS, 'search-models-card.png') });
	await page.close();
	console.log('copilot: search-models-card.png');
}

async function teams(browser, dist) {
	if (!dist || !existsSync(join(dist, 'cards.js'))) throw new Error('pass --teams-dist <dist dir> after `npm ci && npm run build` in the Teams sample');
	const { modelCard, agentCard } = await import(pathToFileURL(join(dist, 'cards.js')).href);
	const { searchModels, searchAgents, viewerUrl } = await import(pathToFileURL(join(dist, 'threews.js')).href);
	const models = await searchModels('chair', 2);
	const agents = await searchAgents('assistant', 8);
	const agent = agents.find((a) => a.avatarModelUrl) || agents[0];
	const cards = [...models.map((m) => modelCard(m)), agentCard(agent)].map((c) => JSON.parse(JSON.stringify(c)));
	const page = await cardPage(browser, {
		title: 'Microsoft Teams: three.ws 3D models message extension',
		prompt: '@three.ws 3D models: chair',
		cards,
		note: 'Cards returned by the message extension (src/cards.ts) for live results from https://three.ws. View in 3D opens the stage view.',
	});
	mkdirSync(TEAMS_ASSETS, { recursive: true });
	await page.screenshot({ path: join(TEAMS_ASSETS, 'message-extension-cards.png') });
	await page.close();

	const stage = await browser.newPage({ viewport: SIZE });
	await stage.goto(viewerUrl(models[0].glbUrl, models[0].title), { waitUntil: 'load', timeout: 60000 });
	await stage.waitForTimeout(12000);
	await stage.screenshot({ path: join(TEAMS_ASSETS, 'stage-view.png') });
	await stage.close();
	console.log('teams: message-extension-cards.png, stage-view.png');
}

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

function readZip(buffer) {
	const files = new Map();
	let eocd = buffer.length - 22;
	while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
	if (eocd < 0) throw new Error('not a zip file');
	let offset = buffer.readUInt32LE(eocd + 16);
	const count = buffer.readUInt16LE(eocd + 10);
	const zlib = require('node:zlib');
	for (let i = 0; i < count; i++) {
		const method = buffer.readUInt16LE(offset + 10);
		const compressed = buffer.readUInt32LE(offset + 20);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const local = buffer.readUInt32LE(offset + 42);
		const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
		const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
		const raw = buffer.subarray(dataStart, dataStart + compressed);
		files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return files;
}

async function spfx(browser, sppkg, spfxDir) {
	const reactUmd = spfxDir && join(spfxDir, 'node_modules', 'react', 'umd', 'react.production.min.js');
	const reactDomUmd = spfxDir && join(spfxDir, 'node_modules', 'react-dom', 'umd', 'react-dom.production.min.js');
	if (!reactUmd || !existsSync(reactUmd)) throw new Error('pass --spfx-dir <SPFx sample folder> after `npm install` there');
	if (!sppkg || !existsSync(sppkg)) throw new Error('pass --sppkg <path to react-threews-3d-viewer.sppkg> after `npm run build` in the SPFx sample');
	const harnessDir = join(repo, 'integrations', 'microsoft', 'sharepoint-spfx', 'scripts', 'harness');
	const assets = new Map();
	for (const [name, bytes] of readZip(readFileSync(sppkg))) {
		if (name.startsWith('ClientSideAssets/')) assets.set(name.slice('ClientSideAssets/'.length), bytes);
	}
	const acDir = join(repo, 'integrations', 'microsoft', 'sharepoint-spfx', 'node_modules');
	const acPath = (pkg, file) => join(dirname(require.resolve(`${pkg}/package.json`, { paths: [acDir, repo] })), 'dist', file);
	const vendor = {
		'/vendor/adaptivecards.min.js': acPath('adaptivecards', 'adaptivecards.min.js'),
		'/vendor/adaptivecards-templating.min.js': acPath('adaptivecards-templating', 'adaptivecards-templating.min.js'),
		'/vendor/react.js': reactUmd,
		'/vendor/react-dom.js': reactDomUmd,
	};
	const port = Number(process.env.CAPTURE_PORT || 3143);
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://localhost:${port}`);
		const send = (status, body, type, extra = {}) => {
			res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
			res.end(body);
		};
		if (url.pathname === '/') {
			return send(200, readFileSync(join(harnessDir, 'page.html')), TYPES['.html'], {
				'content-security-policy': `script-src 'unsafe-eval' ${ORIGIN}/agent-3d/ 'self' https://res-1.cdn.office.net 'unsafe-inline'`,
			});
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
	await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
	try {
		const model = (await getJson('/api/catalog?kind=object&limit=1&q=chair')).items[0];
		const page = await browser.newPage({ viewport: SIZE });
		await page.goto(`http://localhost:${port}/`);
		// The React UMD builds register with an AMD loader when one exists, so load them
		// while the host's AMD define is set aside, then hand them over as externals.
		await page.evaluate(() => {
			window.__hostDefine = window.define;
			window.define = undefined;
		});
		await page.addScriptTag({ url: '/vendor/react.js' });
		await page.addScriptTag({ url: '/vendor/react-dom.js' });
		await page.evaluate(() => {
			window.define = window.__hostDefine;
			window.__harnessExternals = { react: window.React, 'react-dom/client': window.ReactDOM };
		});
		await page.evaluate(
			(props) => window.__harness.mountWebPart({ bundle: 'threews-3d-viewer-web-part', title: 'three.ws 3D Viewer', properties: props }),
			{ modelUrl: model.url, title: model.title, displayMode: 'viewer', height: 640 }
		);
		await page.waitForSelector('[data-bundle] iframe', { timeout: 60000 });
		await page.waitForTimeout(15000);
		mkdirSync(SPFX_ASSETS, { recursive: true });
		await page.screenshot({ path: join(SPFX_ASSETS, 'web-part.png') });
		await page.close();
	} finally {
		server.close();
	}
	console.log('spfx: web-part.png');
}

const { chromium } = require('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
	await copilot(browser);
	await teams(browser, arg('teams-dist'));
	await spfx(browser, arg('sppkg'), arg('spfx-dir'));
} finally {
	await browser.close();
}
