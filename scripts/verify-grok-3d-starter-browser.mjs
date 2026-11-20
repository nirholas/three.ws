#!/usr/bin/env node
// Drive satellites/grok-3d-starter in a real browser against its real server
// and fail on any console error. The script starts the starter itself, once
// per key setup, and checks what a visitor sees:
//
//   1. no keys:        the setup panel names both keys, where to create them,
//                      and the .env line; the chat is not shown.
//   2. a rejected xAI key with a working three.ws key: xAI's live refusal
//                      shows as "xAI did not accept the API key".
//   3. a real GLB:     a model made through the three.ws MCP server (with the
//                      three.ws key) opened with ?glb= renders on the stage,
//                      with the download button, viewer link and version strip.
//
// Each view is captured at desktop width and at 360px. Keys are read from the
// environment or the monorepo .env and are never printed.
//
// Usage:
//   node scripts/verify-grok-3d-starter-browser.mjs --glb <https GLB url> [--label name] [--port 3286] [--out dir]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(REPO, 'satellites', 'grok-3d-starter');
const arg = (name, def = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const port = Number(arg('port', 3286));
const out = resolve(arg('out', 'grok-3d-starter-shots'));
const glb = arg('glb');
const timeout = Number(arg('timeout', 60_000)) || 60_000;
if (!glb || !glb.startsWith('https://')) {
	console.error('Pass --glb <https GLB url>, for example one printed by npm run live:three-ws in the starter.');
	process.exit(2);
}
mkdirSync(out, { recursive: true });

function envValue(name) {
	if (process.env[name]) return process.env[name];
	const file = join(REPO, '.env');
	if (!existsSync(file)) return '';
	const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
	return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}
const threeWsKey = envValue('THREE_WS_API_KEY');
if (!threeWsKey) {
	console.error('THREE_WS_API_KEY is not set in the environment or .env; views 2 and 3 need it.');
	process.exit(2);
}

const problems = [];
const checks = [];
const check = (ok, label) => {
	checks.push({ ok, label });
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
	if (!ok) problems.push(label);
};

async function startServer(keys) {
	const child = spawn(process.execPath, ['server.mjs'], {
		cwd: APP,
		env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), XAI_API_KEY: '', THREE_WS_API_KEY: '', ...keys },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let log = '';
	child.stdout.on('data', (d) => (log += d));
	child.stderr.on('data', (d) => (log += d));
	const deadline = Date.now() + 15_000;
	for (;;) {
		try {
			if ((await fetch(`http://localhost:${port}/healthz`)).ok) break;
		} catch {
			if (Date.now() > deadline) throw new Error(`the starter did not come up on ${port}:\n${log}`);
			if (child.exitCode !== null) throw new Error(`the starter exited:\n${log}`);
			await delay(200);
		}
	}
	for (const secret of Object.values(keys).filter(Boolean)) {
		if (log.includes(secret)) problems.push('the server printed a key to its log');
	}
	return { stop: () => new Promise((r) => (child.exitCode !== null ? r() : (child.once('exit', r), child.kill('SIGTERM')))) };
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(path, viewport, label) {
	const page = await browser.newPage({ viewport });
	page.setDefaultTimeout(timeout);
	page.on('console', (msg) => {
		if (msg.type() !== 'error' && msg.type() !== 'warning') return;
		const text = msg.text();
		// Software-GL driver chatter, not the page.
		if (/GPU stall|ReadPixels|WebGL-|swiftshader|GroupMarkerNotSet/i.test(text)) return;
		problems.push(`${label} [${msg.type()}] ${text}`);
	});
	page.on('pageerror', (err) => problems.push(`${label} [pageerror] ${err.message}`));
	page.on('requestfailed', (req) => problems.push(`${label} [requestfailed] ${req.url()} ${req.failure()?.errorText}`));
	await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'domcontentloaded' });
	return page;
}

const VIEWPORTS = [
	['desktop', { width: 1440, height: 900 }],
	['360', { width: 360, height: 780 }],
];

