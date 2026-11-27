// @vitest-environment jsdom
//
// The /forge Iterate panel (src/forge-conversational-refine.js) is a
// conversation with versions, not a lottery. Bugs reproduced 2026-11-27 on the
// old panel: a failed step left only a status line (no retry), versions showed
// no record of what made them, there was no way to compare two versions, no
// hint said whether a change would keep the shape, and "More like this" could
// not add to the history. Pinned here against the real module in jsdom, with
// fetch answering as /api/forge-iterate does.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGIN = 'https://three.ws/cdn/forge/nvidia/origin.glb';
const V1 = 'https://three.ws/cdn/forge/iterate/v1.glb';
const V2 = 'https://three.ws/cdn/forge/iterate/v2.glb';

const L0 = { index: 0, glbUrl: ORIGIN, prompt: 'a small robot', instruction: null, parentIndex: null, refKind: 'origin' };
const L1 = {
	index: 1,
	glbUrl: V1,
	prompt: 'a small robot, make it red',
	instruction: 'make it red',
	parentIndex: 0,
	refKind: 'restyle',
	inputs: { mode: 'look', instruction: 'make it red', parentPrompt: 'a small robot', seed: null, backend: 'material-restyle' },
};
const L2 = {
	index: 2,
	glbUrl: V2,
	prompt: 'a small robot, add wings',
	instruction: 'add wings',
	parentIndex: 0,
	refKind: 'text',
	inputs: { mode: 'shape', instruction: 'add wings', parentPrompt: 'a small robot', seed: 4242, backend: 'trellis_selfhost' },
};

function mount() {
	document.head.innerHTML = '';
	document.body.innerHTML = `
		<div id="state-result">
			<div class="result-bar"><p id="result-label">a small robot</p><div class="actions"><button id="forge-materials-btn"></button></div></div>
		</div>
		<model-viewer id="viewer" src="${ORIGIN}"></model-viewer>`;
}

const ok = (body) => new Response(JSON.stringify({ ok: true, ...body }), { status: 200 });
const fail = (status, body) => new Response(JSON.stringify(body), { status });
const $ = (id) => document.getElementById(id);
const sentBodies = () => globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

async function load() {
	vi.resetModules();
	await import('../src/forge-conversational-refine.js');
}

async function submit(text) {
	$('iterate-instruction').value = text;
	$('iterate-instruction').dispatchEvent(new Event('input'));
	$('iterate-form').dispatchEvent(new Event('submit', { cancelable: true }));
	await vi.waitFor(() => expect($('iterate-panel').dataset.busy).toBe('false'));
}

