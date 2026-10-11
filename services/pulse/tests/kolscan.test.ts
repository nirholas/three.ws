import { describe, expect, it } from 'vitest';
import { parseKolscan } from '../src/sources/wallets.ts';

describe('parseKolscan', () => {
  it('returns nothing for a page without leaderboard data', () => {
    expect(parseKolscan('<html><body>maintenance</body></html>')).toEqual([]);
  });
});
