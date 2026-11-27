// @vitest-environment jsdom
//
// The Forge "Restyle materials" panel (src/forge-materials.js).
//
// Bugs reproduced 2026-11-27 against the old panel:
//   - every preset chip ("Chrome", "Brushed gold", ...) POSTed a free-text
//     instruction to the language-model restyle, so a plain material swap waited
//     on a server, burned the account's restyle quota, and failed outright when
//     the provider was down;
//   - a failed restyle showed the server's raw `message`, and nothing offered the
//     looks that need no server;
//   - there was no history: Revert was the only way back, an earlier look could
//     not be reached again, and the page's main Download kept handing out the
//     original after a restyle;
//   - a shape request ("make it voxel") went to the material restyle anyway.
//
// The panel now applies preset looks on this device (src/shared/glb-material-restyle.js
// rewrites only the glTF JSON chunk), keeps a history the user can step through,
// points both downloads at the look on screen, and sends free text through the
// shared checks and the bounded client in src/shared/material-restyle-client.js.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readGlb } from '../src/shared/glb-material-restyle.js';

const SRC = 'https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb';
const AI_RESULT = 'https://three.ws/cdn/material-studio/restyle/262f0875-9035-40e7-9869-de41bfd66819.glb';
const CANDLE = new Uint8Array(readFileSync(resolve('public/objects/kenney-graveyard/glb/candle.glb')));

const blobs = new Map();
let blobSeq = 0;

function mount(src = SRC) {
	document.body.innerHTML = `
		<div id="state-result">
			<div class="result-bar">
				<p id="result-label">Robot</p>
				<div class="actions">
					<a class="btn btn--ghost" id="download" href="${src}" download="robot.glb">Download GLB</a>
					<button type="button" id="forge-iterate-btn" aria-expanded="false">Iterate</button>
				</div>
			</div>
		</div>
		<div id="iterate-panel" class="is-hidden"><input id="iterate-instruction" /></div>
		<model-viewer id="viewer" src="${src}"></model-viewer>`;
}

const $ = (sel) => document.querySelector(sel);
const viewerSrc = () => $('#viewer').getAttribute('src');
const restyleCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/api/material-studio'));
const steps = () => [...document.querySelectorAll('#materials-history .materials-step')];

function readBlob(blob) {
	return new Promise((res, rej) => {
		const fr = new FileReader();
		fr.onload = () => res(new Uint8Array(fr.result));
		fr.onerror = () => rej(fr.error);
		fr.readAsArrayBuffer(blob);
	});
}

async function pickLook(id) {
	const before = viewerSrc();
	$(`.materials-look[data-look="${id}"]`).click();
	await vi.waitFor(() => {
		expect(viewerSrc()).not.toBe(before);
		expect(viewerSrc()).toMatch(/^blob:/);
	});
	return viewerSrc();
}

function submitInstruction(text) {
	$('#materials-instruction').value = text;
	$('#materials-form').dispatchEvent(new Event('submit', { cancelable: true }));
}

let restyleReply;

async function load() {
	await import('../src/forge-materials.js');
	$('#forge-materials-btn').click();
}

beforeEach(() => {
	vi.resetModules();
	localStorage.clear();
	blobs.clear();
	blobSeq = 0;
	URL.createObjectURL = vi.fn((blob) => {
		const url = `blob:https://three.ws/look-${++blobSeq}`;
		blobs.set(url, blob);
		return url;
	});
	URL.revokeObjectURL = vi.fn((url) => blobs.delete(url));
	restyleReply = () => new Response(JSON.stringify({ ok: true, glbUrl: AI_RESULT, factors: { name: 'Polished marble' } }), { status: 200 });
	globalThis.fetch = vi.fn(async (url) => {
		if (String(url).includes('/api/material-studio')) return restyleReply();
		return new Response(CANDLE.slice().buffer, { status: 200 });
	});
});

afterEach(() => {
	delete globalThis.fetch;
	delete URL.createObjectURL;
	delete URL.revokeObjectURL;
});

