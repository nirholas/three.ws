import { describe, expect, it } from 'vitest';
import { mergeObservations } from '../src/collector/store.ts';
import type { Observation } from '../src/sources/types.ts';

const obs = (source: string, meta: object, snap: object, list?: { name: string; rank: number }): Observation => ({ source, meta: { chain: 'solana', address: 'A'.repeat(40), ...meta }, snap, list }) as Observation;

describe('mergeObservations', () => {
  it('folds sources for one token, earlier values winning and gaps filled', () => {
    const merged = mergeObservations([
      obs('jup', { symbol: 'AAA' }, { mcap: 1000, holders: null }, { name: 'jup:top', rank: 3 }),
      obs('dex', { symbol: 'BBB', website: 'https://a.example' }, { mcap: 2000, holders: 50, liquidity: 9 }, { name: 'dex:boost', rank: 1 }),
    ]);
    expect(merged.size).toBe(1);
    const m = [...merged.values()][0] as Observation & { lists: unknown[] };
    expect(m.meta.symbol).toBe('AAA');
    expect(m.meta.website).toBe('https://a.example');
    expect(m.snap).toMatchObject({ mcap: 1000, holders: 50, liquidity: 9 });
    expect(m.lists).toHaveLength(2);
    expect(m.source).toBe('jup+dex');
  });
  it('keeps tokens on different chains apart', () => {
    const merged = mergeObservations([obs('a', {}, {}), { ...obs('b', {}, {}), meta: { chain: 'robinhood', address: 'A'.repeat(40) } } as Observation]);
    expect(merged.size).toBe(2);
  });
});
