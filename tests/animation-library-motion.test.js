// @vitest-environment jsdom
//
// The /pose "describe a motion" box and its guards (src/animation-library.js):
// a description that can never be a motion is refused before any request, a
// failed job offers Try again with the same words, a travelling motion plays in
// place, and a model with no skeleton gets "Rig it first" plus a button that
// runs the real rig job contract and loads the result.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AnimationLibrary, motionWaitText } from '../src/animation-library.js';
import { parseClipJSON } from '../src/animation-retarget.js';
import { rootTravel } from '../src/generated-motion.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WALK = JSON.parse(readFileSync(join(HERE, 'fixtures/text2motion-walk-clip.json'), 'utf8'));

const json = (status, body, headers = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function makeLibrary({ rig = { kind: 'gltf', getBones: () => new Array(20) }, loadRigged } = {}) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const statuses = [];
	const lib = new AnimationLibrary({
		host,
		getRig: () => rig,
		setStatus: (msg, kind) => statuses.push({ msg, kind }),
		loadRigged,
	});
	lib._renderShell();
	return { lib, host, statuses, last: () => statuses.at(-1) };
}

let fetchMock;
beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('describe-a-motion prompt guard', () => {
	it.each([[''], ['   '], ['!!!'], ['aaaaaaa'], ['12345']])('refuses %j before any request', async (prompt) => {
		const { lib, last } = makeLibrary();
		await lib.generateFromText(prompt);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(last().kind).toBe('error');
		expect(last().msg).toMatch(/waving hello/);
	});

	it('refuses with no rig loaded, before any request', async () => {
		const { lib, last } = makeLibrary({ rig: { kind: 'mannequin' } });
		await lib.generateFromText('a person waves hello');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(last().msg).toMatch(/rigged avatar/i);
	});
});

describe('a failed generation', () => {
	it('says nothing was used and offers Try again with the same words', async () => {
		const { lib, host, last } = makeLibrary();
		fetchMock.mockResolvedValueOnce(json(502, { error: 'motion_failed', message: 'upstream exploded at 0x1f' }));
		await lib.generateFromText('  a person   waves hello ');
		expect(last().kind).toBe('error');
		expect(last().msg).toMatch(/Nothing was used from your allowance/);
		expect(last().msg).not.toMatch(/0x1f/);
		const retry = host.querySelector('.al-gen-retry');
		expect(retry.hidden).toBe(false);

		fetchMock.mockResolvedValueOnce(json(429, { error: 'rate_limited' }, { 'retry-after': '600' }));
		retry.click();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ prompt: 'a person waves hello' });
		await vi.waitFor(() => expect(last().msg).toMatch(/Try again in 10 min/));
	});

	it('shows the server refusal for a bad description and does not offer a retry of it', async () => {
		const { lib, host, last } = makeLibrary();
		fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_prompt', message: 'That does not read as a movement yet.' }));
		await lib.generateFromText('qwerty asdf');
		expect(last().msg).toBe('That does not read as a movement yet.');
		expect(host.querySelector('.al-gen-retry').hidden).toBe(true);
	});

	it('never plays the raw worker clip when the server could not convert it', async () => {
		vi.useFakeTimers();
		const { lib, last } = makeLibrary();
		fetchMock.mockResolvedValueOnce(json(202, { job_id: 'abc123', status: 'queued', eta_seconds: 20 }));
		fetchMock.mockImplementation(async () => json(200, { status: 'done', clip: null, clip_url: 'https://example.test/raw.json' }));
		const run = lib.generateFromText('a person waves hello');
		await vi.advanceTimersByTimeAsync(2500 * 5);
		await run;
		expect(last().msg).toMatch(/could not be prepared for playback/);
		expect(fetchMock.mock.calls.some(([url]) => String(url).includes('raw.json'))).toBe(false);
	});
});

describe('wait text', () => {
	it('is honest about a cold GPU once the estimate has passed', () => {
		expect(motionWaitText('a person waves', 12, 25)).toBe('Generating “a person waves”: 12s.');
		expect(motionWaitText('a person waves', 40, 25)).toMatch(/asleep and is starting up/);
		expect(motionWaitText('a person waves', 31, null)).toMatch(/asleep/);
	});
});

