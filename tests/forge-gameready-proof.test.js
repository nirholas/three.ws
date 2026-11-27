// @vitest-environment jsdom
//
// Game-Ready must never charge twice for one export (order 129). The pay sheet
// remembers an unspent settled proof and offers it again instead of a second
// charge (src/shared/forge-paid-proofs.js), so the export panel has to report
// what happened to it: forget it once the server started the export (the proof
// is redeemed), forget it and pay fresh once when a reused proof is refused,
// and keep it when the export request faulted so the next try is free.
// Both copies (src/forge-gameready.js and the Studio copy) are pinned.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const pay = vi.hoisted(() => {
	const state = { results: [], forgotten: [], calls: 0 };
	state.module = () => ({
		payForConsumption: async () => {
			state.calls += 1;
			return state.results.shift();
		},
		forgetPaidProof: (id) => state.forgotten.push(id),
	});
	return state;
});
vi.mock('../src/forge-pay.js', () => pay.module());
vi.mock('../src/forge-studio/forge-pay.js', () => pay.module());
vi.mock('../src/three-access.js', () => ({
	getAccess: vi.fn(async () => ({
		access: { feature: 'forge.gameready', eligible: false, pay_per_use: { action: 'forge.gameready', usd: 0.1 } },
	})),
	getTierPass: vi.fn(async () => null),
	attachTierPass: vi.fn((h = {}) => h),
}));

const GLB_URL = 'https://three.ws/cdn/models/knight.glb';
const GATE = { error: 'three_hold_required', pay_per_use: { action: 'forge.gameready', usd: 0.1 } };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let exportReplies;
function posts() {
	return global.fetch.mock.calls
		.filter(([url, init]) => String(url) === '/api/forge-gameready' && init?.method === 'POST')
		.map(([, init]) => JSON.parse(init.body));
}

async function mount(path, replies) {
	exportReplies = replies;
	global.fetch = vi.fn(async (url, init) => {
		const u = String(url);
		if (u === GLB_URL) return reply(404, {});
		if (u === '/api/forge-gameready' && init?.method === 'POST') return exportReplies.shift();
		return reply(200, { status: 'running' });
	});
	document.body.innerHTML = `
		<section id="state-result">
			<div id="viewer-shell"><model-viewer id="viewer"></model-viewer></div>
			<button id="forge-gameready-btn" aria-expanded="false"></button>
		</section>`;
	await import(path);
	document.dispatchEvent(new CustomEvent('forge:model-ready', { detail: { glbUrl: GLB_URL, label: 'knight' } }));
	await vi.advanceTimersByTimeAsync(1);
	document.querySelector('.gr-run').click();
	await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetModules();
	pay.results = [];
	pay.forgotten = [];
	pay.calls = 0;
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe.each([['../src/forge-gameready.js'], ['../src/forge-studio/forge-gameready.js']])(
	'%s and the remembered proof',
	(path) => {
		it('forgets the proof once the server started the export', async () => {
			pay.results = [{ ok: true, paymentId: 'pay-1', refId: 'forge-gameready-1' }];
			await mount(path, [reply(402, GATE), reply(200, { job_id: 'job_1' })]);
			expect(pay.calls).toBe(1);
			expect(pay.forgotten).toEqual(['pay-1']);
		});

		it('keeps the proof when the export request faults after the payment', async () => {
			pay.results = [{ ok: true, paymentId: 'pay-1', refId: 'forge-gameready-1' }];
			await mount(path, [reply(402, GATE), reply(503, { error: 'service_unavailable' })]);
			expect(pay.forgotten).toEqual([]);
		});

		it('drops a reused proof the server refused and pays fresh exactly once', async () => {
			pay.results = [
				{ ok: true, paymentId: 'old-pay', refId: 'forge-gameready-old', reused: true },
				{ ok: true, paymentId: 'new-pay', refId: 'forge-gameready-new' },
			];
			await mount(path, [
				reply(402, GATE),
				reply(409, { error: 'payment_already_used', pay_per_use: GATE.pay_per_use }),
				reply(200, { job_id: 'job_1' }),
			]);
			expect(pay.calls).toBe(2);
			expect(pay.forgotten).toEqual(['old-pay', 'new-pay']);
			expect(posts()[2]).toMatchObject({ payment_id: 'new-pay', ref_id: 'forge-gameready-new' });
		});

		it('never loops: a fresh payment the server refuses is forgotten and not paid again', async () => {
			pay.results = [{ ok: true, paymentId: 'pay-1', refId: 'forge-gameready-1' }];
			await mount(path, [reply(402, GATE), reply(402, { error: 'payment_invalid', pay_per_use: GATE.pay_per_use })]);
			expect(pay.calls).toBe(1);
			expect(pay.forgotten).toEqual(['pay-1']);
			expect(posts()).toHaveLength(2);
		});
	},
);
