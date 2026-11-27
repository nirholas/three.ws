// src/forge-inflight.js: the Forge page's handle on a generation that must
// survive a reload, a closed tab, a dropped connection and a double submit.
//
// What these pin, each one a way the page used to lose or duplicate a job:
//   • the record is written BEFORE the generation POST, so a reload during the
//     30 to 45 s submit (art direction plus reference image) can still collect
//     the job by replaying the same request under the same Idempotency-Key;
//   • the record outlives the server's own job allowance, so a reopened page
//     never forgets a job the server is still allowed to finish;
//   • a second tab submitting the same request joins the first one's job;
//   • the POST rides out 409 idempotency_in_progress instead of failing, and a
//   dropped connection is reported as "still being made", never as a failure;
//   • one tab can only start one run at a time, however fast the input arrives.

import { describe, it, expect, vi } from 'vitest';
import {
	INFLIGHT_KEY,
	RESUME_WINDOW_MS,
	createInflightStore,
	requestFingerprint,
	newIdempotencyKey,
	keepsInflight,
	postGenerationOnce,
	createRunGate,
} from '../src/forge-inflight.js';
import { FORGE_JOB_HARD_TTL_MINUTES } from '../api/_lib/forge-job-deadline.js';

// A Storage stand-in with the same three methods localStorage exposes. Two
// stores built on one storage are two page loads of the same origin.
function memoryStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		raw: map,
	};
}

const BODY = {
	prompt: 'a brass lantern',
	path: 'text',
	tier: 'standard',
	backend: 'trellis_selfhost',
	director: true,
	seed: 1234,
	progress_id: 'p-1',
};

describe('inflight record', () => {
	it('exists before the job does, so a reload mid-submit can collect it', () => {
		const storage = memoryStorage();
		const tab = createInflightStore({ storage, now: () => 1_000 });
		tab.beginSubmit({ key: 'key-1', body: BODY, label: 'a brass lantern' });

		const reloaded = createInflightStore({ storage, now: () => 31_000 });
		const rec = reloaded.read();
		expect(rec.phase).toBe('submitting');
		expect(rec.key).toBe('key-1');
		expect(rec.body).toEqual(BODY);
		expect(rec.jobId).toBeNull();
	});

	it('keeps the key and start time when the job id arrives', () => {
		const storage = memoryStorage();
		let t = 1_000;
		const tab = createInflightStore({ storage, now: () => t });
		tab.beginSubmit({ key: 'key-1', body: BODY, label: 'lantern' });
		t = 40_000;
		tab.attachJob({ job_id: 'f1.abc.sig', creation_id: 'c-1', backend: 'trellis_selfhost', tier: 'standard', path: 'text' });

		const rec = createInflightStore({ storage, now: () => t }).read();
		expect(rec.phase).toBe('polling');
		expect(rec.jobId).toBe('f1.abc.sig');
		expect(rec.creationId).toBe('c-1');
		expect(rec.key).toBe('key-1');
		expect(rec.startedAt).toBe(1_000);
		expect(rec.label).toBe('lantern');
	});

	it('records a job that was never preceded by a submit record (gallery replay)', () => {
		const storage = memoryStorage();
		const tab = createInflightStore({ storage, now: () => 5 });
		tab.attachJob({ job_id: 'f1.xyz.sig' }, { label: 'replayed' });
		expect(tab.read().jobId).toBe('f1.xyz.sig');
		expect(tab.read().label).toBe('replayed');
	});

	it('outlives the server allowance, then expires and clears itself', () => {
		expect(RESUME_WINDOW_MS).toBeGreaterThan(FORGE_JOB_HARD_TTL_MINUTES * 60_000);
		const storage = memoryStorage();
		const tab = createInflightStore({ storage, now: () => 0 });
		tab.beginSubmit({ key: 'k', body: BODY, label: '' });
		tab.attachJob({ job_id: 'f1.a.b' });
		expect(createInflightStore({ storage, now: () => FORGE_JOB_HARD_TTL_MINUTES * 60_000 }).read()).not.toBeNull();
		expect(createInflightStore({ storage, now: () => RESUME_WINDOW_MS + 1 }).read()).toBeNull();
		expect(storage.raw.has(INFLIGHT_KEY)).toBe(false);
	});

	it('reads a record written by the previous page version (job id only)', () => {
		const storage = memoryStorage();
		storage.setItem(INFLIGHT_KEY, JSON.stringify({ jobId: 'f1.old.sig', label: 'x', startedAt: 10 }));
		const rec = createInflightStore({ storage, now: () => 20 }).read();
		expect(rec.jobId).toBe('f1.old.sig');
		expect(rec.phase).toBe('polling');
	});

	it('drops a malformed record instead of resuming garbage', () => {
		const storage = memoryStorage();
		storage.setItem(INFLIGHT_KEY, '{"phase":"submitting","startedAt":5}');
		expect(createInflightStore({ storage, now: () => 6 }).read()).toBeNull();
		storage.setItem(INFLIGHT_KEY, 'not json');
		expect(createInflightStore({ storage, now: () => 6 }).read()).toBeNull();
		expect(storage.raw.has(INFLIGHT_KEY)).toBe(false);
	});

	it('works with storage blocked (private mode): nothing persists, nothing throws', () => {
		const storage = {
			getItem() {
				throw new Error('SecurityError');
			},
			setItem() {
				throw new Error('QuotaExceededError');
			},
			removeItem() {
				throw new Error('SecurityError');
			},
		};
		const tab = createInflightStore({ storage, now: () => 1 });
		expect(() => tab.beginSubmit({ key: 'k', body: BODY, label: '' })).not.toThrow();
		expect(tab.read()).toBeNull();
		expect(() => tab.clear()).not.toThrow();
	});
});

