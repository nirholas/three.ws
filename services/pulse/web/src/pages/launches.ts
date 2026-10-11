import { api } from '../api.ts';
import { ago, empty, errorBox, html, mount, short, skeleton, statusPill, usd } from '../ui.ts';
import type { Page } from '../router.ts';

export const launches: Page = async (el, _p, onCleanup) => {
  const state = { chain: '', kind: '' };
  mount(
    el,
    html`<h1>Launches</h1><p class="sub">Every launch and graduation the firehose and the Robinhood Chain walker have recorded.</p>
    <div class="toolbar"><select id="chain" aria-label="Chain"><option value="">All chains</option><option value="solana">Solana</option><option value="robinhood">Robinhood Chain</option></select>
    <select id="kind" aria-label="Event type"><option value="">Launches and graduations</option><option value="launch">Launches</option><option value="graduation">Graduations</option></select></div>
    <div id="results"></div>`,
  );
  const results = el.querySelector('#results')!;
  async function load() {
    mount(results, skeleton(8));
    try {
      const q = new URLSearchParams({ limit: '200' });
      if (state.chain) q.set('chain', state.chain);
      if (state.kind) q.set('kind', state.kind);
      const { rows } = await api(`/launches?${q}`);
      if (!rows.length) {
        mount(results, empty('No launch events recorded yet.', 'Run npm start so the Solana firehose and the Robinhood walker can record launches.'));
        return;
      }
      mount(results, html`<div class="tablewrap"><table><thead><tr><th>When</th><th class="l">Event</th><th class="l">Token</th><th class="l">Launchpad</th><th>Mcap</th><th>24h volume</th><th class="l">Status</th></tr></thead><tbody>${rows.map((r: any) => html`<tr><td>${ago(r.ts)}</td><td class="l">${r.kind}</td><td class="l"><a href="#/token/${r.chain}/${r.token}">${r.symbol || short(r.token)}</a> <span class="mut">${r.name ?? ''}</span></td><td class="l">${r.launchpad ?? ''}</td><td>${usd(r.last_mcap)}</td><td>${usd(r.last_volume_24h)}</td><td class="l">${r.status ? statusPill(r.status) : ''}</td></tr>`)}</tbody></table></div>`);
    } catch (e) {
      mount(results, errorBox((e as Error).message));
      results.querySelector('[data-retry]')?.addEventListener('click', () => void load());
    }
  }
  el.querySelector('#chain')!.addEventListener('change', (e) => ((state.chain = (e.target as HTMLSelectElement).value), void load()));
  el.querySelector('#kind')!.addEventListener('change', (e) => ((state.kind = (e.target as HTMLSelectElement).value), void load()));
  const timer = setInterval(() => void load(), 60_000);
  onCleanup(() => clearInterval(timer));
  await load();
};
