import { api } from '../api.ts';
import { ago, empty, errorBox, html, int, mount, short, skeleton, usd } from '../ui.ts';
import type { Page } from '../router.ts';

export const wallets: Page = async (el) => {
  const state = { kind: '' };
  mount(
    el,
    html`<h1>Wallets</h1><p class="sub">KOLs and smart money, ranked by Pulse score: win rate, realized plus unrealized PnL, and early hits on tokens that ran.</p>
    <div class="toolbar"><select id="kind" aria-label="Wallet kind"><option value="">All labelled wallets</option><option value="kol">KOLs</option><option value="smart">Smart money</option></select></div><div id="results"></div>`,
  );
  const results = el.querySelector('#results')!;
  async function load() {
    mount(results, skeleton(8));
    try {
      const { rows } = await api(`/wallets${state.kind ? `?kind=${state.kind}` : ''}`);
      if (!rows.length) {
        mount(results, empty('No wallets imported yet.', 'The daily import pulls public KOL and smart-money labels. Run npm run collect -- --jobs to import now.'));
        return;
      }
      mount(results, html`<div class="tablewrap"><table><thead><tr><th class="l">Wallet</th><th class="l">Kind</th><th>Score</th><th>Win rate</th><th>Tokens</th><th>Early hits</th><th>Best multiple</th><th>PnL (30d)</th><th>Trades 24h</th></tr></thead><tbody>${rows.map((w: any) => html`<tr><td class="l"><a href="#/wallet/${w.address}">${w.label || short(w.address)}</a> ${w.twitter ? html`<a class="mut" href="https://x.com/${w.twitter}" target="_blank" rel="noopener">@${w.twitter}</a>` : ''}</td><td class="l"><span class="pill">${w.kind}</span></td><td>${w.score == null ? 'n/a' : w.score.toFixed(1)}</td><td>${w.win_rate == null ? 'n/a' : `${Math.round(w.win_rate * 100)}%`}</td><td>${int(w.tokens_traded)}</td><td>${int(w.early_hits)}</td><td>${w.best_multiple ? `${w.best_multiple.toFixed(1)}x` : 'n/a'}</td><td>${usd(w.pnl_usd)}</td><td>${int(w.trades_24h)}</td></tr>`)}</tbody></table></div>`);
    } catch (e) {
      mount(results, errorBox((e as Error).message));
      results.querySelector('[data-retry]')?.addEventListener('click', () => void load());
    }
  }
  el.querySelector('#kind')!.addEventListener('change', (e) => ((state.kind = (e.target as HTMLSelectElement).value), void load()));
  await load();
};

export const walletDetail: Page = async (el, [address = '']) => {
  mount(el, skeleton(8));
  try {
    const d = await api(`/wallets/${address}`);
    const w = d.wallet;
    mount(
      el,
      html`<p><a href="#/wallets">Wallets</a> / ${w?.label || short(address)}</p><h1>${w?.label || short(address)}</h1>
      <p class="sub">${w?.kind ?? 'unlabelled'} · <a href="https://solscan.io/account/${address}" target="_blank" rel="noopener">Solscan</a>${w?.score != null ? ` · score ${w.score.toFixed(1)}, win rate ${Math.round(w.win_rate * 100)}%, ${w.early_hits} early hits` : ''}</p>
      <h2>Positions</h2>${d.positions.length ? html`<div class="tablewrap"><table><thead><tr><th class="l">Token</th><th>Last trade</th><th>Entry mcap</th><th>Now</th><th>Bought</th><th>Sold</th><th class="l">Status</th></tr></thead><tbody>${d.positions.map((p: any) => html`<tr><td class="l"><a href="#/token/${p.chain}/${p.token}">${p.symbol || short(p.token)}</a></td><td>${ago(p.last_trade_at)}</td><td>${usd(p.first_buy_mcap_usd)}</td><td>${usd(p.last_mcap)}</td><td>${p.bought_quote?.toFixed(2)}</td><td>${p.sold_quote?.toFixed(2)}</td><td class="l">${p.status ?? ''}</td></tr>`)}</tbody></table></div>` : empty('No positions recorded for this wallet yet.')}
      <h2 style="margin-top:20px">Recent trades</h2>${d.trades.length ? html`<div class="tablewrap"><table><thead><tr><th>When</th><th class="l">Token</th><th class="l">Side</th><th>Size</th><th>Mcap</th></tr></thead><tbody>${d.trades.map((x: any) => html`<tr><td>${ago(x.ts)}</td><td class="l"><a href="#/token/${x.chain}/${x.token}">${x.symbol || short(x.token)}</a></td><td class="l ${x.side === 'buy' ? 'up' : 'down'}">${x.side}</td><td>${x.quote_amount?.toFixed(2)}</td><td>${usd(x.mcap_usd)}</td></tr>`)}</tbody></table></div>` : empty('No trades recorded for this wallet yet.')}`,
    );
  } catch (e) {
    mount(el, errorBox((e as Error).message));
    el.querySelector('[data-retry]')?.addEventListener('click', () => void walletDetail(el, [address], () => {}));
  }
};
