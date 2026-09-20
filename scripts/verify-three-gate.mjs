#!/usr/bin/env node
// Verify the $THREE hold-to-access claims against the LIVE site, with no spend.
//
// Every public claim about the ladder ("Bronze at $25 unlocks High + Game-Ready",
// "draft and standard stay free", "the rest is marked Planned") is checkable from
// outside without holding a single token. This script checks them, so the claim
// can be re-proved after any deploy instead of trusted.
//
// What it proves, and how each half is covered without buying anything:
//   1. Ladder   : the published thresholds/discounts/multipliers match TIERS.
//   2. Deny     : an anonymous High / Game-Ready call 402s with the documented shape.
//   3. Allow    : real on-chain holder wallets (read from the mint's largest
//                  accounts at runtime, never hardcoded) resolve to an ELIGIBLE
//                  tier through the same resolver the gate uses. Reading someone
//                  else's balance costs nothing and moves nothing.
//   4. Free floor: draft + standard generation are accepted anonymously.
//   5. Honesty  : features that are not wired report enforced:false, which is
//                  what renders the "Planned" flag on /three.
//
// Usage: node scripts/verify-three-gate.mjs [--base https://three.ws] [--no-forge]
//   --no-forge skips step 4 (it queues two real free-lane generations).

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = argValue('--base', 'https://three.ws').replace(/\/+$/, '');
const RUN_FORGE = !args.includes('--no-forge');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// The ladder as published. Divergence here means the marketing and the server
// disagree, which is the single most damaging failure this script can catch.
const PUBLISHED = [
	{ id: 'member', minUsd: 0, discountBps: 0, rateMultiplier: 1 },
	{ id: 'bronze', minUsd: 25, discountBps: 500, rateMultiplier: 2 },
	{ id: 'silver', minUsd: 100, discountBps: 1000, rateMultiplier: 3 },
	{ id: 'gold', minUsd: 500, discountBps: 2000, rateMultiplier: 5 },
	{ id: 'genesis', minUsd: 2500, discountBps: 3000, rateMultiplier: 10 },
];

// Features the article says are live today, with the tier each one requires.
const LIVE_GATES = [
	{ feature: 'forge.high', required: 'bronze' },
	{ feature: 'forge.gameready', required: 'bronze' },
];

let failures = 0;
function check(label, ok, detail = '') {
	const mark = ok ? 'PASS' : 'FAIL';
	if (!ok) failures += 1;
	console.log(`  [${mark}] ${label}${detail ? `: ${detail}` : ''}`);
}
function section(title) {
	console.log(`\n${title}`);
}

async function getJson(url, init) {
	const r = await fetch(url, init);
	let body = null;
	try {
		body = await r.json();
	} catch {
		body = null;
	}
	return { status: r.status, body };
}

async function rpc(method, params) {
	const { body } = await getJson(`${BASE}/api/solana-rpc`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	return body?.result ?? null;
}

// ── 1. Ladder ────────────────────────────────────────────────────────────────
async function checkLadder() {
	section('1. Tier ladder matches what we publish');
	const { TIERS } = await import('../api/_lib/three-tier.js');
	check('tier count', TIERS.length === PUBLISHED.length, `${TIERS.length} tiers`);
	for (const want of PUBLISHED) {
		const got = TIERS.find((t) => t.id === want.id);
		if (!got) {
			check(`${want.id} exists`, false);
			continue;
		}
		const ok =
			got.minUsd === want.minUsd &&
			got.discountBps === want.discountBps &&
			got.rateMultiplier === want.rateMultiplier;
		check(
			`${want.id}`,
			ok,
			`$${got.minUsd} hold, ${got.discountBps / 100}% off, ${got.rateMultiplier}x quota`,
		);
	}
}

// ── 2. Deny path ─────────────────────────────────────────────────────────────
async function checkDeny() {
	section('2. Anonymous callers are denied with the documented 402');
	const calls = [
		['forge.high', `${BASE}/api/forge`, { prompt: 'a plain wooden stool', tier: 'high' }],
		['forge.gameready', `${BASE}/api/forge-gameready`, { model_url: `${BASE}/assets/test.glb` }],
	];
	for (const [feature, url, payload] of calls) {
		const { status, body } = await getJson(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		});
		check(`${feature} returns 402`, status === 402, `HTTP ${status}`);
		check(`${feature} error code`, body?.error === 'three_hold_required', String(body?.error));
		check(`${feature} names the required tier`, body?.required?.id === 'bronze' && body?.required?.min_usd === 25, `${body?.required?.label} @ $${body?.required?.min_usd}`);
		check(`${feature} tells the caller how to acquire`, body?.acquire?.mint === MINT);
		check(`${feature} offers a pay-per-use alternative`, typeof body?.pay_per_use?.usd === 'number', `$${body?.pay_per_use?.usd}`);
	}
}

