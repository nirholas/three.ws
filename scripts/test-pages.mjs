#!/usr/bin/env node
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout as wait } from 'timers/promises';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

// Routes to visit. Some need params (template pages) — pass a placeholder
// agent id so they can boot.
const SAMPLE_AGENT = '0xdeadbeef';
const ROUTES = [
	'/',
	'/app',
	'/home',
	'/create',
	'/profile',
	'/login',
	`/agent/${SAMPLE_AGENT}`,
	`/agent/${SAMPLE_AGENT}/edit`,
	`/agent/${SAMPLE_AGENT}/embed`,
	'/agents',
	'/dashboard',
	'/studio',
	'/widgets',
	'/docs',
	'/docs/widgets',
	'/cz',
	'/validation',
	'/hydrate',
	'/my-agents',
	'/discover',
	'/explore',
	'/features',
	'/embed.html?src=/avatar/avatar.glb',
	`/reputation/?agent=1:${SAMPLE_AGENT}`,
	'/embed-test.html',
	'/avatar-page.html',
	'/avatar-artifact.html',
	'/agent-embed.html',
	'/a-edit.html',
	'/a-embed.html',
];

// Dev-only failure patterns to ignore (CDN URLs, third-party CORS, etc).
// These work in production but not when running `vite dev` against localhost.
const IGNORE_PATTERNS = [
	/three\.ws\/.*agent-3d/, // hardcoded prod CDN URL
	/ajax\.googleapis\.com/, // CDN script
	/esm\.sh/, // CDN module
	/marketplace\.olas\.network/, // third-party API, no CORS for localhost
	/blocked by CORS policy/,
	/three\.ws\/dist-lib/,
	/localhost:\d+\/api\//, // serverless functions need `vercel dev`, not `vite dev`
	/\/wallet\/connect-button.*\.js/, // cascades from esm.sh import in connect-button.js
	/\/node_modules\/vite\/dist\/client\/env\.mjs/, // Vite dev injection 404s in some flows
	/rpc\.\d+\.io/, // placeholder RPC URL from sample agent IDs
];

function shouldIgnore(text) {
	return IGNORE_PATTERNS.some((re) => re.test(text));
}

function startServer() {
	const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, FORCE_COLOR: '0' },
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('vite did not start in 30s')), 30000);
		proc.stdout.on('data', (d) => {
			if (String(d).includes('ready in') || String(d).includes('Local:')) {
				clearTimeout(timer);
				resolve(proc);
			}
		});
		proc.stderr.on('data', (d) => process.stderr.write(d));
		proc.on('exit', (code) => {
			if (code !== 0) reject(new Error(`vite exited with code ${code}`));
		});
	});
}

async function checkRoute(browser, route) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const errors = [];
	const failures = [];
	page.on('pageerror', (err) => {
		const msg = `pageerror: ${err.message}`;
		if (!shouldIgnore(msg)) errors.push(msg);
	});
	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		const text = msg.text();
		// "Failed to load resource: …" is a cascade message from a failed
		// request — the actual URL is already captured by requestfailed/response
		// handlers below, where ignore patterns can be applied properly.
		if (text.startsWith('Failed to load resource')) return;
		const formatted = `console.error: ${text}`;
		if (!shouldIgnore(formatted)) errors.push(formatted);
	});
	page.on('requestfailed', (req) => {
		const url = req.url();
		if (url.startsWith('chrome-extension://')) return;
		if (shouldIgnore(url)) return;
		failures.push(`requestfailed: ${url} — ${req.failure()?.errorText}`);
	});
	page.on('response', (res) => {
		const url = res.url();
		if (res.status() >= 400 && !url.includes('favicon') && !shouldIgnore(url)) {
			failures.push(`http ${res.status()}: ${url}`);
		}
	});
	let loadError = null;
	try {
		const resp = await page.goto(`${BASE}${route}`, {
			waitUntil: 'load',
			timeout: 15000,
		});
		// Give async boot code a moment to throw before we close the page.
		await wait(1500);
		if (!resp || resp.status() >= 400) {
			loadError = `nav status ${resp?.status() ?? 'none'}`;
		}
	} catch (e) {
		loadError = e.message;
	}
	await ctx.close();
	return { route, loadError, errors, failures };
}

async function main() {
	console.log(`Starting vite on :${PORT}…`);
	const server = await startServer();
	let browser;
	let exitCode = 0;
	try {
		browser = await chromium.launch();
		console.log(`Checking ${ROUTES.length} routes…\n`);
		const results = [];
		for (const route of ROUTES) {
			const r = await checkRoute(browser, route);
			results.push(r);
			const issues = r.errors.length + r.failures.length + (r.loadError ? 1 : 0);
			const tag = issues === 0 ? 'OK ' : 'FAIL';
			console.log(`  [${tag}] ${route} (${issues} issue${issues === 1 ? '' : 's'})`);
		}
		console.log('\n--- Detail ---');
		for (const r of results) {
			if (!r.loadError && r.errors.length === 0 && r.failures.length === 0) continue;
			exitCode = 1;
			console.log(`\n${r.route}`);
			if (r.loadError) console.log(`  load: ${r.loadError}`);
			for (const e of r.errors) console.log(`  ${e}`);
			for (const f of r.failures) console.log(`  ${f}`);
		}
		const totalIssues = results.reduce(
			(n, r) => n + r.errors.length + r.failures.length + (r.loadError ? 1 : 0),
			0,
		);
		console.log(`\nDone. ${totalIssues} issue(s) across ${ROUTES.length} routes.`);
	} finally {
		if (browser) await browser.close();
		server.kill('SIGTERM');
	}
	process.exit(exitCode);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
