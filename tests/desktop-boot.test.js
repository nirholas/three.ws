import { describe, it, expect } from 'vitest';
import { runBootSteps, snapshotOf, formatMs, greeting, entryMode, showBoot, bootSummary, gpuName } from '../src/desktop/boot-logic.js';

describe('desktop boot sequence', () => {
	it('runs every step concurrently and reports ok, skip and fail with timings', async () => {
		let t = 100;
		const now = () => (t += 10);
		const seen = [];
		const snap = await runBootSteps(
			[
				{ id: 'a', label: 'A', task: async () => 'fine' },
				{ id: 'b', label: 'B', task: async () => ({ skip: 'not needed' }) },
				{ id: 'c', label: 'C', task: async () => { throw new Error('boom'); } },
				{ id: 'd', label: 'D', task: async () => ({ value: 42 }) },
			],
			(s) => seen.push(s.done),
			now,
		);
		expect(snap.complete).toBe(true);
		expect(snap.total).toBe(4);
		expect(snap.failed).toEqual(['c']);
		const by = Object.fromEntries(snap.steps.map((s) => [s.id, s]));
		expect(by.a).toMatchObject({ state: 'ok', detail: 'fine' });
		expect(by.b).toMatchObject({ state: 'skip', detail: 'not needed' });
		expect(by.c).toMatchObject({ state: 'fail', detail: 'boom' });
		expect(by.d.state).toBe('ok');
		expect(by.d.value).toEqual({ value: 42 });
		expect(by.d.detail).toBe('');
		snap.steps.forEach((s) => expect(s.ms).toBeGreaterThan(0));
		// First emit is the all-running snapshot, then one per settled step.
		expect(seen[0]).toBe(0);
		expect(seen.at(-1)).toBe(4);
		expect(seen.length).toBe(5);
	});

	it('snapshots progress as a fraction of settled steps', () => {
		const s = snapshotOf([
			{ id: 'a', state: 'ok' },
			{ id: 'b', state: 'running' },
			{ id: 'c', state: 'fail' },
			{ id: 'd', state: 'pending' },
		]);
		expect(s.done).toBe(2);
		expect(s.progress).toBe(0.5);
		expect(s.complete).toBe(false);
		expect(s.failed).toEqual(['c']);
		expect(snapshotOf([]).progress).toBe(1);
	});

	it('formats timings for the log column', () => {
		expect(formatMs(12.4)).toBe('12ms');
		expect(formatMs(1234)).toBe('1.23s');
		expect(formatMs(-1)).toBe('');
		expect(formatMs(NaN)).toBe('');
	});

	it('greets by time of day, name and return visit', () => {
		expect(greeting(3, '', false)).toBe('Still up. Welcome to three.ws.');
		expect(greeting(9, 'Ada', false)).toBe('Good morning, Ada.');
		expect(greeting(14, '', true)).toBe('Good afternoon. Welcome back.');
		expect(greeting(19, ' ', true)).toBe('Good evening. Welcome back.');
		expect(greeting(23, '', false)).toBe('Working late. Welcome to three.ws.');
		expect(greeting(NaN, '', false)).toBe('Good afternoon. Welcome to three.ws.');
	});

	it('summarises what the boot found', () => {
		expect(bootSummary(null)).toBe('');
		expect(bootSummary({ failed: [], steps: [] })).toBe('Every system is up.');
		expect(bootSummary({ failed: ['market'], steps: [] }, { market: '$THREE feed' })).toBe('$THREE feed is offline. Everything else is up.');
		expect(bootSummary({ failed: ['a', 'b', 'c'], steps: [] }, { a: 'A', b: 'B' })).toBe('A, B and c are offline.');
	});
});

describe('entry mode', () => {
	it('defaults to the world and honours the start-in preference', () => {
		expect(entryMode({})).toBe('world');
		expect(entryMode({ prefs: { startIn: 'desktop' } })).toBe('desktop');
		expect(entryMode({ prefs: { startIn: 'world' } })).toBe('world');
	});
	it('lets deep links and explicit view choices win', () => {
		expect(entryMode({ deepLink: 'forge' })).toBe('desktop');
		expect(entryMode({ search: '?view=desktop' })).toBe('desktop');
		expect(entryMode({ search: '?world=0' })).toBe('desktop');
		expect(entryMode({ search: '?world=1', prefs: { startIn: 'desktop' } })).toBe('world');
		expect(entryMode({ hash: '#world', prefs: { startIn: 'desktop' } })).toBe('world');
	});
	it('never sends a browser without WebGL into the 3D lobby', () => {
		expect(entryMode({ webgl: false })).toBe('desktop');
		expect(entryMode({ search: '?world=1', webgl: false })).toBe('desktop');
	});
	it('keeps phones in the world unless they opted out', () => {
		expect(entryMode({ mobile: true })).toBe('world');
		expect(entryMode({ mobile: true, prefs: { startIn: 'world' } })).toBe('world');
		expect(entryMode({ mobile: true, prefs: { startIn: 'desktop' } })).toBe('desktop');
	});
	it('skips the boot screen only on ?boot=0', () => {
		expect(showBoot('')).toBe(true);
		expect(showBoot('?boot=1')).toBe(true);
		expect(showBoot('?boot=0')).toBe(false);
	});
});

describe('boot line details', () => {
	it('shows a detail string carried on an object result', async () => {
		const snap = await runBootSteps([{ id: 'm', label: 'M', task: async () => ({ price: 1, detail: '$1.00 +2.0%' }) }], null);
		expect(snap.steps[0].detail).toBe('$1.00 +2.0%');
		expect(snap.steps[0].value.price).toBe(1);
	});
	it('shortens the renderer string to a GPU name', () => {
		expect(gpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3080');
		expect(gpuName('Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver')).toBe('SwiftShader Device');
		expect(gpuName('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('Apple M2');
		expect(gpuName('Mali-G78')).toBe('Mali-G78');
		expect(gpuName('')).toBe('WebGL');
		expect(gpuName('x'.repeat(60)).length).toBeLessThanOrEqual(40);
	});
});