describe('the same request from a second tab', () => {
	it('matches regardless of the per-run seed and trace id', () => {
		const storage = memoryStorage();
		const tabA = createInflightStore({ storage, now: () => 1 });
		tabA.beginSubmit({ key: 'key-A', body: BODY, label: '' });

		const tabB = createInflightStore({ storage, now: () => 2 });
		const match = tabB.matching({ ...BODY, seed: 99, progress_id: 'p-2' });
		expect(match?.key).toBe('key-A');
	});

	it('does not match a different request', () => {
		const storage = memoryStorage();
		const tab = createInflightStore({ storage, now: () => 1 });
		tab.beginSubmit({ key: 'k', body: BODY, label: '' });
		expect(tab.matching({ ...BODY, prompt: 'a copper kettle' })).toBeNull();
		expect(tab.matching({ ...BODY, tier: 'high' })).toBeNull();
		expect(tab.matching({ ...BODY, backend: 'trellis2' })).toBeNull();
	});

	it('fingerprints key order out', () => {
		const reordered = Object.fromEntries(Object.entries(BODY).reverse());
		expect(requestFingerprint(reordered)).toBe(requestFingerprint(BODY));
		expect(requestFingerprint({ ...BODY, image_urls: ['a', 'b'] })).not.toBe(
			requestFingerprint({ ...BODY, image_urls: ['b', 'a'] }),
		);
	});
});

describe('newIdempotencyKey', () => {
	it('is unique per call and fits the server limit', () => {
		const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
		expect(keys.size).toBe(50);
		for (const k of keys) expect(k.length).toBeLessThanOrEqual(200);
	});
});

describe('keepsInflight', () => {
	it('keeps the record only when the job may still be alive', () => {
		expect(keepsInflight({ kind: 'transport_lost' })).toBe(true);
		expect(keepsInflight({ kind: 'still_running' })).toBe(true);
		expect(keepsInflight({ kind: 'lane_failed' })).toBe(false);
		expect(keepsInflight(new Error('Generation failed.'))).toBe(false);
		expect(keepsInflight(null)).toBe(false);
	});
});

function response(status, body, headers = {}) {
	return { status, ok: status >= 200 && status < 300, headers: new Map(Object.entries(headers)), json: async () => body };
}

