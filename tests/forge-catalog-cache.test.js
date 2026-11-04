import { describe, it, expect } from 'vitest';
import { readCachedCatalog, writeCachedCatalog } from '../src/forge-catalog-cache.js';

function memStore() {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}
const catalog = { backends: [{ id: 'nvidia', paths: ['geometry'], configured: true }] };

describe('forge catalog cache', () => {
	it('round-trips a valid catalog', () => {
		const s = memStore();
		writeCachedCatalog(catalog, s, 1000);
		expect(readCachedCatalog(s, 2000)).toEqual(catalog);
	});
	it('expires after a week', () => {
		const s = memStore();
		writeCachedCatalog(catalog, s, 0);
		expect(readCachedCatalog(s, 8 * 24 * 3600 * 1000)).toBeNull();
	});
	it('rejects malformed catalogs and corrupt storage', () => {
		const s = memStore();
		writeCachedCatalog({ backends: [] }, s);
		expect(readCachedCatalog(s)).toBeNull();
		s.setItem('forge.catalog.v1', '{nope');
		expect(readCachedCatalog(s)).toBeNull();
	});
	it('survives storage that throws', () => {
		const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
		expect(() => writeCachedCatalog(catalog, boom)).not.toThrow();
		expect(readCachedCatalog(boom)).toBeNull();
	});
});
