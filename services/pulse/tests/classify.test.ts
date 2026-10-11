import { describe, expect, it } from 'vitest';
import { classify } from '../src/intel/classify.ts';

describe('classify', () => {
  it('scores a documented infrastructure project as tech', () => {
    const c = classify({ name: 'Nodely', symbol: 'NODE', description: 'Open source decentralized RPC infrastructure with docs, a github repo and a live mainnet. '.repeat(2), website: 'https://nodely.example.com', verified: true });
    expect(c.techScore).toBeGreaterThanOrEqual(0.6);
    expect(c.category).not.toBe('unclassified');
  });
  it('scores a bare animal meme low', () => {
    const c = classify({ name: 'Dog Cat Frog', symbol: 'DOGE2', description: 'the best dog meme coin' });
    expect(c.techScore).toBeLessThan(0.5);
    expect(['meme', 'animal']).toContain(c.category);
  });
  it('is bounded and tolerates empty metadata', () => {
    const c = classify({});
    expect(c.techScore).toBeGreaterThanOrEqual(0);
    expect(c.techScore).toBeLessThanOrEqual(1);
    expect(c.category).toBe('unclassified');
  });
});
