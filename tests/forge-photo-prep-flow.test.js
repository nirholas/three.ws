// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PREP_WAIT } from '../src/forge-photo-prep/core.js';

// The real client and the real review dialog, with only the browser's Worker
// replaced by a scripted one. `script(worker, message)` decides how it answers.
class FakeWorker {
	static instances = [];
	static script = () => {};
	constructor() {
		this.terminated = false;
		FakeWorker.instances.push(this);
	}
	postMessage(msg) {
		FakeWorker.script(this, msg);
	}
	reply(msg, data) {
		this.onmessage?.({ data: { id: msg.id, ...data } });
	}
	terminate() {
		this.terminated = true;
	}
}

const photo = () => new File([new Uint8Array(2048)], 'shoe.jpg', { type: 'image/jpeg' });
const blob = (type) => new Blob([new Uint8Array(512)], { type });

function result(over = {}) {
	return {
		provider: 'wasm',
		width: 800,
		height: 600,
		removal: { status: 'model', reason: null },
		warnings: [],
		metrics: {},
		plan: { sx: 0, sy: 0, side: 500, outSize: 500 },
		prepared: blob('image/jpeg'),
		cutout: blob('image/webp'),
		timings: { modelMs: 10, inferenceMs: 10, totalMs: 20 },
		...over,
	};
}

let reviewPhoto;
const dialog = () => document.querySelector('dialog.pp-dialog');
const press = (value) => {
	const form = dialog().querySelector('form');
	const btn = form.querySelector(`button[value="${value}"]`);
	form.requestSubmit(btn);
};
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
	vi.useFakeTimers();
	FakeWorker.instances = [];
	FakeWorker.script = () => {};
	vi.stubGlobal('Worker', FakeWorker);
	vi.stubGlobal('OffscreenCanvas', class {});
	vi.stubGlobal('createImageBitmap', () => {});
	URL.createObjectURL = vi.fn(() => 'blob:test');
	URL.revokeObjectURL = vi.fn();
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute('open');
	};
	vi.resetModules();
	({ reviewPhoto } = await import('../src/forge-photo-prep/review.js'));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	document.body.innerHTML = '';
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a check that stalls never holds the photo hostage', () => {
	it('gives up on a worker that never answers and hands back the original to upload', async () => {
		const file = photo();
		const run = reviewPhoto(file);
		await vi.advanceTimersByTimeAsync(PREP_WAIT.loadIdleMs + 1000);
		const outcome = await run;
		expect(outcome.action).toBe('fallback');
		expect(outcome.file).toBe(file);
		expect(outcome.note).toMatch(/took too long/);
		expect(FakeWorker.instances[0].terminated).toBe(true);
	});

	it('gives up when a model download goes quiet part way', async () => {
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'progress', stage: 'model', loaded: 100, total: 4_574_861 });
		const file = photo();
		const run = reviewPhoto(file);
		await vi.advanceTimersByTimeAsync(PREP_WAIT.loadIdleMs + 1000);
		const outcome = await run;
		expect(outcome).toMatchObject({ action: 'fallback', file });
		expect(outcome.note).toMatch(/took too long/);
	});

	it('does not cut off a slow download that keeps moving, until the cap on the whole pass', async () => {
		FakeWorker.script = (w, msg) => {
			let loaded = 0;
			const timer = setInterval(() => {
				loaded += 1000;
				w.reply(msg, { type: 'progress', stage: 'model', loaded, total: 4_574_861 });
			}, 10_000);
			w.stop = () => clearInterval(timer);
		};
		const file = photo();
		let settled = null;
		const run = reviewPhoto(file).then((o) => (settled = o));
		await vi.advanceTimersByTimeAsync(PREP_WAIT.totalMs - 5000);
		expect(settled).toBeNull();
		await vi.advanceTimersByTimeAsync(10_000);
		await run;
		expect(settled).toMatchObject({ action: 'fallback', file });
		FakeWorker.instances.forEach((w) => w.stop?.());
	});

	it('falls back to the original when the worker crashes', async () => {
		FakeWorker.script = (w) => w.onerror({ message: 'wasm out of memory' });
		const file = photo();
		const outcome = await reviewPhoto(file);
		expect(outcome).toMatchObject({ action: 'fallback', file });
		expect(outcome.note).toMatch(/could not run/);
	});

	it('falls back when the worker reports an error for the photo', async () => {
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'error', message: 'decode failed' });
		const file = photo();
		expect(await reviewPhoto(file)).toMatchObject({ action: 'fallback', file });
	});

	it('starts a fresh worker for the next photo after one stalled', async () => {
		const first = reviewPhoto(photo());
		await vi.advanceTimersByTimeAsync(PREP_WAIT.loadIdleMs + 1000);
		await first;
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'result', result: result() });
		const second = reviewPhoto(photo());
		await flush();
		expect(FakeWorker.instances).toHaveLength(2);
		expect(dialog()).not.toBeNull();
		press('use');
		expect((await second).action).toBe('use');
	});
});

