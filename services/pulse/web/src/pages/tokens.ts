import { api } from '../api.ts';
import { empty, errorBox, escape, html, int, mount, pct, raw, skeleton, statusPill, tokenCell, usd } from '../ui.ts';
import type { Page } from '../router.ts';

const PRESETS: { id: string; label: string; query: Record<string, string> }[] = [
  { id: 'runners', label: 'Runners', query: { status: 'running', sort: 'change' } },
  { id: 'volume', label: 'Volume', query: { sort: 'volume' } },
  { id: 'new', label: 'Newest', query: { sort: 'new' } },
  { id: 'tech', label: 'Tech', query: { tech: '1', sort: 'tech' } },
  { id: 'fading', label: 'Fading', query: { status: 'dying', sort: 'ath' } },
  { id: 'dead', label: 'Dead', query: { status: 'dead', sort: 'ath' } },
  { id: 'graduated', label: 'Graduated', query: { status: 'graduated', sort: 'volume' } },
];

export const tokens: Page = async (el, params, onCleanup) => {
  const qs = new URLSearchParams(params[0] ?? '');
  const state = { preset: qs.get('preset') ?? 'runners', chain: qs.get('chain') ?? '', q: qs.get('q') ?? '', minMcap: qs.get('minMcap') ?? '50000', offset: 0 };
  mount(
    el,
    html`<h1>Tokens</h1><p class="sub">Every token the archive has seen, with lifecycle status and tech score.</p>
    <div class="toolbar" role="group" aria-label="Views">${PRESETS.map((p) => html`<button type="button" data-preset="${p.id}" aria-pressed="${p.id === state.preset}">${p.label}</button>`)}</div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search symbol, name or address" value="${state.q}" aria-label="Search tokens">
      <select id="chain" aria-label="Chain"><option value="">All chains</option><option value="solana">Solana</option><option value="robinhood">Robinhood Chain</option></select>
      <select id="minMcap" aria-label="Minimum market cap"><option value="0">Any mcap</option><option value="10000">$10K+</option><option value="50000">$50K+</option><option value="250000">$250K+</option><option value="1000000">$1M+</option></select>
      <span class="mut" id="count"></span>
    </div>
    <div id="results"></div>`,
  );
  (el.querySelector('#chain') as HTMLSelectElement).value = state.chain;
  (el.querySelector('#minMcap') as HTMLSelectElement).value = state.minMcap;
  const results = el.querySelector('#results')!;
  let timer: ReturnType<typeof setTimeout>;
  let ctl = new AbortController();

  async function load(append = false) {
    const preset = PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]!;
    const query = new URLSearchParams({ ...preset.query, limit: '50', offset: String(append ? state.offset : 0), minMcap: state.minMcap });
    if (state.chain) query.set('chain', state.chain);
    if (state.q) query.set('q', state.q);
    if (!append) {
      state.offset = 0;
      mount(results, skeleton(8));
    }
    try {
      ctl.abort();
      ctl = new AbortController();
      const data = await api(`/tokens?${query}`);
      state.offset += data.rows.length;
      (el.querySelector('#count') as HTMLElement).textContent = `${int(data.total)} matches`;
      if (!data.rows.length && !append) {
        mount(results, empty('No tokens match these filters.', 'Lower the minimum market cap, switch the view, or let the collector run another cycle.'));
        return;
      }
      const rows = data.rows.map(
        (t: any) => html`<tr><td class="l">${tokenCell(t)}</td><td>${usd(t.last_mcap)}</td><td>${pct(t.last_change_24h)}</td><td>${usd(t.last_volume_24h)}</td><td>${usd(t.last_liquidity)}</td><td>${int(t.last_holders)}</td><td>${usd(t.ath_mcap)}</td><td class="l"><span class="pill">${t.category}</span></td><td>${Math.round(t.tech_score * 100)}</td><td class="l">${statusPill(t.status)}</td></tr>`,
      );
      const more = state.offset < data.total ? html`<p style="text-align:center"><button type="button" id="more">Load more</button></p>` : raw('');
      if (append) {
        results.querySelector('tbody')!.insertAdjacentHTML('beforeend', rows.map((r: any) => r.value).join(''));
        results.querySelector('#more')?.parentElement?.remove();
        results.insertAdjacentHTML('beforeend', more.value);
      } else {
        mount(results, html`<div class="tablewrap"><table><thead><tr><th>Token</th><th>Mcap</th><th>24h</th><th>Volume</th><th>Liquidity</th><th>Holders</th><th>ATH mcap</th><th class="l">Sector</th><th>Tech</th><th class="l">Status</th></tr></thead><tbody>${rows}</tbody></table></div>${more}`);
      }
      results.querySelector('#more')?.addEventListener('click', () => void load(true));
    } catch (e) {
      mount(results, errorBox(escape((e as Error).message)));
      results.querySelector('[data-retry]')?.addEventListener('click', () => void load());
    }
  }

  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      state.preset = b.dataset.preset!;
      el.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      void load();
    }),
  );
  el.querySelector('#q')!.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = (e.target as HTMLInputElement).value.trim();
      void load();
    }, 250);
  });
  el.querySelector('#chain')!.addEventListener('change', (e) => {
    state.chain = (e.target as HTMLSelectElement).value;
    void load();
  });
  el.querySelector('#minMcap')!.addEventListener('change', (e) => {
    state.minMcap = (e.target as HTMLSelectElement).value;
    void load();
  });
  onCleanup(() => clearTimeout(timer));
  await load();
};
