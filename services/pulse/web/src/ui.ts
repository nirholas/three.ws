// Rendering helpers. `html` escapes every interpolation, because token names,
// symbols and descriptions are attacker-controlled on-chain metadata.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

class Raw {
  value: string;
  constructor(v: string) {
    this.value = v;
  }
}
export const raw = (s: string) => new Raw(s);

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      out += Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.value : escape(x))).join('') : v instanceof Raw ? v.value : escape(v);
    }
  });
  return new Raw(out);
}

export const mount = (el: Element, content: Raw) => {
  el.innerHTML = content.value;
};

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a === 0) return '$0';
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(a >= 1 ? 2 : a >= 0.01 ? 4 : 8)}`;
}

export function pct(v: number | null | undefined, digits = 1): Raw {
  if (v === null || v === undefined || !Number.isFinite(v)) return raw('<span class="mut">n/a</span>');
  const r = Number(v.toFixed(digits));
  return html`<span class="${r > 0 ? 'up' : r < 0 ? 'down' : 'mut'}">${r > 0 ? '+' : ''}${r.toFixed(digits)}%</span>`;
}

export const int = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : Math.round(v).toLocaleString('en-US'));
export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}..${a.slice(-4)}` : a);

export function ago(ts: string | Date | null | undefined): string {
  if (!ts) return 'n/a';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return `${Math.max(0, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const skeleton = (rows = 6) => html`<div aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => raw('<div class="skel"></div>'))}</div>`;
export const empty = (msg: string, hint = '') => html`<div class="empty"><p>${msg}</p>${hint ? html`<p class="mut">${hint}</p>` : raw('')}</div>`;
export const errorBox = (msg: string) => html`<div class="error" role="alert"><p>${msg}</p><button type="button" data-retry>Try again</button></div>`;

export function tokenCell(t: { chain: string; address: string; symbol?: string | null; name?: string | null; image?: string | null }): Raw {
  const img = html`<span class="ph" aria-hidden="true">${(t.symbol || '?').slice(0, 1).toUpperCase()}</span>`;
  return html`<a class="tok" href="#/token/${t.chain}/${t.address}">${img}<span><b>${t.symbol || short(t.address)}</b><small>${t.name || ''}${t.chain === 'robinhood' ? ' [RH]' : ''}</small></span></a>`;
}

export const statusPill = (s: string) => html`<span class="pill ${s}">${s}</span>`;
export const dex = (chain: string, address: string) => `https://dexscreener.com/${chain}/${address}`;
export const explorer = (chain: string, address: string) => (chain === 'solana' ? `https://solscan.io/token/${address}` : `https://robinhoodchain.blockscout.com/token/${address}`);
