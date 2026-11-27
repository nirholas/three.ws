// @vitest-environment jsdom
//
// The home-page mini forge pays for High through the same pay sheet, which
// remembers an unspent settled proof and offers it again instead of a second
// charge (order 129). The controls (src/home-forge-controls.js) hand the proof
// to the page's run (src/home-forge.js) and learn how it ended: forget the proof
// once the model was delivered or the server refused it, keep it when the run
// faulted so the next try is free, and pay fresh exactly once when a reused
// proof is refused.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const pay = vi.hoisted(() => ({ results: [], forgotten: [], calls: 0 }));
vi.mock('../src/three-access.js', () => ({
	getAccess: vi.fn(async () => ({
		access: { eligible: false, feature: 'forge.high', pay_per_use: { action: 'forge.high', usd: 0.5 } },
		tier: { level: 0 },
	})),
	getTierPass: vi.fn(async () => null),
	attachTierPass: vi.fn((h) => h),
	primeTierPass: vi.fn(),
}));
vi.mock('../src/three-lock.js', () => ({
	renderLock: vi.fn(),
	lockStateFromAccess: vi.fn((a, opts) => ({ ...a, ...opts })),
}));
vi.mock('../src/forge-pay.js', () => ({
	payForHighGeneration: async () => {
		pay.calls += 1;
		return pay.results.shift();
	},
	forgetPaidProof: (id) => pay.forgotten.push(id),
}));

import { initForgeControls } from '../src/home-forge-controls.js';
import { renderLock } from '../src/three-lock.js';

const CATALOG = {
	paths: ['image'],
	default_tier: 'standard',
	default_backend: { image: 'nvidia' },
	tiers: [
		{ id: 'standard', label: 'Standard', blurb: 'Balanced', price_usdc: '0.00' },
		{ id: 'high', label: 'High', blurb: '200k poly + PBR', price_usdc: '0.50' },
	],
	backends: [{ id: 'nvidia', label: 'NVIDIA', paths: ['image'], byok: null, free: true, user_images: false, configured: true, blurb: 'Free' }],
};

async function payPerUse(outcomes) {
	global.fetch = vi.fn(async (url) => {
		const u = String(url);
		if (u.includes('catalog')) return { ok: true, json: async () => CATALOG };
		if (u.includes('health')) return { ok: true, json: async () => ({ backends: {} }) };
		return { ok: true, json: async () => ({}) };
	});
	document.body.innerHTML = `
		<section id="home-forge">
			<button data-hf-opts aria-expanded="false"></button>
			<div data-hf-panel hidden>
				<div data-hf-tier></div><div data-hf-engine></div>
				<div data-hf-aspect-row><div data-hf-aspect></div></div>
				<div data-hf-byok hidden><span data-hf-byok-label></span><input data-hf-byok-key /><p data-hf-byok-hint></p></div>
				<div data-hf-lock hidden></div><p data-hf-perk hidden></p>
			</div>
		</section>`;
	const onRerun = vi.fn(async () => outcomes.shift());
	const controls = initForgeControls({ root: document.getElementById('home-forge'), clientHeaders: {}, onRerun });
	await controls.whenReady;
	document.querySelector('button[data-tier="high"]').click();
	await vi.waitFor(() => expect(renderLock).toHaveBeenCalled());
	const opts = renderLock.mock.calls.at(-1)[1];
	await opts.onPayPerUse({ usd: 0.5 });
	return onRerun;
}

beforeEach(() => {
	pay.results = [];
	pay.forgotten = [];
	pay.calls = 0;
	renderLock.mockClear();
});
afterEach(() => {
	document.body.innerHTML = '';
});

describe('home mini forge and the remembered proof', () => {
	it('forgets the proof once the model was delivered', async () => {
		pay.results = [{ ok: true, paymentId: 'pay-1', refId: 'forge-high-1' }];
		await payPerUse(['delivered']);
		expect(pay.forgotten).toEqual(['pay-1']);
	});

	it('keeps the proof when the run faulted or was cancelled', async () => {
		pay.results = [{ ok: true, paymentId: 'pay-1', refId: 'forge-high-1' }];
		await payPerUse([undefined]);
		expect(pay.forgotten).toEqual([]);
	});

	it('drops a reused proof the server refused and pays fresh exactly once', async () => {
		pay.results = [
			{ ok: true, paymentId: 'old-pay', refId: 'forge-high-old', reused: true },
			{ ok: true, paymentId: 'new-pay', refId: 'forge-high-new' },
		];
		const onRerun = await payPerUse(['refused', 'delivered']);
		expect(pay.calls).toBe(2);
		expect(pay.forgotten).toEqual(['old-pay', 'new-pay']);
		expect(onRerun.mock.calls[1][0]).toMatchObject({ payment_id: 'new-pay', ref_id: 'forge-high-new' });
	});

	it('never loops: a fresh payment the server refuses is forgotten and not paid again', async () => {
		pay.results = [{ ok: true, paymentId: 'pay-1', refId: 'forge-high-1' }];
		const onRerun = await payPerUse(['refused']);
		expect(pay.calls).toBe(1);
		expect(onRerun).toHaveBeenCalledTimes(1);
		expect(pay.forgotten).toEqual(['pay-1']);
	});
});

describe('src/home-forge.js reports how a paid run ended', () => {
	const src = readFileSync('src/home-forge.js', 'utf8');
	it('tags a refused proof (invalid, expired, already used) on the submit', () => {
		expect(src).toMatch(/payment_already_used[\s\S]{0,400}paymentRefused: true/);
		expect(src).toMatch(/payment_invalid/);
		expect(src).toMatch(/payment_expired/);
	});
	it('returns delivered and refused from run, and hands that back to the controls', () => {
		expect(src).toMatch(/return 'delivered'/);
		expect(src).toMatch(/return 'refused'/);
		expect(src).toMatch(/onRerun: \(payment\) => \{[\s\S]{0,200}return run\(p, \{ payment \}\)/);
	});
});
