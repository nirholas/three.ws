#!/usr/bin/env node
// End-to-end check of /creator/payouts against a live deployment, in a real
// headless browser, as the QA account (AUDIT_EMAIL / AUDIT_PASSWORD in .env).
//
// What it exercises, all through the page's own buttons:
//   1. Register payout wallet A (connect, password step-up, Ed25519 signature).
//      Skipped when the QA agent already has an active wallet.
//   2. Stage a change to wallet B and see the 48 hour pending notice.
//   3. Cancel the staged change.
//   4. The CSV export endpoint and the public payouts block on
//      /api/agents/:id/earnings.
//
// The wallet is a Phantom-shaped provider injected into the page whose
// signMessage calls back into Node and signs with tweetnacl. Both keypairs are
// derived from AUDIT_PASSWORD (sha256 of `creator-payouts-qa:<password>:<A|B>`),
// so whoever holds .env can recover the wallet registered on the QA agent.
// Nothing is spent: registering a wallet is a signed message, not a transaction.
//
// Prereqs: `npm run audit:web:login` (writes .auth/audit-state.json for BASE_URL).
// Usage:   node scripts/creator-payouts-prod-e2e.mjs [--base https://three.ws] [--out <screenshot dir>]
// Exits 1 on any failed step, page error, or non-2xx API response.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
	options: {
		base: { type: 'string', default: process.env.BASE_URL || 'https://three.ws' },
		out: { type: 'string', default: join(tmpdir(), 'creator-payouts-e2e') },
	},
});
const BASE = args.base.replace(/\/$/, '');
mkdirSync(args.out, { recursive: true });

function readEnvFile(path) {
	if (!existsSync(path)) return {};
	return Object.fromEntries(
		readFileSync(path, 'utf8')
			.split('\n')
			.filter((l) => /^[A-Z0-9_]+=/.test(l))
			.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
	);
}
const PASSWORD = process.env.AUDIT_PASSWORD || readEnvFile(join(ROOT, '.env')).AUDIT_PASSWORD;
const STATE = join(ROOT, '.auth', 'audit-state.json');
if (!PASSWORD) {
	console.error('AUDIT_PASSWORD is not set. Run `npm run audit:web:provision` to create the QA account.');
	process.exit(1);
}
if (!existsSync(STATE)) {
	console.error('No QA session. Run `npm run audit:web:login` first.');
	process.exit(1);
}

const keypair = (label) =>
	nacl.sign.keyPair.fromSeed(createHash('sha256').update(`creator-payouts-qa:${PASSWORD}:${label}`).digest());
const keys = { A: keypair('A'), B: keypair('B') };
const pub = { A: bs58.encode(keys.A.publicKey), B: bs58.encode(keys.B.publicKey) };

const failures = [];
const issues = [];
const apiCalls = [];
const expect = (ok, what) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
	if (!ok) failures.push(what);
};