async function noHorizontalScroll(page) {
	return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

// 1. No keys.
{
	const server = await startServer({});
	for (const [name, viewport] of VIEWPORTS) {
		const page = await open('/', viewport, `no-keys ${name}`);
		await page.waitForSelector('#setup:not([hidden])');
		const text = await page.locator('#setup').innerText();
		check(text.includes('xAI API key') && text.includes('three.ws API key'), `no keys (${name}): setup panel names both keys`);
		check(/XAI_API_KEY=/.test(text) && /THREE_WS_API_KEY=/.test(text), `no keys (${name}): setup panel shows both .env lines`);
		check(/console\.x\.ai/.test(text) && /three\.ws\/dashboard\/api-keys/.test(text), `no keys (${name}): setup panel says where to create each key`);
		check(/free/i.test(text) && /account/i.test(text), `no keys (${name}): setup panel says a free three.ws account is required`);
		check(await page.locator('#chat').isHidden(), `no keys (${name}): chat is not shown`);
		check(await noHorizontalScroll(page), `no keys (${name}): no horizontal scroll`);
		await page.screenshot({ path: join(out, `1-setup-no-keys-${name}.png`), fullPage: true });
		await page.close();
	}
	await server.stop();
}

// 2. A rejected xAI key (xAI's live answer) with a working three.ws key.
{
	const madeUp = `xai-verify${Date.now().toString(36)}notarealkey`;
	const server = await startServer({ XAI_API_KEY: madeUp, THREE_WS_API_KEY: threeWsKey });
	for (const [name, viewport] of VIEWPORTS) {
		const page = await open('/', viewport, `xai-rejected ${name}`);
		await page.waitForSelector('#setup-problem:not([hidden])');
		const card = await page.locator('#setup-problem').innerText();
		check(card.includes('xAI did not accept the API key'), `rejected xAI key (${name}): error card title`);
		check(/XAI_API_KEY/.test(card), `rejected xAI key (${name}): the card names XAI_API_KEY in its fix`);
		const keys = await page.locator('#setup-keys').innerText();
		check(/Rejected/.test(keys) && !/three\.ws API key[\s\S]*Missing/.test(keys), `rejected xAI key (${name}): only the xAI key is flagged`);
		check(!(await page.content()).includes(madeUp) && !(await page.content()).includes(threeWsKey), `rejected xAI key (${name}): no key in the page`);
		const recheck = page.locator('#setup-recheck');
		await recheck.focus();
		check(await recheck.evaluate((b) => getComputedStyle(b).outlineStyle !== 'none' || getComputedStyle(b).boxShadow !== 'none'), `rejected xAI key (${name}): Check again has a focus ring`);
		await page.screenshot({ path: join(out, `2-xai-rejected-${name}.png`), fullPage: true });
		await page.close();
	}
	const status = await (await fetch(`http://localhost:${port}/api/status`)).json();
	check(['xai_bad_key', 'xai_unauthorized'].includes(status.problem?.code) && status.checks?.threeWs?.ok === true, `rejected xAI key: /api/status reports ${status.problem?.code}, three.ws key accepted`);
	await server.stop();
}

// 3. A real GLB on the stage.
{
	const server = await startServer({ THREE_WS_API_KEY: threeWsKey });
	const viewer = `https://three.ws/viewer?src=${encodeURIComponent(glb)}`;
	const query = `/?glb=${encodeURIComponent(glb)}&label=${encodeURIComponent(arg('label', 'Robot mascot: make it chrome'))}&viewer=${encodeURIComponent(viewer)}`;
	for (const [name, viewport] of VIEWPORTS) {
		const page = await open(query, viewport, `glb ${name}`);
		const started = Date.now();
		await page.waitForFunction(() => /^Download GLB \(/.test(document.getElementById('download')?.textContent || ''), null, { timeout });
		check(true, `glb (${name}): model downloaded and parsed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
		check(await page.locator('#stage-error').isHidden(), `glb (${name}): no stage error`);
		check(await page.locator('#stage-loading').isHidden(), `glb (${name}): loading state cleared`);
		check((await page.locator('#versions-list').locator('button, li').count()) >= 1, `glb (${name}): version strip lists the model`);
		check((await page.locator('#stage-title').innerText()).trim().length > 0, `glb (${name}): stage title shows the label`);
		check((await page.locator('#viewer-link').isVisible()) && (await page.locator('#viewer-link').getAttribute('href')) === viewer, `glb (${name}): viewer link opens the model on three.ws`);
		check(await noHorizontalScroll(page), `glb (${name}): no horizontal scroll`);
		// Two rendered frames after the load, so the capture shows the lit model.
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		await page.screenshot({ path: join(out, `3-glb-${name}.png`), fullPage: true });
		await page.close();
	}
	await server.stop();
}

await browser.close();
console.log(`\nscreenshots: ${out}`);
if (problems.length) {
	console.error(`\n${problems.length} problem(s):`);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log(`PASS: ${checks.length} checks, no console errors or warnings.`);