describe('Iterate panel versions', () => {
	beforeEach(() => {
		localStorage.clear();
		mount();
	});
	afterEach(() => {
		delete globalThis.fetch;
	});

	it('a failed step keeps the last good version on screen and retries that same step', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(ok({ kind: 'look', glbUrl: V1, lineage: [L0, L1], activeIndex: 1 }))
			.mockResolvedValueOnce(fail(504, { error: 'iterate_timeout', message: 'Iteration timed out.' }))
			.mockResolvedValueOnce(ok({ kind: 'shape', glbUrl: V2, lineage: [L0, L1, { ...L2, parentIndex: 1 }], activeIndex: 2 }));
		await load();
		await submit('make it red');
		await submit('add wings');

		expect($('viewer').getAttribute('src')).toBe(V1);
		expect($('iterate-status').textContent).toMatch(/unchanged/i);
		const retry = [...$('iterate-recover').querySelectorAll('button')].find((b) => /retry/i.test(b.textContent));
		expect(retry).toBeTruthy();

		retry.click();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
		await vi.waitFor(() => expect($('viewer').getAttribute('src')).toBe(V2));
		const [, failed, retried] = sentBodies();
		expect(retried).toEqual(failed);
		expect(retried.parent_index).toBe(1);
	});

	it('branches from an earlier version, keeps later ones, and sends the lineage', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(ok({ kind: 'look', glbUrl: V1, lineage: [L0, L1], activeIndex: 1 }))
			.mockResolvedValueOnce(ok({ kind: 'shape', glbUrl: V2, lineage: [L0, L1, L2], activeIndex: 2 }));
		await load();
		await submit('make it red');

		$('iterate-lineage').querySelector('[data-index="0"]').click();
		expect($('viewer').getAttribute('src')).toBe(ORIGIN);
		await submit('add wings');

		const second = sentBodies()[1];
		expect(second.parent_index).toBe(0);
		expect(second.glb_url).toBe(ORIGIN);
		expect(second.parent_lineage.map((v) => v.glbUrl)).toEqual([ORIGIN, V1]);
		expect($('iterate-lineage').querySelectorAll('.iterate-version')).toHaveLength(3);
		expect($('iterate-chain').textContent).toContain('add wings');
		expect($('iterate-chain').textContent).not.toContain('make it red');
		expect($('iterate-inputs').textContent).toContain('seed 4242');
	});

	it('says before sending whether a change keeps the shape, and lets the user override it', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(ok({ kind: 'shape', glbUrl: V2, lineage: [L0, L2], activeIndex: 1 }));
		await load();
		$('iterate-instruction').value = 'make it red';
		$('iterate-instruction').dispatchEvent(new Event('input'));
		expect($('iterate-hint').textContent).toMatch(/keeps this exact shape/i);

		$('iterate-mode-toggle').click();
		expect($('iterate-hint').textContent).toMatch(/rebuilds/i);
		$('iterate-form').dispatchEvent(new Event('submit', { cancelable: true }));
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
		expect(sentBodies()[0].mode).toBe('shape');
	});

	it('an empty instruction sends nothing and says what to type', async () => {
		globalThis.fetch = vi.fn();
		await load();
		$('iterate-instruction').value = '   ';
		$('iterate-form').dispatchEvent(new Event('submit', { cancelable: true }));
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect($('iterate-status').textContent).toMatch(/describe the change/i);
	});

	it('a different object offers a fresh generation of it instead of overwriting this model', async () => {
		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			fail(422, { error: 'different_object', message: 'That describes a different object.', suggested_prompt: 'a castle' }),
		);
		await load();
		const run = vi.fn();
		document.addEventListener('forge:run-prompt', (e) => run(e.detail.prompt));
		await submit('turn it into a castle');
		const gen = [...$('iterate-recover').querySelectorAll('button')].find((b) => b.textContent.includes('a castle'));
		gen.click();
		expect(run).toHaveBeenCalledWith('a castle');
		expect($('viewer').getAttribute('src')).toBe(ORIGIN);
	});

	it('Try again re-runs the selected version from its own parent as a sibling', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(ok({ kind: 'shape', glbUrl: V2, lineage: [L0, { ...L2, index: 1 }], activeIndex: 1 }))
			.mockResolvedValueOnce(ok({ kind: 'shape', glbUrl: V1, lineage: [L0, { ...L2, index: 1 }, { ...L2, index: 2, glbUrl: V1 }], activeIndex: 2 }));
		await load();
		await submit('add wings');
		$('iterate-again').click();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
		const again = sentBodies()[1];
		expect(again).toMatchObject({ instruction: 'add wings', mode: 'shape', parent_index: 0 });
		expect(again.seed).toBeUndefined();
	});

	it('More like this lands in the same history as a variation', async () => {
		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			ok({ kind: 'variation', glbUrl: V2, lineage: [L0, { ...L2, index: 1, refKind: 'variation', instruction: null, inputs: { mode: 'variation' } }], activeIndex: 1 }),
		);
		await load();
		document.dispatchEvent(new CustomEvent('forge:iterate-request', { detail: { mode: 'variation' } }));
		await vi.waitFor(() => expect($('viewer').getAttribute('src')).toBe(V2));
		expect(sentBodies()[0]).toMatchObject({ mode: 'variation', glb_url: ORIGIN });
		expect(sentBodies()[0].instruction).toBeUndefined();
		expect($('iterate-lineage').textContent).toContain('Take');
	});

	it('compares two versions side by side, starting with the selected one and its parent', async () => {
		globalThis.fetch = vi.fn().mockResolvedValueOnce(ok({ kind: 'look', glbUrl: V1, lineage: [L0, L1], activeIndex: 1 }));
		await load();
		await submit('make it red');
		$('iterate-compare-open').click();
		await vi.waitFor(() => expect($('iterate-compare-view-b').getAttribute('src')).toBe(V1));
		expect($('iterate-compare-view-a').getAttribute('src')).toBe(ORIGIN);
		expect($('iterate-compare').classList.contains('is-hidden')).toBe(false);
	});

	it('keeps the history across a reload of the same model', async () => {
		globalThis.fetch = vi.fn().mockResolvedValueOnce(ok({ kind: 'look', glbUrl: V1, lineage: [L0, L1], activeIndex: 1 }));
		await load();
		await submit('make it red');

		mount();
		await load();
		expect($('iterate-lineage').querySelectorAll('.iterate-version')).toHaveLength(2);
		expect($('iterate-status').textContent).toMatch(/restored/i);
	});
});
