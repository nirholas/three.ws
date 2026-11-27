// @vitest-environment jsdom
//
// The Forge "Rig for animation" button (src/forge-rig.js). Measured on
// production 2026-11-27, the page:
//   - sent only the GLB URL, so the server could not name the subject (figure,
//     creature or object) from the prompt the user typed;
//   - offered "Try again" on a refusal ("a katana has no limbs") that would only
//     repeat itself;
//   - said nothing about the allowance when the worker failed, though a failed
//     job is refunded;
//   - followed the viewer to a tab-local blob (a Materials look, its own
//     preview), which the rigger cannot fetch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SAVED = 'https://three.ws/cdn/forge/226dffec03be/0f5b1c2e-knight.glb';
const JOB = 'job_abcdefghijklmnopqrstu';

function mountPage(src = '') {
	document.body.innerHTML = `
		<div id="state-result">
			<p id="result-label">Knight</p>
			<div class="result-bar"><div class="actions">
				<a id="download" href="${SAVED}" download="knight.glb">Download</a>
			</div></div>
		</div>
		<model-viewer id="viewer" ${src ? `src="${src}"` : ''}></model-viewer>`;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function ready(detail = { glbUrl: SAVED, label: 'a knight in plate armour', creationId: 'c0ffee00-1111-2222-3333-444455556666' }) {
	document.dispatchEvent(new CustomEvent('forge:model-ready', { detail }));
}

const posts = () => globalThis.fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
const panel = () => document.getElementById('rig-panel');
const button = () => document.getElementById('forge-rig-btn');

describe('Rig button', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	});
	afterEach(() => {
		vi.useRealTimers();
		delete globalThis.fetch;
	});

	it('sends the creation and the prompt, so the server can name the subject', async () => {
		globalThis.fetch = vi.fn(async () => json({ job_id: JOB, status: 'queued', subject: 'humanoid' }, 202));
		mountPage();
		await import('../src/forge-rig.js');
		ready();

		button().click();
		await vi.waitFor(() => expect(posts()).toHaveLength(1));

		expect(JSON.parse(posts()[0][1].body)).toEqual({
			glb_url: SAVED,
			creation_id: 'c0ffee00-1111-2222-3333-444455556666',
			prompt: 'a knight in plate armour',
		});
		expect(button().dataset.state).toBe('working');
		expect(button().disabled).toBe(true);
	});

	it('shows a refusal in the server\'s words, with no Try again', async () => {
		globalThis.fetch = vi.fn(async () =>
			json(
				{
					error: 'rig_not_riggable',
					title: 'This model cannot be rigged',
					message: 'A katana has no limbs to move, so a skeleton would not animate it. Use Animate to spin or float it instead.',
				},
				422,
			),
		);
		mountPage();
		await import('../src/forge-rig.js');
		ready();

		button().click();
		await vi.waitFor(() => expect(panel().dataset.kind).toBe('refused'));

		expect(panel().textContent).toMatch(/A katana has no limbs/);
		expect(panel().textContent).toMatch(/This model cannot be rigged/);
		expect(document.getElementById('rig-retry')).toBeNull();
		expect(button().dataset.state).toBe('failed');
		expect(button().disabled).toBe(false);
	});

	it('turns a worker failure into a clear message with Try again, and says it was not counted', async () => {
		globalThis.fetch = vi.fn(async (url, init) =>
			init?.method === 'POST'
				? json({ job_id: JOB, status: 'queued', subject: 'humanoid' }, 202)
				: json({ status: 'failed', error: 'The engine ran out of resources. Try again with a simpler request.' }),
		);
		mountPage();
		await import('../src/forge-rig.js');
		ready();

		button().click();
		await vi.waitFor(() => expect(posts()).toHaveLength(1));
		await vi.advanceTimersByTimeAsync(2600);
		await vi.waitFor(() => expect(panel().dataset.kind).toBe('failed'));

		expect(panel().textContent).toMatch(/ran out of resources/);
		expect(panel().textContent).toMatch(/does not count against your rig allowance/);
		expect(document.getElementById('rig-retry')).not.toBeNull();
	});

	it('keeps waiting while a cold worker starts, and says so', async () => {
		globalThis.fetch = vi.fn(async (url, init) =>
			init?.method === 'POST' ? json({ job_id: JOB, status: 'queued', subject: 'creature' }, 202) : json({ status: 'running' }),
		);
		mountPage();
		await import('../src/forge-rig.js');
		ready();

		button().click();
		await vi.waitFor(() => expect(panel().textContent).toMatch(/one is starting now/));

		// Past the old four-minute cut-off: still waiting, not failed.
		await vi.advanceTimersByTimeAsync(4.5 * 60 * 1000);
		expect(panel().dataset.kind).toBe('working');
		expect(panel().textContent).toMatch(/creature/);
		expect(button().dataset.state).toBe('working');
	});

	it('ignores a tab-local blob in the viewer and rigs the saved model', async () => {
		globalThis.fetch = vi.fn(async () => json({ job_id: JOB, status: 'queued' }, 202));
		mountPage(SAVED);
		await import('../src/forge-rig.js');
		document.getElementById('viewer').setAttribute('src', 'blob:https://three.ws/8b1c2d3e-look');
		await vi.advanceTimersByTimeAsync(0);

		button().click();
		await vi.waitFor(() => expect(posts()).toHaveLength(1));

		expect(JSON.parse(posts()[0][1].body).glb_url).toBe(SAVED);
	});
});
