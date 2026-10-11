// Number and link formatting shared by every renderer.
import type { Chain } from '../sources/types.ts';

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(a >= 1 ? 2 : 4)}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? '+' : ''}${r === 0 ? (0).toFixed(digits) : r.toFixed(digits)}%`;
}

export function mult(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}x`;
}

export function age(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return 'n/a';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}..${addr.slice(-4)}` : addr;
}

export function chainLabel(c: Chain): string {
  return c === 'solana' ? 'Solana' : 'Robinhood Chain';
}

export function dexUrl(chain: Chain, address: string): string {
  return `https://dexscreener.com/${chain}/${address}`;
}

export function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
