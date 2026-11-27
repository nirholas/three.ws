// @vitest-environment jsdom
//
// Iterate (src/forge-conversational-refine.js) sends the model to
// /api/forge-iterate by URL, so it has to be a URL the server can fetch. Bug
// reproduced 2026-11-27: once an on-device tool (a Materials look, Refine, the
// Optimize mesh tools) put a `blob:` URL in the viewer, Iterate's src observer
// adopted it as a new source model and the next instruction POSTed
// `glb_url: "blob:..."`, which the server cannot read. Iterate now keeps the
// last saved model and ignores tab-local edits; a model that only exists in the
// tab gets an honest note and no request.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SAVED = 'https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb';

function mount(src) {
	document.body.innerHTML = `
		<div id="state-result">
			<div class="result-bar"><p id="result-label">Robot</p><div class="actions"></div></div>
		</div>
		<model-viewer id="viewer" ${src ? `src="${src}"` : ''}></model-viewer>`;
}

const flushObservers = () => new Promise((r) => setTimeout(r, 0));

function submit(text) {
	document.getElementById('iterate-instruction').value = text;
	document.getElementById('iterate-form').dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('Iterate source model', () => {
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({ glbUrl: 'https://three.ws/cdn/forge/iterate/v1.glb', lineage: [{ glbUrl: SAVED }, { glbUrl: 'https://three.ws/cdn/forge/iterate/v1.glb', instruction: 'add a cape' }], activeIndex: 1 }),
				{ status: 200 },
			),
		);
	});
	afterEach(() => {
		delete globalThis.fetch;
	});

	it('keeps iterating on the saved model after another tool shows a local blob edit', async () => {
		mount(SAVED);
		await import('../src/forge-conversational-refine.js');
		document.getElementById('viewer').setAttribute('src', 'blob:https://three.ws/5c0ffee0-look');
		await flushObservers();

		submit('add a cape');
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
		const [, init] = globalThis.fetch.mock.calls[0];
		expect(JSON.parse(init.body).glb_url).toBe(SAVED);
	});

	it('a model that only exists in this tab gets a note, not a request the server cannot serve', async () => {
		mount('blob:https://three.ws/local-only');
		await import('../src/forge-conversational-refine.js');
		submit('add a cape');
		await flushObservers();
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(document.getElementById('iterate-status').textContent).toMatch(/saved model/i);
	});
});