describe('In place', () => {
	it('opens a travelling motion pinned in place and lets the person release it', () => {
		const { lib, host } = makeLibrary();
		const clip = parseClipJSON(WALK, 'walk');
		lib._baseClip = clip;
		lib._resetEdits(clip.duration, true);
		const btn = host.querySelector('.al-inplace');
		expect(btn.hidden).toBe(false);
		expect(btn.getAttribute('aria-pressed')).toBe('true');
		expect(rootTravel(lib._computeEditedClip(clip))).toBeLessThan(1e-6);

		btn.click();
		expect(btn.getAttribute('aria-pressed')).toBe('false');
		expect(rootTravel(lib._computeEditedClip(clip))).toBeGreaterThan(5);
		// The source clip is never modified by either setting.
		expect(rootTravel(clip)).toBeGreaterThan(5);
	});

	it('hides the toggle for a motion that stays put', () => {
		const { lib, host } = makeLibrary();
		const still = {
			name: 'still',
			duration: 1,
			tracks: [
				{ name: 'Hips.position', type: 'vector', times: [0, 1], values: [0, 1, 0, 0.01, 1, 0] },
				{ name: 'Spine.quaternion', type: 'quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] },
			],
		};
		const clip = parseClipJSON(still, 'still');
		lib._baseClip = clip;
		lib._resetEdits(clip.duration, true);
		expect(host.querySelector('.al-inplace').hidden).toBe(true);
		expect(lib._computeEditedClip(clip)).toBe(clip);
	});
});

describe('Rig it first', () => {
	const MESH = 'https://storage.googleapis.com/three-ws-test/mesh.glb';
	const RIGGED = 'https://storage.googleapis.com/three-ws-test/rigged.glb';

	function offered(opts = {}) {
		const ctx = makeLibrary({ rig: { kind: 'mannequin' }, ...opts });
		ctx.lib._defs = [{ name: 'idle' }];
		ctx.lib.offerRig({ url: MESH, name: 'Crate knight' });
		return ctx;
	}

	it('offers to rig an unrigged model instead of only asking for another avatar', () => {
		const { host } = offered();
		expect(host.querySelector('.al-empty-title').textContent).toBe('Rig it first');
		expect(host.querySelector('.al-empty-body').textContent).toMatch(/Crate knight/);
		expect(host.querySelector('.al-rig-btn')).not.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rigs it through the Forge rig job and loads the rigged GLB', async () => {
		vi.useFakeTimers();
		const loadRigged = vi.fn().mockResolvedValue(undefined);
		const { lib, host, last } = offered({ loadRigged });
		fetchMock
			.mockResolvedValueOnce(json(200, { job_id: 'rig1', status: 'queued', eta_seconds: 60 }))
			.mockResolvedValueOnce(json(200, { status: 'running' }))
			.mockResolvedValueOnce(json(200, { status: 'done', glb_url: RIGGED }));
		host.querySelector('.al-rig-btn').click();
		expect(host.querySelector('.al-empty-title').textContent).toBe('Rigging “Crate knight”');
		await vi.advanceTimersByTimeAsync(2500 * 3);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/forge?action=rig');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ glb_url: MESH });
		expect(fetchMock.mock.calls[1][0]).toBe('/api/forge?job=rig1');
		await vi.waitFor(() => expect(loadRigged).toHaveBeenCalledWith(RIGGED, 'Crate knight'));
		await vi.waitFor(() => expect(last().msg).toMatch(/Rigged “Crate knight”/));
		expect(lib._rigOffer).toBeNull();
	});

	it('explains a failed rig and offers to try again', async () => {
		vi.useFakeTimers();
		const { host } = offered({ loadRigged: vi.fn() });
		fetchMock
			.mockResolvedValueOnce(json(200, { job_id: 'rig2', status: 'queued' }))
			.mockResolvedValueOnce(json(200, { status: 'failed', error: 'CUDA OOM at layer 7' }));
		host.querySelector('.al-rig-btn').click();
		await vi.advanceTimersByTimeAsync(2500 * 2);
		await vi.waitFor(() => expect(host.textContent).toMatch(/Try rigging again/));
		expect(host.textContent).not.toMatch(/CUDA/);
	});

	it('says plainly when rigging is not set up, with no retry that cannot work', async () => {
		const { host } = offered({ loadRigged: vi.fn() });
		fetchMock.mockResolvedValueOnce(json(501, { error: 'rig_unconfigured', message: 'Auto-rigging is not configured.' }));
		host.querySelector('.al-rig-btn').click();
		await vi.waitFor(() => expect(host.querySelector('.al-empty-icon').textContent).toBe('⚠️'));
		expect(host.textContent).not.toMatch(/Try rigging again/);
		expect(host.textContent).toMatch(/Load a rigged avatar/);
	});

	it('drops the offer once a rigged avatar is loaded another way', () => {
		const rig = { kind: 'mannequin', getBones: () => new Array(20) };
		const { lib } = offered({ rig });
		rig.kind = 'gltf';
		lib._defs = [];
		lib.onRigChanged();
		expect(lib._rigOffer).toBeNull();
	});
});
