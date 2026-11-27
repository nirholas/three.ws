// @vitest-environment jsdom
//
// Magic Brush (src/editor/magic-brush.js) must fail harmlessly: when the
// texture worker is absent, fails, times out or hands back something that will
// not load, the user keeps the model they had and is told what to do next.
// Only the HTTP boundary (fetch) and the viewer's loader are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MagicBrush, POLL_MS, MAX_TRANSIENT_POLL_ERRORS } from '../src/editor/magic-brush.js';

const ORIGINAL = 'https://three.ws/cdn/models/avatar.glb';
const RESULT = 'https://storage.googleapis.com/bucket/textured/task-1.glb';

function jsonResponse(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeBrush({ health = { ok: true, available: true } } = {}) {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const viewer = { el, content: null, load: vi.fn(async () => {}), invalidate() {} };
	const session = { sourceURL: ORIGINAL };
	const editor = { onContentChanged: vi.fn() };
	const brush = new MagicBrush(viewer, session, editor);
	// The canvas-backed preview needs a real 2D context, which jsdom lacks; the
	// flows under test never touch it.
	brush._initCanvases = () => {};
	brush._installPreview = () => {};
	brush._teardownPreview = () => {};
	brush._acquireTarget = () => {};
	global.fetch = vi.fn(async (url) => {
		if (String(url).includes('health=1')) return jsonResponse(200, health);
		throw new Error(`unexpected fetch ${url}`);
	});
	return { brush, viewer, editor };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => {
	vi.useRealTimers();
});

describe('Magic Brush is only offered when it can serve', () => {
	it('shows a designed unavailable state, not the paint controls, when the worker is not running', async () => {
		const { brush } = makeBrush({
			health: { ok: true, available: false, message: 'Magic Brush is not available on this deployment right now.' },
		});
		brush.enable();
		await flush();
		const panel = document.querySelector('.mb-panel');
		expect(panel.textContent).toMatch(/not available/i);
		expect(panel.querySelector('.mb-apply')).toBeNull();
		expect(panel.querySelector('.mb-recheck')).not.toBeNull();
	});

	it('shows the paint controls once the worker answers available', async () => {
		const { brush } = makeBrush();
		brush.targetMesh = {};
		brush.enable();
		await flush();
		expect(document.querySelector('.mb-apply')).not.toBeNull();
	});
});

describe('a failure leaves the original model in place', () => {
	it('a failed worker job never loads anything and says the model is unchanged', async () => {
		vi.useFakeTimers();
		const { brush, viewer, editor } = makeBrush();
		brush.targetMesh = {};
		brush.availability = 'available';
		brush.busy = true;
		global.fetch = vi.fn(async () =>
			jsonResponse(200, { ok: true, status: 'failed', error: 'The texture result lost the skeleton.' }),
		);
		brush._poll('tok');
		await vi.advanceTimersByTimeAsync(POLL_MS + 10);
		expect(viewer.load).not.toHaveBeenCalled();
		expect(editor.onContentChanged).not.toHaveBeenCalled();
		expect(brush.busy).toBe(false);
		expect(brush.status.kind).toBe('err');
		expect(brush.status.text).toMatch(/skeleton/);
		expect(brush.status.text).toMatch(/unchanged/i);
	});

	it('restores the original model when the finished result will not load', async () => {
		const { brush, viewer, editor } = makeBrush();
		viewer.load = vi.fn(async (url) => {
			if (url === RESULT) throw new Error('bad glb');
		});
		brush.busy = true;
		await brush._loadResult(RESULT);
		expect(viewer.load).toHaveBeenLastCalledWith(ORIGINAL, '', expect.any(Map));
		expect(editor.onContentChanged).not.toHaveBeenCalled();
		expect(brush.busy).toBe(false);
		expect(brush.status.text).toMatch(/unchanged/i);
	});

	it('a single dropped poll does not abandon a job that then finishes', async () => {
		vi.useFakeTimers();
		const { brush, viewer, editor } = makeBrush();
		brush.busy = true;
		let n = 0;
		global.fetch = vi.fn(async () => {
			n++;
			if (n === 1) throw new TypeError('Failed to fetch');
			if (n === 2) return jsonResponse(502, { error_description: 'provider_error' });
			return jsonResponse(200, { ok: true, status: 'done', result_url: RESULT });
		});
		brush._poll('tok');
		await vi.advanceTimersByTimeAsync(POLL_MS * 3 + 10);
		expect(viewer.load).toHaveBeenCalledWith(RESULT, '', expect.any(Map));
		expect(editor.onContentChanged).toHaveBeenCalledWith({ url: RESULT, name: 'task-1.glb' });
	});

	it('gives up after repeated poll failures with a retry path and the model untouched', async () => {
		vi.useFakeTimers();
		const { brush, viewer } = makeBrush();
		brush.busy = true;
		global.fetch = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		brush._poll('tok');
		await vi.advanceTimersByTimeAsync(POLL_MS * (MAX_TRANSIENT_POLL_ERRORS + 1) + 10);
		expect(viewer.load).not.toHaveBeenCalled();
		expect(brush.busy).toBe(false);
		expect(brush.status.kind).toBe('err');
		expect(brush.status.text).toMatch(/unchanged/i);
	});
});
