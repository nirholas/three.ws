// api/_lib/alerts.js builds its default alerter when the module loads. That
// must not touch the cache module's exports yet: http.js imports alerts.js, so
// any suite that mocks cache.js with only the functions it needs (for example
// `{ cacheSet }`) crashed on import with 'No "cacheGet" export is defined' once
// the default alerter captured `cacheGet` eagerly.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/cache.js', () => ({ cacheSet: vi.fn(async () => undefined) }));

describe('ops alerter default cache', () => {
	it('loads alongside a partial cache.js mock', async () => {
		const mod = await import('../api/_lib/alerts.js');
		expect(typeof mod.createOpsAlerter).toBe('function');
	});

	it('still reads and writes through the cache module when sending', async () => {
		const cache = await import('../api/_lib/cache.js');
		const { createOpsAlerter } = await import('../api/_lib/alerts.js');
		const telegram = vi.fn(async () => {});
		const alerter = createOpsAlerter({ transports: { telegram }, persist: async () => {}, environment: 'test' });
		const out = await alerter.send('lazy cache probe', 'detail', { severity: 'critical' });
		expect(out.pushed).toContain('telegram');
		expect(vi.mocked(cache.cacheSet)).toHaveBeenCalled();
	});
});