const browser = await chromium.launch();
try {
	const ctx = await browser.newContext({ storageState: STATE });
	await ctx.exposeBinding('__qaSign', (_src, label, b64) =>
		Buffer.from(nacl.sign.detached(Buffer.from(b64, 'base64'), keys[label].secretKey)).toString('base64'),
	);
	await ctx.addInitScript((pub) => {
		window.__qaWallet = 'A';
		const pk = () => ({ toString: () => pub[window.__qaWallet], toBase58: () => pub[window.__qaWallet] });
		window.phantom = {
			solana: {
				isPhantom: true,
				get publicKey() {
					return pk();
				},
				connect: async () => ({ publicKey: pk() }),
				signMessage: async (bytes) => {
					const sig = await window.__qaSign(window.__qaWallet, btoa(String.fromCharCode(...bytes)));
					return { signature: Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)), publicKey: pk() };
				},
			},
		};
	}, pub);

	const page = await ctx.newPage();
	page.on('console', (m) => {
		// Software-GL driver chatter from the site's 3D companion, not page code.
		if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('GL Driver Message'))) {
			issues.push(`${m.type()}: ${m.text()}`);
		}
	});
	page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
	page.on('response', (r) => {
		if (r.url().startsWith(`${BASE}/api/`)) apiCalls.push({ status: r.status(), line: `${r.status()} ${r.request().method()} ${r.url().slice(BASE.length)}` });
	});

	const shot = (name) => page.screenshot({ path: join(args.out, `${name}.png`), fullPage: true });
	const bodyText = () => page.locator('#cp-body').innerText();

	await page.goto(`${BASE}/creator/payouts`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#cp-main:not([hidden]), #cp-auth:not([hidden])', { timeout: 60_000 });
	expect(await page.locator('#cp-main').isVisible(), 'signed-in owner view renders (session valid)');
	await page.waitForFunction(() => document.querySelector('#cp-body')?.getAttribute('aria-busy') === 'false', null, { timeout: 60_000 });
	await shot('1-loaded');
	const agentId = await page.locator('#cp-agent').inputValue();
	console.log(`agent ${agentId}\nwallet A ${pub.A}\nwallet B ${pub.B}`);
	expect((await page.locator('#cp-flow .cp-leg').count()) > 0, 'per-$100 explainer rendered from ?info=1');
	expect((await page.locator('#cp-sched li').count()) === 4, 'live schedule lists all four stages');

	async function registerWith(label) {
		await page.evaluate((l) => {
			window.__qaWallet = l;
		}, label);
		await page.click('[data-act="register"]');
		await page.fill('#cp-proof', PASSWORD);
		await page.click('[data-act="confirm"]');
		await page.waitForFunction(
			() => !document.querySelector('[data-act="confirm"]') || document.querySelector('.cp-field .notice-error'),
			null,
			{ timeout: 60_000 },
		);
		const err = (await page.locator('.cp-field .notice-error').allInnerTexts()).filter(Boolean);
		expect(err.length === 0, `register wallet ${label} accepted${err.length ? ` (${err.join('; ')})` : ''}`);
	}

	if (!(await bodyText()).includes('Payouts go to')) {
		await registerWith('A');
		await shot('2-registered-A');
	}
	const active = await bodyText();
	expect(active.includes('Payouts go to'), 'an active payout wallet is shown');

	await registerWith('B');
	await page.waitForSelector('[data-act="cancel"]', { timeout: 30_000 }).catch(() => {});
	await shot('3-staged-B');
	const staged = await bodyText();
	expect(staged.includes('Wallet change pending') && staged.includes(pub.B), 'change to wallet B is staged with the cooldown notice');

	await page.click('[data-act="cancel"]');
	await page.waitForFunction(() => !document.querySelector('[data-act="cancel"]'), null, { timeout: 30_000 }).catch(() => {});
	await shot('4-cancelled');
	expect(!(await bodyText()).includes('Wallet change pending'), 'staged change cancelled');
	expect((await page.locator('#cp-live').innerText()).includes('cancelled'), 'cancel announced in the live region');

	const rows = await page.locator('.cp-table tbody tr').count();
	const csvDisabled = await page.locator('[data-act="csv"]').isDisabled();
	expect(rows ? !csvDisabled : csvDisabled, `Export CSV ${rows ? 'enabled' : 'disabled'} with ${rows} distribution row(s)`);
	const csv = await page.evaluate(async (id) => {
		const r = await fetch(`/api/creator-payouts?agent=${encodeURIComponent(id)}&format=csv`, { credentials: 'include' });
		return { status: r.status, type: r.headers.get('content-type'), text: await r.text() };
	}, agentId);
	expect(csv.status === 200 && csv.type?.startsWith('text/csv') && csv.text.startsWith('date,agent_id,mint,status'), `CSV endpoint returns a CSV (${csv.text.split('\n').length - 2} data row(s))`);

	const earn = await page.evaluate(async (id) => {
		const r = await fetch(`/api/agents/${encodeURIComponent(id)}/earnings`);
		const j = await r.json();
		return { status: r.status, payouts: (j.data || j).payouts };
	}, agentId);
	expect(earn.status === 200 && earn.payouts?.wallet?.wallet && earn.payouts.wallet.pending === null, 'public earnings carries the payouts block without the staged change');
	console.log(`payouts live: ${earn.payouts?.live}`);

	const bad = apiCalls.filter((c) => c.status >= 400);
	expect(bad.length === 0, `every API call succeeded (${apiCalls.length} calls)`);
	for (const c of bad) console.log(`  ${c.line}`);
	expect(issues.length === 0, 'no console errors or warnings');
	for (const i of issues) console.log(`  ${i}`);
	console.log(`screenshots: ${args.out}`);
} finally {
	await browser.close();
}
process.exit(failures.length ? 1 : 0);
