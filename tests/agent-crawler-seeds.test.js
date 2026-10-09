// The Crawl worker's lead search (workers/agent-crawler/seeds.js): a source only
// counts when it returns pages the agent has not read, and sources are pooled
// until there are enough, so a long-running agent never rests on stale hits.
import { afterEach, describe, expect, it } from 'vitest';
import { SOURCES, searchSeeds } from '../workers/agent-crawler/seeds.js';

const real = [...SOURCES];
const use = (...fns) => SOURCES.splice(0, SOURCES.length, ...fns.map((fn, i) => ({ name: `s${i}`, fn })));
afterEach(() => SOURCES.splice(0, SOURCES.length, ...real));

describe('searchSeeds', () => {
	it('skips a source whose hits were all read and pools the next ones', async () => {
		const read = new Set(['https://a.example/1', 'https://a.example/2']);
		use(async () => [...read], async () => ['https://b.example/1', 'https://b.example/2'], async () => ['https://c.example/1']);
		const { urls, source } = await searchSeeds('topic', { fresh: (u) => !read.has(u) });
		expect(urls).toEqual(['https://b.example/1', 'https://b.example/2', 'https://c.example/1']);
		expect(source).toBe('s1 and s2');
	});

	it('stops asking once it has enough and passes the round through', async () => {
		const rounds = [];
		const many = Array.from({ length: 8 }, (_, i) => `https://a.example/${i}`);
		use(async (_t, round) => { rounds.push(round); return many; }, async () => { throw new Error('should not be asked'); });
		const { urls } = await searchSeeds('topic', { round: 3 });
		expect(urls).toHaveLength(8);
		expect(rounds).toEqual([3]);
	});

	it('survives a failing source and reports nothing found honestly', async () => {
		const logs = [];
		use(async () => { throw new Error('down'); }, async () => []);
		expect(await searchSeeds('topic', { log: (m) => logs.push(m) })).toEqual({ urls: [], source: null });
		expect(logs[0]).toMatch(/s0 failed: down/);
	});
});
