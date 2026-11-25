// Production logged `[oracle-social-ingest] timeline reads failed { nichxbt:
// 'not_found: User unavailable: Suspended' }` on every run: a suspended X handle
// stayed in the tracked list and was re-read (and re-failed) each tick. A
// terminally unavailable account must be reported once, then skipped until its
// quarantine expires.

import { describe, it, expect, vi } from 'vitest';
import { collectSocialBatch, isTerminalUnavailable } from '../api/_lib/oracle/social-feed.js';

const suspended = () => Object.assign(new Error('User unavailable: Suspended'), { reason: 'not_found' });

function memoryStore() {
	const set = new Set();
	return { has: async (h) => set.has(h), mark: async (h) => void set.add(h), set };
}

describe('isTerminalUnavailable', () => {
	it('recognises suspended, deactivated and unavailable accounts only', () => {
		expect(isTerminalUnavailable(suspended())).toBe(true);
		expect(isTerminalUnavailable(Object.assign(new Error('User unavailable: Deactivated'), { reason: 'not_found' }))).toBe(true);
		expect(isTerminalUnavailable(Object.assign(new Error('timeout'), { reason: 'upstream' }))).toBe(false);
		expect(isTerminalUnavailable(Object.assign(new Error('rate'), { reason: 'rate_limited' }))).toBe(false);
	});
});

describe('collectSocialBatch with a suspended handle', () => {
	it('reports it once, quarantines it, and does not read it on the next run', async () => {
		const store = memoryStore();
		const reader = vi.fn(async (h) => {
			if (h === 'gone') throw suspended();
			return { tweets: [] };
		});
		const first = await collectSocialBatch(['gone', 'ok'], { reader, unavailable: store });
		expect(first.unavailable).toEqual(['gone']);
		expect(first.failures).toEqual({});
		expect(first.read).toBe(1);

		reader.mockClear();
		const second = await collectSocialBatch(['gone', 'ok'], { reader, unavailable: store });
		expect(reader).toHaveBeenCalledTimes(1);
		expect(reader).toHaveBeenCalledWith('ok', expect.anything());
		expect(second.unavailable).toEqual([]);
		expect(second.quarantined).toEqual(['gone']);
	});

	it('still reports transient failures as failures', async () => {
		const reader = vi.fn(async () => {
			throw Object.assign(new Error('boom'), { reason: 'upstream' });
		});
		const out = await collectSocialBatch(['a'], { reader, unavailable: memoryStore() });
		expect(Object.keys(out.failures)).toEqual(['a']);
	});
});
