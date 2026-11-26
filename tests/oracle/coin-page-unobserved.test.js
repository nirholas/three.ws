// @vitest-environment jsdom
//
// /oracle/coin/<mint> for a coin the data brain has never observed.
//
// Only the always-on observer writes pump_coin_intel, and /api/oracle/coin never
// ingests a coin inline, so "not observed" is a stable answer for the visit, not
// a transient one. The page used to treat it as transient: it polled the oracle
// five times (five 404s in the console), asked the radar for intel it does not
// have (a sixth 404), and promised a score "within moments" that never came.
// $THREE itself hit this on 2026-11-26. These pin the honest behaviour: one
// soft-miss request each (`?miss=empty` answers 204), no polling on a stable
// miss, copy that does not promise a score, and retries kept for real outages.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = readFileSync(resolve(ROOT, 'public/oracle-coin.js'), 'utf8');
const MINT = 'THREEsynthetic11111111111111111111111111111';

// The live API contract: a soft-miss caller gets 204, everyone else 404.
function apiResponse(url, oracleStatus) {
	const u = new URL(url, 'https://three.ws');
	const soft = u.searchParams.get('miss') === 'empty';
	if (u.pathname === '/api/oracle/coin') {
		if (oracleStatus === 503) return new Response(JSON.stringify({ error: 'scoring_unavailable' }), { status: 503 });
		return soft ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
	}
	if (u.pathname === '/api/pump/coin-intel') {
		return soft ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
	}
	return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function boot(oracleStatus = 404) {
	const calls = [];
	globalThis.fetch = vi.fn(async (url) => {
		calls.push(String(url));
		return apiResponse(String(url), oracleStatus);
	});
	window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.(), 0); } close() {} send() {} };
	globalThis.EventSource = class { constructor() {} close() {} addEventListener() {} };
	window.history.replaceState(null, '', `/oracle/coin/${MINT}`);
	window.__OC_BOOT = { mint: MINT, pump: null, hasVerdict: false };
	document.body.innerHTML = '<div class="dial t-watch" id="ocDial"><b>··</b><div class="tierpill tp-watch">reading conviction</div></div><div id="ocDeep"></div>';
	new Function(PAGE)();
	await vi.advanceTimersByTimeAsync(60_000);
	return calls;
}

const statusOf = (calls, path) => calls.filter((u) => new URL(u, 'https://three.ws').pathname === path);

describe('oracle coin page on a never-observed coin', () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

	it('asks the oracle once, as a soft miss, and stops', async () => {
		const calls = await boot();
		const oracle = statusOf(calls, '/api/oracle/coin');
		expect(oracle).toHaveLength(1);
		expect(oracle[0]).toContain('miss=empty');
	});

	it('asks the radar for intel as a soft miss', async () => {
		const calls = await boot();
		const intel = statusOf(calls, '/api/pump/coin-intel');
		expect(intel.length).toBeGreaterThan(0);
		for (const u of intel) expect(u).toContain('miss=empty');
	});

	it('says plainly that there is no score instead of promising one', async () => {
		await boot();
		const text = document.querySelector('#ocConviction').textContent;
		expect(text).not.toMatch(/within moments/i);
		expect(text).toMatch(/not (been )?observed|hasn't observed|has not observed/i);
		// The server-rendered hero dial stops claiming to read a verdict.
		expect(document.querySelector('#ocDial').textContent).not.toMatch(/reading conviction/i);
	});

	it('still retries when scoring is down rather than calling the coin unknown', async () => {
		const calls = await boot(503);
		expect(statusOf(calls, '/api/oracle/coin').length).toBeGreaterThan(1);
		const text = document.querySelector('#ocConviction').textContent;
		expect(text).not.toMatch(/not (been )?observed|hasn't observed|has not observed/i);
	});
});
