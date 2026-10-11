import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { decodeEventData, decodeLogs, poolBaseMint } from '../src/collector/pump-decode.ts';

describe('pump decoder', () => {
  it('ignores malformed and unknown event payloads', () => {
    expect(decodeEventData('')).toBeNull();
    expect(decodeEventData(Buffer.alloc(40, 1).toString('base64'))).toBeNull();
    expect(decodeLogs(['Program log: Instruction: Buy', 'Program data: !!!'])).toEqual([]);
  });
  it('reads the base mint out of a pool account', () => {
    const mint = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const data = Buffer.concat([Buffer.alloc(11), Buffer.alloc(32, 9), mint, Buffer.alloc(40)]);
    expect(poolBaseMint(data)).toBe(bs58.encode(mint));
    expect(poolBaseMint(Buffer.alloc(10))).toBeNull();
  });
});