describe('a failed removal leaves the original as the way forward', () => {
	for (const reason of ['empty', 'whole_frame']) {
		it(`offers only the original when the mask is ${reason === 'empty' ? 'empty' : 'the whole frame'}`, async () => {
			FakeWorker.script = (w, msg) =>
				w.reply(msg, {
					type: 'result',
					result: result({
						removal: { status: 'failed', reason },
						warnings: [{ code: reason === 'empty' ? 'no_subject' : 'background_kept', message: 'raw warning' }],
						prepared: null,
						cutout: null,
					}),
				});
			const file = photo();
			const run = reviewPhoto(file);
			await flush();
			const d = dialog();
			expect(d.querySelector('[data-variant="prepared"]')).toBeNull();
			expect(d.querySelector('input[name="original"]')).toBeNull();
			expect(d.querySelector('[data-removal="failed"]').textContent).toMatch(reason === 'empty' ? /found no subject/ : /kept the whole picture/);
			expect(d.querySelector('.pp-warnings')).toBeNull();
			const primary = d.querySelector('button[value="use"]');
			expect(primary.textContent).toBe('Use original photo');
			press('use');
			expect(await run).toEqual({ action: 'use', file, prepared: false });
		});
	}

	it('still lets the visitor retake after a failed removal', async () => {
		FakeWorker.script = (w, msg) =>
			w.reply(msg, { type: 'result', result: result({ removal: { status: 'failed', reason: 'empty' }, prepared: null, cutout: null }) });
		const run = reviewPhoto(photo());
		await flush();
		press('retake');
		expect(await run).toEqual({ action: 'retake' });
	});

	it('closes the dialog and leaves nothing behind on Escape', async () => {
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'result', result: result() });
		const run = reviewPhoto(photo());
		await flush();
		dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
		expect(await run).toEqual({ action: 'cancel' });
		expect(dialog()).toBeNull();
	});
});

describe('the review of a good photo', () => {
	beforeEach(() => {
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'result', result: result() });
	});

	it('accepts the prepared crop', async () => {
		const run = reviewPhoto(photo());
		await flush();
		press('use');
		const out = await run;
		expect(out).toMatchObject({ action: 'use', prepared: true });
		expect(out.file.name).toBe('shoe-prepared.jpg');
		expect(out.file.type).toBe('image/jpeg');
	});

	it('sends the untouched original when the visitor ticks the toggle', async () => {
		const file = photo();
		const run = reviewPhoto(file);
		await flush();
		const toggle = dialog().querySelector('input[name="original"]');
		toggle.checked = true;
		toggle.dispatchEvent(new Event('change'));
		press('use');
		expect(await run).toEqual({ action: 'use', file, prepared: false });
	});
});

describe('a photo that is already cut out', () => {
	it('says removal was skipped and uploads its alpha crop, with no photo or cutout toggle', async () => {
		const alpha = blob('image/webp');
		FakeWorker.script = (w, msg) =>
			w.reply(msg, { type: 'result', result: result({ provider: 'alpha', removal: { status: 'alpha', reason: null }, prepared: alpha, cutout: alpha }) });
		const run = reviewPhoto(new File([new Uint8Array(100)], 'shoe.png', { type: 'image/png' }));
		await flush();
		const d = dialog();
		expect(d.querySelector('[data-removal="alpha"]').textContent).toMatch(/already has a transparent background/);
		expect(d.querySelector('.pp-seg')).toBeNull();
		expect(d.querySelector('.pp-ok')).toBeNull();
		press('use');
		const out = await run;
		expect(out.prepared).toBe(true);
		expect(out.file.type).toBe('image/webp');
		expect(out.file.name).toBe('shoe-prepared.webp');
	});
});