// ── 3. Allow path, read-only ─────────────────────────────────────────────────
// Resolve owner wallets behind the mint's largest token accounts and ask the live
// access endpoint what they are entitled to. Nothing is signed, nothing is spent.
async function checkAllow() {
	section('3. Real holder wallets resolve as ELIGIBLE (read-only, no purchase)');
	const largest = await rpc('getTokenLargestAccounts', [MINT]);
	const accounts = (largest?.value ?? []).slice(0, 6).map((a) => a.address);
	if (!accounts.length) {
		check('found holder accounts', false, 'RPC returned none');
		return;
	}
	const wallets = [];
	for (const account of accounts) {
		const info = await rpc('getAccountInfo', [account, { encoding: 'jsonParsed' }]);
		const owner = info?.value?.data?.parsed?.info?.owner;
		if (owner) wallets.push(owner);
	}
	check('resolved holder wallets', wallets.length > 0, `${wallets.length} owners`);

	let eligible = 0;
	for (const wallet of wallets) {
		const { body } = await getJson(`${BASE}/api/three/access?feature=forge.high&wallet=${wallet}`);
		const tier = body?.tier;
		const access = body?.access;
		if (!tier) continue;
		// A holder above the Bronze threshold MUST come back eligible; a wallet that
		// sold down to nothing must not. Both directions are the same assertion.
		const shouldPass = Number(tier.held_usd) >= 25;
		const ok = Boolean(access?.eligible) === shouldPass;
		if (access?.eligible) eligible += 1;
		check(
			`${wallet.slice(0, 6)}…${wallet.slice(-4)} holds $${Math.round(Number(tier.held_usd) || 0)} -> ${tier.label}`,
			ok,
			access?.eligible ? 'eligible for forge.high' : 'locked',
		);
	}
	check('at least one live wallet clears the gate', eligible > 0, `${eligible} eligible`);
}

// ── 4. Free floor ────────────────────────────────────────────────────────────
async function checkFreeFloor() {
	section('4. Draft + standard stay free for anonymous callers');
	if (!RUN_FORGE) {
		console.log('  [skip] --no-forge');
		return;
	}
	for (const tier of ['draft', 'standard']) {
		const { status, body } = await getJson(`${BASE}/api/forge`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prompt: 'a plain wooden stool', tier }),
		});
		check(`${tier} accepted anonymously`, status === 200 && Boolean(body?.job_id), `HTTP ${status} ${body?.status ?? ''}`);
	}
}

// ── 5. Planned vs live honesty ───────────────────────────────────────────────
async function checkHonesty() {
	section('5. Unbuilt perks report enforced:false (what renders "Planned")');
	const { body } = await getJson(`${BASE}/api/three/access`);
	const features = body?.features ?? [];
	check('access matrix served', features.length > 0, `${features.length} features`);
	for (const { feature, required } of LIVE_GATES) {
		const f = features.find((x) => x.feature === feature);
		check(`${feature} is enforced`, f?.enforced === true);
		check(`${feature} requires ${required}`, f?.required?.id === required);
	}
	const planned = features.filter((f) => !f.enforced).map((f) => f.feature);
	check('planned features are flagged, not sold as live', planned.length === features.length - LIVE_GATES.length, planned.join(', ') || 'none');
}

async function main() {
	console.log(`$THREE hold-to-access verification against ${BASE}`);
	await checkLadder();
	await checkDeny();
	await checkAllow();
	await checkFreeFloor();
	await checkHonesty();
	console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error('verification crashed:', err?.message || err);
	process.exit(1);
});