describe('preset looks run on this device', () => {
	it('a preset makes no AI restyle request and changes only the materials: mesh, UVs and images stay byte-identical', async () => {
		mount();
		await load();
		const url = await pickLook('gold');

		expect(restyleCalls()).toHaveLength(0);
		const out = readGlb(await readBlob(blobs.get(url)));
		const src = readGlb(CANDLE);
		expect(Buffer.from(out.rest).equals(Buffer.from(src.rest))).toBe(true);
		expect(out.json.accessors).toEqual(src.json.accessors);
		expect(out.json.meshes).toEqual(src.json.meshes);
		expect(out.json.bufferViews).toEqual(src.json.bufferViews);
		for (const m of out.json.materials) {
			expect(m.pbrMetallicRoughness.metallicFactor).toBe(1);
			expect(m.pbrMetallicRoughness.metallicRoughnessTexture).toBeUndefined();
		}
		expect($('.materials-look[data-look="gold"]').getAttribute('aria-pressed')).toBe('true');
	});

	it('offers both groups, Finish and Material, every look as a pressable button', async () => {
		mount();
		await load();
		const groups = [...document.querySelectorAll('.materials-group')].map((g) => g.dataset.group);
		expect(groups).toEqual(['finish', 'material']);
		const looks = [...document.querySelectorAll('.materials-look')];
		expect(looks.length).toBe(15);
		for (const b of looks) {
			expect(b.tagName).toBe('BUTTON');
			expect(b.getAttribute('aria-pressed')).toBe('false');
		}
	});

	it('a model that cannot be downloaded gets an honest message and no look', async () => {
		mount();
		globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 }));
		await load();
		$('.materials-look[data-look="chrome"]').click();
		await vi.waitFor(() => expect($('#materials-status').dataset.kind).toBe('error'));
		expect($('#materials-status').textContent).toMatch(/could not load/i);
		expect(viewerSrc()).toBe(SRC);
	});
});

describe('history and downloads', () => {
	it('steps back to the original and to any earlier look, and both downloads hand out the look on screen', async () => {
		mount();
		await load();
		const gold = await pickLook('gold');
		const chrome = await pickLook('chrome');

		expect(steps().map((b) => b.textContent.trim())).toEqual(['Original', 'Gold', 'Chrome']);
		expect($('#materials-download').getAttribute('href')).toBe(chrome);
		expect($('#download').getAttribute('href')).toBe(chrome);
		expect($('#download').getAttribute('download')).toMatch(/chrome\.glb$/);

		steps()[1].click();
		expect(viewerSrc()).toBe(gold);
		expect($('#download').getAttribute('href')).toBe(gold);
		expect(steps()[1].getAttribute('aria-current')).toBe('true');

		steps()[0].click();
		expect(viewerSrc()).toBe(SRC);
		expect($('#download').getAttribute('href')).toBe(SRC);
		expect($('#download').getAttribute('download')).toBe('robot.glb');
		expect($('#download').textContent).toBe('Download GLB');
		expect($('#materials-download').hidden).toBe(true);

		steps()[2].click();
		$('#materials-revert').click();
		expect(viewerSrc()).toBe(SRC);
	});

	it('picking a look that is already in the history steps to it instead of stacking a copy', async () => {
		mount();
		await load();
		const gold = await pickLook('gold');
		await pickLook('chrome');
		$('.materials-look[data-look="gold"]').click();
		await vi.waitFor(() => expect(viewerSrc()).toBe(gold));
		expect(steps()).toHaveLength(3);
	});

	it('a new model clears the history and frees the old looks', async () => {
		mount();
		await load();
		const gold = await pickLook('gold');
		document.dispatchEvent(
			new CustomEvent('forge:model-ready', { detail: { glbUrl: 'https://three.ws/cdn/forge/nvidia/next.glb', label: 'Next' } }),
		);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith(gold);
		expect(steps()).toHaveLength(0);
		expect($('.materials-look[data-look="gold"]').getAttribute('aria-pressed')).toBe('false');
		expect(viewerSrc()).toBe('https://three.ws/cdn/forge/nvidia/next.glb');
	});

	it('re-announcing the same model resets to it, so the history never points at a look that is not on screen', async () => {
		mount();
		await load();
		await pickLook('gold');
		document.dispatchEvent(new CustomEvent('forge:model-ready', { detail: { glbUrl: SRC, label: 'Robot' } }));
		expect(viewerSrc()).toBe(SRC);
		expect(steps()).toHaveLength(0);
		expect($('#materials-download').hidden).toBe(true);
	});

	it('another tool showing its own edit makes that edit the new original and hands the page Download back', async () => {
		mount();
		await load();
		await pickLook('gold');
		$('#viewer').setAttribute('src', 'blob:https://three.ws/refined-elsewhere');
		await vi.waitFor(() => expect(steps()).toHaveLength(0));
		expect($('#download').getAttribute('href')).toBe(SRC);
		const clay = await pickLook('clay');
		expect(globalThis.fetch.mock.calls.some(([url]) => url === 'blob:https://three.ws/refined-elsewhere')).toBe(true);
		expect(steps().map((b) => b.textContent.trim())).toEqual(['Original', 'Clay']);
		expect($('#download').getAttribute('href')).toBe(clay);
	});
});

