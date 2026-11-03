import { describe, it, expect } from 'vitest';
import {
	judgeRun,
	judgeTouch,
	exitCodeFor,
	isDevSocket,
	disconnects,
	countsAsTransfer,
	duplicateDownloads,
} from '../scripts/lib/event-client-verdict.mjs';

const LIMITS = {
	maxWorldVisibleMs: 30000,
	maxTransferMB: 40,
	maxPeakHeapMB: 400,
	maxHeapGrowthMB: 60,
	maxWorstFrameMs: 250,
};

// A clean run as play-mobile-repro.mjs writes it with SUMMARY_JSON set.
function cleanRun(over = {}) {
	return {
		engine: 'chromium',
		navigation: { ok: true },
		worldVisibleMs: 9000,
		bootError: null,
		crashed: false,
		pageErrors: [],
		consoleErrors: [],
		consoleWarnings: [],
		networkChanged: 0,
		wsCloses: [],
		transferMB: 22,
		heap: { firstMB: 180, peakMB: 240, lastMB: 210, growthMB: 30 },
		frames: { worstMs: 120, p95Ms: 40, samples: 900 },
		duplicateFetches: [],
		...over,
	};
}

describe('event client verdict', () => {
	it('passes a clean run', () => {
		const v = judgeRun(cleanRun(), LIMITS);
		expect(v.status).toBe('pass');
		expect(v.reasons).toEqual([]);
		expect(v.metrics.transferMB).toBe(22);
	});

	it('fails a seeded uncaught page error, the mobile kick-out signature', () => {
		const v = judgeRun(cleanRun({ pageErrors: ['TypeError: cannot read properties of undefined'] }), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons[0]).toMatch(/uncaught page error: TypeError/);
	});

	it('fails a renderer crash even when the network also flapped', () => {
		const v = judgeRun(cleanRun({ crashed: true, networkChanged: 3 }), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons[0]).toMatch(/crashed/);
	});

	// Playwright's WebKit on Linux rasterises WebGL on CPU threads inside the page
	// process. /play's world starves requestAnimationFrame there until a sync GL
	// call blocks the main thread for minutes. That is the harness engine, not
	// /play, and must not be reported as a crash (an iOS memory kill) or a pass.
	it('reports a page frozen by a starved software renderer as unmeasured', () => {
		const v = judgeRun(cleanRun({ engine: 'webkit', unresponsive: { atMs: 29000, rendererStarved: true } }), LIMITS);
		expect(v.status).toBe('unmeasured');
		expect(v.reasons[0]).toMatch(/software renderer/);
	});

	it('fails a page that stopped answering while frames were still being drawn', () => {
		const v = judgeRun(cleanRun({ unresponsive: { atMs: 41000, rendererStarved: false } }), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons[0]).toMatch(/stopped answering/);
	});

	it('fails when the boot watchdog swapped the loader for its error card', () => {
		const v = judgeRun(cleanRun({ bootError: 'The world failed to load. Retry', worldVisibleMs: null }), LIMITS);
		expect(v.status).toBe('fail');
	});

	it('fails a dropped room socket but ignores the Vite HMR socket', () => {
		const hmr = { url: 'ws://127.0.0.1:3100/?token=abc', atMs: 5000 };
		const room = { url: 'wss://mp.three.ws/abc123/walk_world?sessionId=x', atMs: 61000 };
		expect(judgeRun(cleanRun({ wsCloses: [hmr] }), LIMITS).status).toBe('pass');
		const v = judgeRun(cleanRun({ wsCloses: [hmr, room] }), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons).toHaveLength(1);
		expect(v.reasons[0]).toMatch(/room socket closed mid-session at \+61s/);
	});

	it('fails a seeded duplicate GLB download', () => {
		const v = judgeRun(cleanRun({ duplicateFetches: [{ url: '/avatars/default.glb', count: 2 }] }), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons[0]).toMatch(/downloaded 2x/);
	});

	it('fails console errors from our code and ignores filtered environment noise', () => {
		expect(judgeRun(cleanRun({ consoleErrors: ['[vite] connecting...'] }), LIMITS).status).toBe('pass');
		const v = judgeRun(cleanRun({ consoleWarnings: ['[coincommunities] quest board failed'] }), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons[0]).toMatch(/console.warn from our code/);
	});

	it('fails each budget that is exceeded and names the number', () => {
		const v = judgeRun(cleanRun({
			transferMB: 55,
			worldVisibleMs: 41000,
			heap: { peakMB: 520, growthMB: 90 },
			frames: { worstMs: 400 },
		}), LIMITS);
		expect(v.status).toBe('fail');
		expect(v.reasons.join('\n')).toMatch(/transferred 55 MB is over the limit of 40 MB/);
		expect(v.reasons.join('\n')).toMatch(/time to a visible world/);
		expect(v.reasons.join('\n')).toMatch(/peak JS heap/);
		expect(v.reasons.join('\n')).toMatch(/heap growth/);
		expect(v.reasons.join('\n')).toMatch(/worst frame/);
	});

	it('skips a limit the engine cannot measure (WebKit exposes no heap)', () => {
		const v = judgeRun(cleanRun({ engine: 'webkit', heap: { peakMB: null, growthMB: null } }), LIMITS);
		expect(v.status).toBe('pass');
	});

	it('reports a navigation timeout or a host network change as unmeasured, never as a pass', () => {
		expect(judgeRun(cleanRun({ navigation: { ok: false, error: 'Timeout 60000ms' } }), LIMITS).status).toBe('unmeasured');
		expect(judgeRun(cleanRun({ networkChanged: 4, transferMB: 999 }), LIMITS).status).toBe('unmeasured');
		expect(judgeRun(cleanRun({ worldVisibleMs: null }), LIMITS).status).toBe('unmeasured');
	});

	it('maps statuses to an exit code: fail beats unmeasured beats pass', () => {
		expect(exitCodeFor(['pass', 'pass'])).toBe(0);
		expect(exitCodeFor(['pass', 'unmeasured'])).toBe(3);
		expect(exitCodeFor(['unmeasured', 'fail'])).toBe(1);
	});

	it('gates the touch audit report instead of trusting its always-zero exit code', () => {
		const clean = { smallTargets: [], canvases: [{ visible: true, touchAction: 'none' }], bottomBars: [{ hasSafeAreaRule: true }], overflowX: 0, clipped: [] };
		expect(judgeTouch(clean).status).toBe('pass');
		const seeded = { ...clean, smallTargets: [{ sel: 'button.cc-photo', w: 32, h: 32, text: 'Photo' }], overflowX: 12 };
		const v = judgeTouch(seeded);
		expect(v.status).toBe('fail');
		expect(v.reasons[0]).toBe('touch target 32x32 px is under 44 px: button.cc-photo ("Photo")');
		expect(v.reasons[1]).toMatch(/sideways by 12 px/);
		expect(judgeTouch({ error: 'page.goto: Timeout 60000ms exceeded.' }).status).toBe('unmeasured');
	});

	it('recognises the dev socket by shape, not by host', () => {
		expect(isDevSocket('ws://localhost:3000/?token=zz')).toBe(true);
		expect(isDevSocket('wss://three.ws/mp/walk_world?token=zz')).toBe(false);
		expect(isDevSocket('not a url')).toBe(false);
		expect(disconnects({ wsCloses: [{ url: 'ws://h/?token=1' }] })).toEqual([]);
	});

	it('counts only real network bodies as transfer: never a HEAD probe or an in-memory blob', () => {
		expect(countsAsTransfer({ url: 'https://three.ws/avatars/cz.glb', method: 'GET' })).toBe(true);
		expect(countsAsTransfer({ url: 'https://three.ws/avatars/cz.glb', method: 'HEAD' })).toBe(false);
		expect(countsAsTransfer({ url: 'blob:https://three.ws/9101c6d3', method: 'GET' })).toBe(false);
		expect(countsAsTransfer({ url: 'data:image/png;base64,AA', method: 'GET' })).toBe(false);
	});

	it('does not call a size probe followed by the download a duplicate', () => {
		const loads = [
			{ url: '/avatars/cz.glb', method: 'HEAD' },
			{ url: '/avatars/cz.glb', method: 'GET' },
			{ url: '/avatars/xbot.glb' },
			{ url: '/avatars/xbot.glb', method: 'get' },
		];
		expect(duplicateDownloads(loads)).toEqual([{ url: '/avatars/xbot.glb', count: 2 }]);
	});
});
