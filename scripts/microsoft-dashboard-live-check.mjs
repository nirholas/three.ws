#!/usr/bin/env node
// Live check of the Microsoft partnership board (/admin/microsoft) and its alert
// cron, through the real code: the real API server, the real cron handler, the
// real admin endpoint and the real page in a real browser.
//
//   npm run microsoft:dashboard-check
//
// What it proves:
//   1. A connector error rate over the threshold, written to the real
//      microsoft_surface_events table, opens exactly one incident and one
//      ops_alerts row through sendOpsAlert (the owner channel), and a second cron
//      tick sends nothing more.
//   2. The admin endpoint refuses an unauthenticated call and answers one that
//      carries the ops secret.
//   3. /admin/microsoft renders that board in Chromium on port 3121 (Vite dev
//      server proxying /api to the isolated API): the incident in the "needs
//      attention" list, the connector panel, and no console errors.
//   4. Once the failing traffic leaves the window the incident resolves.
//
// Isolation: an in-process Postgres with the production schema
// (scripts/lib/isolated-db.mjs) and a process env reduced to an allowlist, so
// nothing reaches Neon or any outside channel. The alert lands in the isolated
// ops_alerts table, the channel every deployment has; Telegram and email add to
// it when their variables are set on the service.

import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 3221;
const WEB_PORT = 3121;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const ENV_ALLOW = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|PLAYWRIGHT_BROWSERS_PATH)$/;
for (const k of Object.keys(process.env)) if (!ENV_ALLOW.test(k)) delete process.env[k];
const OPS_SECRET = crypto.randomBytes(24).toString('base64url');
const CRON_SECRET = crypto.randomBytes(24).toString('base64url');
Object.assign(process.env, {
	NODE_ENV: 'development',
	PORT: String(API_PORT),
	PUBLIC_APP_ORIGIN: API,
	DATABASE_URL: 'postgres://isolated.invalid/three',
	JWT_SECRET: crypto.randomBytes(32).toString('base64url'),
	CRON_SECRET,
	OPS_SECRET,
});

let failed = 0;
async function step(name, fn) {
	try {
		const detail = await fn();
		console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
	} catch (e) {
		failed += 1;
		console.log(`  FAIL  ${name}\n        ${e.message}`);
	}
}
const assert = (cond, msg) => {
	if (!cond) throw new Error(msg);
};
const eq = (a, b, what) => assert(JSON.stringify(a) === JSON.stringify(b), `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

function portInUse(port) {
	return new Promise((done) => {
		const s = net.connect(port, '127.0.0.1');
		s.once('connect', () => (s.destroy(), done(true)));
		s.once('error', () => done(false));
	});
}

async function waitFor(what, fn, ms = 60_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`timed out waiting for ${what}`);
}

async function main() {
	for (const p of [API_PORT, WEB_PORT]) {
		if (await portInUse(p)) throw new Error(`port ${p} is busy; stop whatever listens there and rerun`);
	}
	console.log('Microsoft partnership board: alert and render check on an isolated database\n');

	const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
	const { sql } = await useIsolatedDb();
	await import('../server/index.mjs');
	await waitFor('the API to listen', async () => (await fetch(`${API}/api/microsoft-marketplace/status`).catch(() => null))?.ok);

	const cron = () => fetch(`${API}/api/cron/microsoft-alerts`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });

	await step('quiet board opens no incident', async () => {
		const res = await cron();
		const body = await res.json();
		eq(res.status, 200, 'cron status');
		eq([body.active, body.opened], [0, []], 'cron result');
	});

	await step('connector 5xx rate over the threshold opens one incident and sends one alert', async () => {
		for (let i = 0; i < 30; i += 1) {
			const bad = i < 9;
			await sql`insert into microsoft_surface_events (surface, operation, status, latency_ms, source, error, created_at)
			          values ('power_platform', 'GenerateModel', ${bad ? 502 : 200}, ${120 + i}, 'header', ${bad ? 'upstream 502' : null}, now() - make_interval(mins => ${i}))`;
		}
		const body = await (await cron()).json();
		eq(body.opened, ['connector_error_rate'], 'opened');
		const alerts = await sql`select title, severity, count from ops_alerts`;
		eq(alerts.length, 1, 'ops_alerts rows');
		const open = await sql`select key from microsoft_alert_incidents where resolved_at is null`;
		eq(open.map((r) => r.key), ['connector_error_rate'], 'open incidents');
		return `${alerts[0].severity}: ${alerts[0].title}`;
	});

	await step('the next tick keeps the incident open and sends nothing', async () => {
		const body = await (await cron()).json();
		eq([body.opened, body.kept], [[], ['connector_error_rate']], 'second tick');
		const [{ count }] = await sql`select count from ops_alerts`;
		eq(Number(count), 1, 'alert count');
	});

	await step('admin API refuses a caller without credentials and answers the ops secret', async () => {
		eq((await fetch(`${API}/api/admin/microsoft`)).status, 401, 'unauthenticated status');
		const res = await fetch(`${API}/api/admin/microsoft`, { headers: { 'x-ops-secret': OPS_SECRET } });
		eq(res.status, 200, 'ops secret status');
		const board = await res.json();
		assert(JSON.stringify(board).includes('connector_error_rate'), 'board does not list the incident');
		return `keys ${Object.keys(board).slice(0, 6).join(', ')}`;
	});

	const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], {
		cwd: root,
		env: { ...process.env, DEV_API_PROXY: API },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let viteLog = '';
	vite.stdout.on('data', (d) => (viteLog += d));
	vite.stderr.on('data', (d) => (viteLog += d));
	let browser;
	try {
		await waitFor('the dev server', async () => (await fetch(`${WEB}/admin/microsoft`).catch(() => null))?.ok, 120_000);
		const { chromium } = await import('playwright');
		browser = await chromium.launch();
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-ops-secret': OPS_SECRET } });
		const page = await ctx.newPage();
		const problems = [];
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
		});
		page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

		await step('/admin/microsoft renders the incident, the connector panel and no console errors', async () => {
			await page.goto(`${WEB}/admin/microsoft`, { waitUntil: 'networkidle' });
			await page.waitForSelector('#msa-attention', { state: 'visible' });
			await waitFor('the attention list', async () => /connector/i.test(await page.locator('#msa-attention').innerText()), 20_000);
			const attention = await page.locator('#msa-attention').innerText();
			const panels = await page.locator('#msa-panels').innerText();
			assert(/connector/i.test(panels), 'connector panel missing');
			assert(/GenerateModel/.test(panels), 'connector operation GenerateModel missing from the panel');
			eq(problems, [], 'console problems');
			return `attention: ${attention.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 120)}`;
		});
	} finally {
		await browser?.close().catch(() => {});
		vite.kill('SIGTERM');
	}

	await step('the incident resolves once the failing traffic leaves the window', async () => {
		await sql`delete from microsoft_surface_events`;
		const body = await (await cron()).json();
		eq(body.resolved, ['connector_error_rate'], 'resolved');
		const open = await sql`select key from microsoft_alert_incidents where resolved_at is null`;
		eq(open.length, 0, 'open incidents');
	});

	console.log(failed ? `\nFAIL: ${failed} step(s)` : '\nPASS: every step');
	process.exit(failed ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