describe('AI restyle (free text)', () => {
	it('a down provider gives an honest message that offers the presets, and a preset still works right after', async () => {
		mount();
		restyleReply = () =>
			new Response(JSON.stringify({ error: 'no_provider', message: 'upstream 429 from provider-x org_abc123' }), { status: 503 });
		await load();
		submitInstruction('polished white marble');
		await vi.waitFor(() => expect($('#materials-status').dataset.kind).toBe('error'));
		const text = $('#materials-status').textContent;
		expect(text).toMatch(/preset/i);
		expect(text).not.toMatch(/provider-x|org_abc123|429/);
		expect(viewerSrc()).toBe(SRC);
		expect($('.materials-look[data-look="gold"]').disabled).toBe(false);
		await pickLook('gold');
	});

	it('a request that never answers can be cancelled and leaves the model as it was', async () => {
		mount();
		globalThis.fetch = vi.fn((url, init) => {
			if (!String(url).includes('/api/material-studio')) return Promise.resolve(new Response(CANDLE.slice().buffer));
			return new Promise((_r, reject) => {
				init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
			});
		});
		await load();
		submitInstruction('polished white marble');
		await vi.waitFor(() => expect($('#materials-working').hidden).toBe(false));
		expect($('#materials-working').textContent).toMatch(/AI restyle/i);
		expect($('.materials-look[data-look="gold"]').disabled).toBe(true);
		$('#materials-cancel').click();
		await vi.waitFor(() => expect($('#materials-working').hidden).toBe(true));
		expect(viewerSrc()).toBe(SRC);
		expect($('#materials-status').textContent).toMatch(/cancel/i);
		expect($('.materials-look[data-look="gold"]').disabled).toBe(false);
	});

	it('a successful restyle joins the history, and a finish look then builds on it', async () => {
		mount();
		await load();
		submitInstruction('  polished   white marble ');
		await vi.waitFor(() => expect(viewerSrc()).toBe(AI_RESULT));
		const [, init] = restyleCalls()[0];
		expect(JSON.parse(init.body)).toEqual({ glb_url: SRC, instruction: 'polished white marble' });
		expect($('#download').getAttribute('href')).toBe(AI_RESULT);

		await pickLook('glossy');
		expect(globalThis.fetch.mock.calls.some(([url]) => url === AI_RESULT)).toBe(true);
		expect(steps().map((b) => b.textContent.trim())).toEqual(['Original', 'Polished marble', 'Glossy']);
	});

	it('an instruction over 300 characters is refused before any request, with the shared check', async () => {
		mount();
		await load();
		submitInstruction('x'.repeat(301));
		expect(restyleCalls()).toHaveLength(0);
		expect($('#materials-status').textContent).toMatch(/300/);
	});

	it('a shape request points to the tool that changes shape instead of calling AI restyle', async () => {
		mount();
		await load();
		submitInstruction('make it voxel style');
		expect(restyleCalls()).toHaveLength(0);
		expect($('#materials-pointer').hidden).toBe(false);
		expect($('#materials-pointer-open').textContent).toMatch(/Open Stylize/);

		$('#materials-pointer-anyway').click();
		await vi.waitFor(() => expect(restyleCalls()).toHaveLength(1));
		expect($('#materials-pointer').hidden).toBe(true);
	});

	it('the Iterate pointer opens Iterate with the request already typed in', async () => {
		mount();
		await load();
		submitInstruction('give it bigger ears');
		expect(restyleCalls()).toHaveLength(0);
		expect($('#materials-pointer-open').textContent).toMatch(/Open Iterate/);
		$('#materials-pointer-open').click();
		expect($('#iterate-instruction').value).toBe('give it bigger ears');
	});

	it('a model that only exists in this tab still takes presets, and AI restyle says why it cannot run', async () => {
		mount('blob:https://three.ws/refined-locally');
		await load();
		await pickLook('clay');
		steps()[0].click();
		submitInstruction('polished white marble');
		await vi.waitFor(() => expect($('#materials-status').textContent).toMatch(/only exists in this tab/i));
		expect(restyleCalls()).toHaveLength(0);
	});
});