describe('postGenerationOnce', () => {
	it('sends the key and the exact body, and returns the answer', async () => {
		const fetchImpl = vi.fn(async () => response(200, { job_id: 'f1.j.s', status: 'queued' }));
		const { res, data } = await postGenerationOnce({
			url: '/api/forge',
			body: BODY,
			key: 'key-1',
			headers: { 'x-forge-client': 'c' },
			fetchImpl,
			sleep: async () => {},
		});
		expect(res.status).toBe(200);
		expect(data.job_id).toBe('f1.j.s');
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('/api/forge');
		expect(init.method).toBe('POST');
		expect(init.headers['idempotency-key']).toBe('key-1');
		expect(init.headers['content-type']).toBe('application/json');
		expect(init.headers['x-forge-client']).toBe('c');
		expect(JSON.parse(init.body)).toEqual(BODY);
	});

	it('waits out a duplicate that is still running and collects the first job', async () => {
		const answers = [
			response(409, { error: 'idempotency_in_progress', retry_after: 2 }),
			response(409, { error: 'idempotency_in_progress', retry_after: 2 }),
			response(200, { job_id: 'f1.first.s', status: 'queued' }, { 'idempotent-replayed': 'true' }),
		];
		const fetchImpl = vi.fn(async () => answers.shift());
		const sleep = vi.fn(async () => {});
		const onWaiting = vi.fn();
		const { data } = await postGenerationOnce({ url: '/api/forge', body: BODY, key: 'k', fetchImpl, sleep, onWaiting });
		expect(data.job_id).toBe('f1.first.s');
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledWith(2000);
		expect(onWaiting).toHaveBeenCalledTimes(2);
		// Every retry is the same request under the same key.
		for (const [, init] of fetchImpl.mock.calls) {
			expect(init.headers['idempotency-key']).toBe('k');
			expect(JSON.parse(init.body)).toEqual(BODY);
		}
	});

	it('gives up waiting with "still running", never "failed"', async () => {
		let t = 0;
		const fetchImpl = vi.fn(async () => response(409, { error: 'idempotency_in_progress', retry_after: 2 }));
		const sleep = async (ms) => {
			t += ms;
		};
		const err = await postGenerationOnce({ url: '/api/forge', body: BODY, key: 'k', fetchImpl, sleep, now: () => t, maxWaitMs: 10_000 }).catch((e) => e);
		expect(err.kind).toBe('still_running');
		expect(keepsInflight(err)).toBe(true);
		// forgeErrorDescriptor only shows an error's own words when it is marked
		// userFacing; without it the page would replace this with "failed" copy.
		expect(err.userFacing).toBe(true);
		expect(err.title).toBeTruthy();
	});

	it('reports a dropped connection as a job that may still be running', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		const err = await postGenerationOnce({ url: '/api/forge', body: BODY, key: 'k', fetchImpl, sleep: async () => {} }).catch((e) => e);
		expect(err.kind).toBe('transport_lost');
		expect(keepsInflight(err)).toBe(true);
		expect(err.message).toMatch(/reopen/i);
		expect(err.userFacing).toBe(true);
		expect(err.title).toBeTruthy();
	});

	it('hands any other answer straight back for the page to classify', async () => {
		const fetchImpl = vi.fn(async () => response(429, { error: 'rate_limited', retry_after: 30 }));
		const { res, data } = await postGenerationOnce({ url: '/api/forge', body: BODY, key: 'k', fetchImpl, sleep: async () => {} });
		expect(res.status).toBe(429);
		expect(data.error).toBe('rate_limited');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

describe('createRunGate', () => {
	it('lets exactly one run in, however fast the input arrives', () => {
		const gate = createRunGate();
		const first = gate.enter();
		expect(first).toBeTruthy();
		expect(gate.enter()).toBe(0);
		expect(gate.enter()).toBe(0);
		expect(gate.busy).toBe(true);
		expect(gate.leave(first)).toBe(true);
		expect(gate.busy).toBe(false);
		expect(gate.enter()).toBeTruthy();
	});

	it('hands off to a run started by the one that is ending (automatic lane hop)', () => {
		const gate = createRunGate();
		const first = gate.enter();
		const hop = gate.enter({ handoff: true });
		expect(hop).toBeTruthy();
		// The failed run's cleanup must not end the hop it started.
		expect(gate.leave(first)).toBe(false);
		expect(gate.busy).toBe(true);
		expect(gate.leave(hop)).toBe(true);
	});

	it('a cancel frees the tab at once, and the cancelled run cannot end the next one', () => {
		const gate = createRunGate();
		const cancelled = gate.enter();
		gate.reset();
		const next = gate.enter();
		expect(next).toBeTruthy();
		expect(gate.leave(cancelled)).toBe(false);
		expect(gate.busy).toBe(true);
	});
});
