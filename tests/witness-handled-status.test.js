// @vitest-environment jsdom
//
// `x-witness: handled` on a request (packages/witness/src/recorder.js), and the
// reason /forge sends it on every /api/forge call.
//
// A page that renders a designed state for a status is not experiencing an
// unhandled failure. Without this opt-out the recorder counted every designed
// 503 from the generator (storage down, free lane unavailable) as a fatal
// event, which is what the feedback companion reads to decide whether to
// interrupt with "something just broke, want to report it?", an offer that at
// 320px landed directly on top of the Try again button the error state was
// showing.
//
// The event is still recorded either way. Only `fatal` changes, so a bug report
// the user does choose to file still carries the call.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Recorder } from '../packages/witness/src/recorder.js';

let recorder;

function startRecorder() {
	recorder = new Recorder({ captureNetwork: true });
	recorder.install();
}

describe('witness handled-status opt-out', () => {
	beforeEach(() => {
		window.fetch = vi.fn(async () => new Response('{}', { status: 503 }));
	});

	afterEach(() => {
		recorder?.uninstall();
		recorder = null;
	});

	it('counts an unmarked 5xx as a failure worth interrupting for', async () => {
		startRecorder();
		await window.fetch('/api/forge', { method: 'POST' });
		expect(recorder.hasFailure()).toBe(true);
	});

	it('records a marked 5xx but does not treat it as an unhandled failure', async () => {
		startRecorder();
		await window.fetch('/api/forge', { method: 'POST', headers: { 'x-witness': 'handled' } });
		expect(recorder.hasFailure()).toBe(false);
		expect(recorder.trace().events.some((e) => e.type === 'xhr' && e.detail.includes('503'))).toBe(true);
	});

	it('reads the marker from a Headers instance and ignores case', async () => {
		startRecorder();
		await window.fetch('/api/forge', { method: 'POST', headers: new Headers({ 'X-Witness': 'Handled' }) });
		expect(recorder.hasFailure()).toBe(false);
	});

	it('reads the marker from a Request object', async () => {
		startRecorder();
		await window.fetch(new Request('http://localhost/api/forge', { headers: { 'x-witness': 'handled' } }));
		expect(recorder.hasFailure()).toBe(false);
	});

	it('still counts a rejected request, marker or not', async () => {
		window.fetch = vi.fn(async () => {
			throw new Error('network error');
		});
		startRecorder();
		await window.fetch('/api/forge', { headers: { 'x-witness': 'handled' } }).catch(() => {});
		expect(recorder.hasFailure()).toBe(true);
	});
});