describe('the visitor can always move on while the check runs', () => {
	it('skips a check part way and hands back the original, with no dialog and the worker stopped', async () => {
		const ctl = new AbortController();
		const file = photo();
		const run = reviewPhoto(file, { signal: ctl.signal });
		await vi.advanceTimersByTimeAsync(5000);
		ctl.abort();
		const outcome = await run;
		expect(outcome).toMatchObject({ action: 'skipped', file });
		expect(outcome.note).toMatch(/skipped the photo check/);
		expect(FakeWorker.instances[0].terminated).toBe(true);
		expect(dialog()).toBeNull();
	});

	it('opens no dialog when the result arrives after the skip', async () => {
		let late = null;
		FakeWorker.script = (w, msg) => (late = () => w.reply(msg, { type: 'result', result: result() }));
		const ctl = new AbortController();
		const run = reviewPhoto(photo(), { signal: ctl.signal });
		await flush();
		ctl.abort();
		await run;
		late();
		await flush();
		expect(dialog()).toBeNull();
	});

	it('closes an open review when the photo is taken back', async () => {
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'result', result: result() });
		const ctl = new AbortController();
		const file = photo();
		const run = reviewPhoto(file, { signal: ctl.signal });
		await flush();
		expect(dialog()).not.toBeNull();
		ctl.abort();
		expect(await run).toMatchObject({ action: 'skipped', file });
		expect(dialog()).toBeNull();
		expect(URL.revokeObjectURL).toHaveBeenCalled();
	});

	it('lets a photo waiting behind another be skipped at once, and never checks it', async () => {
		const posted = [];
		FakeWorker.script = (w, msg) => posted.push(msg);
		const first = reviewPhoto(photo());
		const ctl = new AbortController();
		const second = photo();
		const run = reviewPhoto(second, { signal: ctl.signal });
		await flush();
		ctl.abort();
		expect(await run).toMatchObject({ action: 'skipped', file: second });
		FakeWorker.instances[0].reply(posted[0], { type: 'result', result: result() });
		await flush();
		press('use');
		await first;
		await flush();
		expect(posted).toHaveLength(1);
		expect(dialog()).toBeNull();
	});

	it('offers to go on with the original once the check runs slow, and only once', async () => {
		const onSlow = vi.fn();
		const run = reviewPhoto(photo(), { onSlow });
		await vi.advanceTimersByTimeAsync(PREP_WAIT.offerOriginalMs - 100);
		expect(onSlow).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		expect(onSlow).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(PREP_WAIT.totalMs);
		await run;
		expect(onSlow).toHaveBeenCalledTimes(1);
	});

	it('does not offer the skip when the check reaches review in time', async () => {
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'result', result: result() });
		const onSlow = vi.fn();
		const run = reviewPhoto(photo(), { onSlow });
		await flush();
		await vi.advanceTimersByTimeAsync(PREP_WAIT.offerOriginalMs * 2);
		expect(onSlow).not.toHaveBeenCalled();
		press('use');
		await run;
	});

	it('offers the skip before the bounded wait gives up on its own', () => {
		expect(PREP_WAIT.offerOriginalMs).toBeLessThan(PREP_WAIT.loadIdleMs);
		expect(PREP_WAIT.offerOriginalMs).toBeLessThan(PREP_WAIT.runIdleMs);
	});

	it('starts a fresh worker for the next photo after a skip', async () => {
		const ctl = new AbortController();
		const skipped = reviewPhoto(photo(), { signal: ctl.signal });
		await flush();
		ctl.abort();
		await skipped;
		FakeWorker.script = (w, msg) => w.reply(msg, { type: 'result', result: result() });
		const next = reviewPhoto(photo());
		await flush();
		expect(FakeWorker.instances).toHaveLength(2);
		press('use');
		expect((await next).action).toBe('use');
	});
});

describe('preparePhoto with a signal', () => {
	it('rejects at once, without starting the worker, when the signal is already aborted', async () => {
		const { preparePhoto } = await import('../src/forge-photo-prep/client.js');
		const ctl = new AbortController();
		ctl.abort();
		await expect(preparePhoto(photo(), { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
		expect(FakeWorker.instances).toHaveLength(0);
	});
});
