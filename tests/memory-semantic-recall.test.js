import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class LocalStorageStub {
	constructor() { this.store = new Map(); }
	getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
	setItem(k, v) { this.store.set(k, String(v)); }
	removeItem(k) { this.store.delete(k); }
	clear() { this.store.clear(); }
}

beforeEach(() => {
	globalThis.localStorage = new LocalStorageStub();
});
afterEach(() => {
	vi.restoreAllMocks();
	delete globalThis.localStorage;
});

const { Memory } = await import('../src/memory/index.js');

async function seeded() {
	const mem = await Memory.load({ mode: 'local', namespace: 'sem-test' });
	mem.write('user_theme', {
		name: 'theme',
		description: 'UI preference',
		type: 'user',
		body: 'User prefers dark mode and high contrast',
	});
	mem.write('user_pet', {
		name: 'pet',
		description: 'Household',
		type: 'user',
		body: 'Has a ginger cat called Miso',
	});
	return mem;
}

describe('Memory.recall semantic ranking', () => {
	it('finds the dark mode memory for "what theme do I like" via the rank function', async () => {
		const mem = await seeded();
		mem.rankFn = vi.fn(async () => new Map([['user_theme.md', 0.82], ['user_pet.md', 0.11]]));
		const hits = await mem.recall('what theme do I like');
		expect(mem.rankFn).toHaveBeenCalledOnce();
		expect(hits).toHaveLength(1);
		expect(hits[0].file).toBe('user_theme.md');
		expect(hits[0].score).toBeCloseTo(0.82);
	});

	it('falls back to substring matching when the rank call rejects', async () => {
		const mem = await seeded();
		mem.rankFn = vi.fn(async () => {
			throw new Error('rank failed: 503');
		});
		const hits = await mem.recall('dark mode');
		expect(hits.map((h) => h.file)).toEqual(['user_theme.md']);
	});

	it('falls back to substring matching when the endpoint answers 503', async () => {
		const mem = await seeded();
		globalThis.fetch = vi.fn(async () => new Response('{}', { status: 503 }));
		const hits = await mem.recall('ginger cat');
		expect(hits.map((h) => h.file)).toEqual(['user_pet.md']);
	});

	it('returns text alongside body and honors minScore', async () => {
		const mem = await seeded();
		mem.rankFn = async () => new Map([['user_theme.md', 0.82], ['user_pet.md', 0.5]]);
		const all = await mem.recall('anything', { minScore: 0.4 });
		expect(all.map((h) => h.file)).toEqual(['user_theme.md', 'user_pet.md']);
		expect(all[0].text).toBe(all[0].body);
		expect(all[0].text).toContain('dark mode');
		const strict = await mem.recall('anything', { minScore: 0.75 });
		expect(strict.map((h) => h.file)).toEqual(['user_theme.md']);
	});

	it('ranks an exact phrase match above any similarity score', async () => {
		const mem = await seeded();
		mem.rankFn = async () => new Map([['user_theme.md', 0.9], ['user_pet.md', 0.4]]);
		const hits = await mem.recall('Miso');
		expect(hits[0].file).toBe('user_pet.md');
	});

	it('skips the network for an empty query or fewer than two files', async () => {
		const mem = await Memory.load({ mode: 'local', namespace: 'sem-one' });
		mem.write('only', { name: 'n', description: 'd', type: 'user', body: 'dark mode' });
		mem.rankFn = vi.fn();
		expect(await mem.recall('dark')).toHaveLength(1);
		expect(await mem.recall('   ')).toEqual([]);
		expect(mem.rankFn).not.toHaveBeenCalled();
	});

	it('lets a registered backend win over the built-in ranking', async () => {
		const mem = await seeded();
		mem._backend = { recall: async () => [{ file: 'x.md', score: 1 }] };
		mem.rankFn = vi.fn();
		expect(await mem.recall('dark')).toEqual([{ file: 'x.md', score: 1 }]);
		expect(mem.rankFn).not.toHaveBeenCalled();
	});
});
