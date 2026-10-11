import { describe, expect, it } from 'vitest';
import { age, dexUrl, esc, mult, pct, short, usd } from '../src/report/format.ts';

describe('format', () => {
  it('abbreviates dollar amounts', () => {
    expect(usd(1_500_000_000)).toBe('$1.50B');
    expect(usd(2_340_000)).toBe('$2.34M');
    expect(usd(12_500)).toBe('$12.5K');
    expect(usd(0.0123)).toBe('$0.0123');
    expect(usd(null)).toBe('n/a');
  });
  it('signs percentages and never prints negative zero', () => {
    expect(pct(12.4)).toBe('+12%');
    expect(pct(-0.2)).toBe('0%');
    expect(pct(-45.5, 1)).toBe('-45.5%');
  });
  it('formats multiples and ages', () => {
    expect(mult(3.14)).toBe('3.1x');
    expect(mult(42)).toBe('42x');
    expect(age(0.25)).toBe('15m');
    expect(age(5)).toBe('5h');
    expect(age(96)).toBe('4d');
  });
  it('shortens addresses and escapes telegram html', () => {
    expect(short('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump')).toBe('FeMb..pump');
    expect(esc('<b>&')).toBe('&lt;b&gt;&amp;');
    expect(dexUrl('solana', 'abc')).toBe('https://dexscreener.com/solana/abc');
  });
});
