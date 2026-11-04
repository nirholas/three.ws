import { describe, it, expect, vi } from 'vitest';
import { cellKey, coarsen, pollInterval, geolocationError, createPresence, PresenceError } from '../src/glass/presence.js';

const pos = { lat: 40.71234, lng: -74.00567, accuracy: 10 };
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('glass presence', () => {
	it('keys the ~110 m cell and coarsens sent coordinates', () => {
		expect(cellKey(40.71234, -74.00567)).toBe('40.712,-74.006');
		expect(coarsen(40.71234)).toBe(40.7123);
	});
	it('polls faster when moving, slower when hidden', () => {
		expect(pollInterval({ speedMps: 2 })).toBeLessThan(pollInterval({}));
		expect(pollInterval({ hidden: true })).toBeGreaterThan(pollInterval({ empty: true }));
	});
	it('maps geolocation errors to typed codes', () => {
		expect(geolocationError({ code: 1 }).code).toBe('denied');
		expect(geolocationError({ code: 3 }).code).toBe('timeout');
		expect(geolocationError({}).code).toBe('unavailable');
	});
	it('coalesces concurrent mints and reuses the token inside a cell', async () => {
		const f = vi.fn(async () => ok({ token: 't1', expires_in: 180 }));
		const p = createPresence({ fetchImpl: f });
		const [a, b] = await Promise.all([p.mint(pos), p.mint(pos)]);
		expect(a).toBe('t1');
		expect(b).toBe('t1');
		await p.mint(pos);
		expect(f).toHaveBeenCalledTimes(1);
	});
	it('re-mints once on 401 and returns pins sorted by local distance', async () => {
		let mints = 0;
		const f = vi.fn(async (url) => {
			if (url.includes('fix-token')) return ok({ token: `t${++mints}`, expires_in: 180 });
			if (mints < 2) return ok({ error: 'fix_required' }, 401);
			return ok({ pins: [
				{ id: 'far', lat: 40.7133, lng: -74.0056 },
				{ id: 'near', lat: 40.71235, lng: -74.0057 },
			] });
		});
		const pins = await createPresence({ fetchImpl: f }).nearby(pos);
		expect(mints).toBe(2);
		expect(pins.map((p) => p.id)).toEqual(['near', 'far']);
		expect(typeof pins[0].bearing).toBe('number');
	});
	it('surfaces offline and rate limit as typed errors', async () => {
		const off = createPresence({ fetchImpl: async () => { throw new TypeError('x'); } });
		await expect(off.nearby(pos)).rejects.toMatchObject({ code: 'offline' });
		const rl = createPresence({ fetchImpl: async () => ok({}, 429) });
		await expect(rl.mint(pos)).rejects.toBeInstanceOf(PresenceError);
	});
});
