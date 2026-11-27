// @vitest-environment jsdom
//
// Stylize runs on a worker, so it must send the worker a model the server can
// fetch. Bug reproduced 2026-11-27: after an on-device tool (a Materials look,
// Refine, the Optimize mesh tools) put a `blob:` URL in the viewer, Stylize's
// src observer adopted that blob as its source model, and the next filter click
// POSTed `mesh_url: "blob:..."`, which /api/forge-stylize rejects with
// invalid_mesh_url. Stylize now keeps the last saved model and ignores
// tab-local edits. A model that only exists in the tab gets an honest note
// instead of a doomed request.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SAVED = 'https://three.ws/cdn/forge/nvidia/4069e114-0f2e-4ec1-ae77-8b2cad540366.glb';
const RESULT = 'https://storage.googleapis.com/three-ws-avatar-reconstructions/stylize/c22471f6.glb';

function mountPanel(src) {
	document.body.innerHTML = `
		<div id="state-result"><p id="result-label">Robot</p></div>
		<model-viewer id="viewer" ${src ? `src="${src}"` : ''}></model-viewer>
		<div class="stylize" id="stylize-panel" data-busy="false" hidden>
			<div id="stylize-gallery"></div>
			<div class="stylize-controls is-hidden" id="stylize-controls">
				<label id="stylize-res-label" for="stylize-res">Resolution</label>
				<input type="range" id="stylize-res" min="8" max="96" value="32" />
				<output id="stylize-res-val">32</output>
				<button type="button" id="stylize-apply">Re-apply</button>
				<a id="stylize-download" download hidden>Download</a>
				<button type="button" id="stylize-revert" hidden>Revert</button>
			</div>
			<p id="stylize-status" role="status"></p>
		</div>`;
}

const flushObservers = () => new Promise((r) => setTimeout(r, 0));

describe('Stylize source model', () => {
	beforeEach(() => {
		vi.resetModules();
		globalThis.fetch = vi.fn(async (url, init) => {
			if (init?.method === 'POST') {
				return new Response(JSON.stringify({ job_id: 'job_abcdefghijklmnopqrstu', status: 'queued' }), { status: 202 });
			}
			return new Response(JSON.stringify({ status: 'done', result_url: RESULT, face_count: 38916 }), { status: 200 });
		});
	});
	afterEach(() => {
		delete globalThis.fetch;
	});

	it('keeps stylizing the saved model after another tool shows a local blob edit', async () => {
		mountPanel(SAVED);
		await import('../src/forge-stylize.js');
		const viewer = document.getElementById('viewer');
		viewer.setAttribute('src', 'blob:https://three.ws/8b1c2d3e-look');
		await flushObservers();

		document.querySelector('.stylize-card[data-style="voxel"]').click();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
		const post = globalThis.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
		expect(JSON.parse(post[1].body).mesh_url).toBe(SAVED);
	});

	it('a model that only exists in this tab gets an honest note, not a doomed request', async () => {
		mountPanel('');
		await import('../src/forge-stylize.js');
		document.dispatchEvent(
			new CustomEvent('forge:model-ready', { detail: { glbUrl: 'blob:https://three.ws/local-only', label: 'Local' } }),
		);
		const panel = document.getElementById('stylize-panel');
		expect(panel.hidden).toBe(false);
		document.querySelector('.stylize-card[data-style="voxel"]').click();
		await flushObservers();
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(document.getElementById('stylize-status').textContent).toMatch(/saved model/i);
	});

	it('the Forge Studio page loads the same panel code, so the fix reaches both pages', async () => {
		mountPanel(SAVED);
		await import('../src/forge-studio/forge-stylize.js');
		document.getElementById('viewer').setAttribute('src', 'blob:https://three.ws/studio-look');
		await flushObservers();
		document.querySelector('.stylize-card[data-style="voxel"]').click();
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
		const post = globalThis.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
		expect(JSON.parse(post[1].body).mesh_url).toBe(SAVED);
	});
});
