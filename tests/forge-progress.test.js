// Pre-submit progress crumbs (api/_lib/forge-progress.js).
//
// The contract this pins is the one /forge depends on to stop showing "art
// directing your prompt" for the whole of a 40-second POST: a crumb is readable
// the instant the work it names finished, one crumb per stage, and every failure
// mode of the channel degrades to silence rather than to an error a generation
// could trip over.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
vi.mock('../api/_lib/cache.js', () => ({
	cacheGetFresh: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
	cacheSet: vi.fn(async (key, value) => {
		store.set(key, value);
	}),
}));

const { normalizeTraceId, recordForgeProgress, readForgeProgress } = await import(
	'../api/_lib/forge-progress.js'
);
const cache = await import('../api/_lib/cache.js');

const TRACE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('forge progress trace ids', () => {
	it('accepts the url-safe ids the page mints and rejects everything else', () => {
		expect(normalizeTraceId(TRACE)).toBe(TRACE);
		expect(normalizeTraceId('short')).toBeNull();
		expect(normalizeTraceId(`${TRACE}/../../etc/passwd`)).toBeNull();
		expect(normalizeTraceId('a'.repeat(200))).toBeNull();
		expect(normalizeTraceId(null)).toBeNull();
		expect(normalizeTraceId({ id: TRACE })).toBeNull();
	});
});

describe('forge progress crumbs', () => {
	beforeEach(() => {
		store.clear();
		vi.clearAllMocks();
	});

	it('reads back the milestones in the order they finished', async () => {
		await recordForgeProgress(TRACE, 'directed', { directed_prompt: 'a brass sundial, studio light' });
		await recordForgeProgress(TRACE, 'reference', { preview_image_url: 'https://cdn.example/ref.png' });
		await recordForgeProgress(TRACE, 'submitting', {});
		const crumbs = await readForgeProgress(TRACE);
		expect(crumbs.map((c) => c.stage)).toEqual(['directed', 'reference', 'submitting']);
		expect(crumbs[0].directed_prompt).toBe('a brass sundial, studio light');
		expect(crumbs[1].preview_image_url).toBe('https://cdn.example/ref.png');
	});

	it('keeps one crumb per stage when a failover repaints a milestone', async () => {
		await recordForgeProgress(TRACE, 'reference', { preview_image_url: 'https://cdn.example/first.png' });
		await recordForgeProgress(TRACE, 'reference', { preview_image_url: 'https://cdn.example/second.png' });
		const crumbs = await readForgeProgress(TRACE);
		expect(crumbs).toHaveLength(1);
		expect(crumbs[0].preview_image_url).toBe('https://cdn.example/second.png');
	});

	it('is a no-op without a usable trace id, so an anonymous POST costs nothing', async () => {
		await recordForgeProgress(null, 'directed', { directed_prompt: 'x' });
		await recordForgeProgress('nope', 'directed', { directed_prompt: 'x' });
		expect(cache.cacheSet).not.toHaveBeenCalled();
		expect(await readForgeProgress(null)).toEqual([]);
	});

	it('refuses a stage it does not define rather than storing arbitrary keys', async () => {
		await recordForgeProgress(TRACE, 'texturing', { fake: true });
		expect(cache.cacheSet).not.toHaveBeenCalled();
		expect(await readForgeProgress(TRACE)).toEqual([]);
	});

	it('answers with silence when the shared cache is unavailable', async () => {
		cache.cacheGetFresh.mockRejectedValueOnce(new Error('redis down'));
		await expect(readForgeProgress(TRACE)).resolves.toEqual([]);
		cache.cacheSet.mockRejectedValueOnce(new Error('redis down'));
		await expect(recordForgeProgress(TRACE, 'directed', {})).resolves.toBeUndefined();
	});

	it('drops a stored value that is not a crumb list', async () => {
		store.set(`forge:progress:${TRACE}`, { stage: 'directed' });
		expect(await readForgeProgress(TRACE)).toEqual([]);
	});
});
