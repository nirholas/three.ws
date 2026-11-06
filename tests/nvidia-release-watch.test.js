// The NVIDIA release watch inside the free-model audit. NVIDIA amplifies
// partners who ship its model launches on day 0, so a new id in the NIM
// catalog must page ops once, the first run must seed silently, and an
// unreachable catalog must never read as "everything is new".

import { describe, it, expect, afterEach, vi } from 'vitest';
import { diffNvidiaReleases, watchNvidiaReleases } from '../api/cron/free-model-audit.js';

const BASE = 'https://catalog.example/v1';

function respond(status, body = {}) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function memoryStore(initial) {
	const data = new Map(initial === undefined ? [] : [['k', initial]]);
	return {
		data,
		get: vi.fn(async (key) => (data.has(key) ? data.get(key) : null)),
		set: vi.fn(async (key, value) => {
			data.set(key, value);
		}),
	};
}

afterEach(() => vi.restoreAllMocks());

describe('diffNvidiaReleases', () => {
	it('seeds silently when there is no previous snapshot', () => {
		const out = diffNvidiaReleases(null, ['nvidia/a', 'meta/b']);
		expect(out.status).toBe('seeded');
		expect(out.added).toEqual([]);
		expect(out.seen).toEqual(['meta/b', 'nvidia/a']);
	});

	it('reports unknown and keeps the snapshot when the listing is empty', () => {
		const out = diffNvidiaReleases(['nvidia/a'], []);
		expect(out).toEqual({ status: 'unknown', added: [], nvidiaAdded: [], seen: ['nvidia/a'] });
	});

	it('flags new ids and calls out the NVIDIA-owned ones', () => {
		const out = diffNvidiaReleases(['nvidia/a', 'meta/b'], ['nvidia/a', 'meta/b', 'nvidia/c', 'vendor/d']);
		expect(out.status).toBe('new');
		expect(out.added).toEqual(['nvidia/c', 'vendor/d']);
		expect(out.nvidiaAdded).toEqual(['nvidia/c']);
	});

	it('never forgets an id a listing temporarily drops, so a flap cannot re-alert', () => {
		const dropped = diffNvidiaReleases(['nvidia/a', 'nvidia/b'], ['nvidia/a']);
		expect(dropped.status).toBe('none');
		expect(dropped.seen).toEqual(['nvidia/a', 'nvidia/b']);
		const back = diffNvidiaReleases(dropped.seen, ['nvidia/a', 'nvidia/b']);
		expect(back.status).toBe('none');
		expect(back.added).toEqual([]);
	});
});

describe('watchNvidiaReleases', () => {
	it('alerts once for a new release, then stays quiet on the next run', async () => {
		globalThis.fetch = vi.fn(async () => respond(200, { data: [{ id: 'nvidia/a' }, { id: 'nvidia/new-model' }] }));
		const store = memoryStore(['nvidia/a']);
		const alert = vi.fn(async () => {});

		const first = await watchNvidiaReleases({ base: BASE, key: 'k', cacheKey: 'k', get: store.get, set: store.set, alert });
		expect(first.status).toBe('new');
		expect(first.nvidiaAdded).toEqual(['nvidia/new-model']);
		expect(alert).toHaveBeenCalledTimes(1);
		expect(alert.mock.calls[0][1]).toContain('nvidia/new-model');

		const second = await watchNvidiaReleases({ base: BASE, key: 'k', cacheKey: 'k', get: store.get, set: store.set, alert });
		expect(second.status).toBe('none');
		expect(alert).toHaveBeenCalledTimes(1);
	});

	it('does not alert or overwrite the snapshot when the catalog is down', async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error('fetch failed: ECONNRESET');
		});
		const store = memoryStore(['nvidia/a']);
		const alert = vi.fn(async () => {});
		const out = await watchNvidiaReleases({ base: BASE, key: null, cacheKey: 'k', get: store.get, set: store.set, alert });
		expect(out.status).toBe('unknown');
		expect(alert).not.toHaveBeenCalled();
		expect(store.set).not.toHaveBeenCalled();
	});

	it('seeds the snapshot on the first run without alerting', async () => {
		globalThis.fetch = vi.fn(async () => respond(200, { data: [{ id: 'nvidia/a' }] }));
		const store = memoryStore();
		const alert = vi.fn(async () => {});
		const out = await watchNvidiaReleases({ base: BASE, key: null, cacheKey: 'k', get: store.get, set: store.set, alert });
		expect(out.status).toBe('seeded');
		expect(alert).not.toHaveBeenCalled();
		expect(store.data.get('k')).toEqual(['nvidia/a']);
	});
});
