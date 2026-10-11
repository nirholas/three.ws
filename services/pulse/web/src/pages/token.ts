import { api } from '../api.ts';
import { chart, lineOption } from '../charts.ts';
import { ago, dex, empty, errorBox, explorer, html, int, mount, pct, raw, short, skeleton, statusPill, usd } from '../ui.ts';
import type { Page } from '../router.ts';

const TFS = ['5m', '15m', '1h', '4h', '1d'];

export const token: Page = async (el, [chain = '', address = ''], onCleanup) => {
  mount(el, skeleton(10));
  let d: any;
  try {
    d = await api(`/tokens/${chain}/${address}`);
  } catch (e) {
    mount(el, errorBox((e as Error).message));
    el.querySelector('[data-retry]')?.addEventListener('click', () => void token(el, [chain, address], onCleanup));
    return;
  }
  const t = d.token;
  const fromAth = t.ath_mcap && t.last_mcap ? (t.last_mcap / t.ath_mcap - 1) * 100 : null;
  const stat = (l: string, v: unknown) => html`<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  mount(
    el,
    html`<p><a href="#/tokens">Tokens</a> / ${t.symbol || short(address)}</p>
    <h1>${t.symbol || short(address)} <span class="mut">${t.name ?? ''}</span> ${statusPill(t.status)}</h1>
    <p class="sub"><span class="pill">${t.category}</span> tech score ${Math.round((t.tech_score ?? 0) * 100)} · ${t.launchpad ?? 'no launchpad'} · first seen ${ago(t.first_seen)} · <a href="${dex(chain, address)}" target="_blank" rel="noopener">DexScreener</a> · <a href="${explorer(chain, address)}" target="_blank" rel="noopener">Explorer</a></p>
    ${t.description ? html`<p class="mut">${t.description}</p>` : raw('')}
    <div class="grid g4">
      ${stat('Market cap', usd(t.last_mcap))}${stat('24h change', pct(t.last_change_24h))}${stat('24h volume', usd(t.last_volume_24h))}${stat('Liquidity', usd(t.last_liquidity))}
      ${stat('Holders', int(t.last_holders))}${stat('ATH mcap', usd(t.ath_mcap))}${stat('From ATH', pct(fromAth))}${stat('Peak 24h volume', usd(t.peak_volume_24h))}
    </div>
    <section class="card" style="margin-top:14px"><div class="tabs" role="group" aria-label="Timeframe">${TFS.map((tf) => html`<button type="button" data-tf="${tf}" aria-pressed="${tf === '15m'}">${tf}</button>`)}</div><div class="chart tall" id="candles"></div><p class="mut" id="csrc"></p></section>
    <div class="grid g2" style="margin-top:14px">
      <section class="card"><h2>Market cap and liquidity (our snapshots)</h2><div class="chart" id="snap"></div></section>
      <section class="card"><h2>Holders and traders</h2><div class="chart" id="hold"></div></section>
    </div>
    ${d.heat ? html`<section class="card" style="margin-top:14px"><h2>Live heat</h2><p>${int(d.heat.trades)} trades in the last hour, ${int(d.heat.buys)} buys vs ${int(d.heat.sells)} sells, ${int(d.heat.traders)} traders, ${d.heat.vol.toFixed(1)} SOL volume.</p></section>` : raw('')}
    <section style="margin-top:14px"><h2>Smart money and KOL positions</h2>${d.positions.length ? html`<div class="tablewrap"><table><thead><tr><th class="l">Wallet</th><th class="l">Kind</th><th>First buy</th><th>Entry mcap</th><th>Bought</th><th>Sold</th></tr></thead><tbody>${d.positions.map((p: any) => html`<tr><td class="l"><a href="#/wallet/${p.wallet}">${p.label || short(p.wallet)}</a></td><td class="l">${p.kind ?? 'unlabelled'}</td><td>${ago(p.first_buy_at)}</td><td>${usd(p.first_buy_mcap_usd)}</td><td>${p.bought_quote?.toFixed(2)}</td><td>${p.sold_quote?.toFixed(2)}</td></tr>`)}</tbody></table></div>` : empty('No tracked wallet positions yet.', 'Positions are recorded for labelled wallets, whales and early buyers while the firehose is running.')}</section>
    <div class="grid g2" style="margin-top:14px">
      <section><h2>Recent notable trades</h2>${d.trades.length ? html`<div class="tablewrap"><table><thead><tr><th>When</th><th class="l">Wallet</th><th class="l">Side</th><th>Size</th><th>Mcap</th></tr></thead><tbody>${d.trades.map((x: any) => html`<tr><td>${ago(x.ts)}</td><td class="l"><a href="#/wallet/${x.wallet}">${x.label || short(x.wallet)}</a></td><td class="l ${x.side === 'buy' ? 'up' : 'down'}">${x.side}</td><td>${x.quote_amount?.toFixed(2)}</td><td>${usd(x.mcap_usd)}</td></tr>`)}</tbody></table></div>` : empty('No notable trades recorded.')}</section>
      <section><h2>Discovery lists and events</h2>${d.lists.length || d.events.length ? html`<div class="tablewrap"><table><thead><tr><th class="l">Source</th><th>Best rank</th><th>Seen</th><th>Last</th></tr></thead><tbody>${d.lists.map((l: any) => html`<tr><td class="l">${l.list}</td><td>${l.best_rank}</td><td>${l.appearances}</td><td>${ago(l.last_ts)}</td></tr>`)}${d.events.map((e: any) => html`<tr><td class="l">${e.kind} ${e.launchpad ?? ''}</td><td></td><td></td><td>${ago(e.ts)}</td></tr>`)}</tbody></table></div>` : empty('Not seen on any list yet.')}</section>
    </div>`,
  );
  const snaps = d.snapshots as any[];
  const col = (k: string) => snaps.filter((s) => s[k] != null).map((s) => [Date.parse(s.ts), s[k]] as [number, number]);
  const cleaners: (() => void)[] = [];
  onCleanup(() => cleaners.forEach((c) => c()));
  if (snaps.length > 1) {
    cleaners.push(await chart(el.querySelector('#snap')!, (p) => lineOption(p, [{ name: 'Mcap', data: col('mcap'), area: true }, { name: 'Liquidity', data: col('liquidity'), color: p.warn }], usd)));
    cleaners.push(await chart(el.querySelector('#hold')!, (p) => lineOption(p, [{ name: 'Holders', data: col('holders') }, { name: 'Traders 24h', data: col('traders_24h'), color: p.warn }], (v) => int(v))));
  } else {
    for (const id of ['#snap', '#hold']) mount(el.querySelector(id)!, empty('Not enough snapshots yet.', 'A chart appears after two collection cycles.'));
  }

  let disposeCandles: (() => void) | null = null;
  onCleanup(() => disposeCandles?.());
  async function loadCandles(tf: string) {
    const host = el.querySelector('#candles') as HTMLElement;
    const src = el.querySelector('#csrc')!;
    disposeCandles?.();
    disposeCandles = null;
    host.innerHTML = '';
    try {
      const res = await api(`/tokens/${chain}/${address}/candles?tf=${tf}`);
      if (!res.candles.length) {
        mount(host, empty('No candles available.', res.error ?? 'No trading pair is indexed for this token yet.'));
        src.textContent = '';
        return;
      }
      src.textContent = `Candles from ${res.source}, pool ${short(res.pool)}`;
      const lc = await import('lightweight-charts');
      const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const c = lc.createChart(host, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: css('--mut') }, grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } }, timeScale: { timeVisible: true }, rightPriceScale: { borderColor: css('--line') } });
      const s = c.addSeries(lc.CandlestickSeries, { upColor: css('--up'), downColor: css('--down'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--down'), priceFormat: { type: 'price', precision: 8, minMove: 1e-8 } });
      s.setData(res.candles.map((k: any) => ({ time: k.time ?? k.t ?? k[0], open: k.open ?? k.o ?? k[1], high: k.high ?? k.h ?? k[2], low: k.low ?? k.l ?? k[3], close: k.close ?? k.c ?? k[4] })));
      c.timeScale().fitContent();
      disposeCandles = () => c.remove();
    } catch (e) {
      mount(host, errorBox((e as Error).message));
      host.querySelector('[data-retry]')?.addEventListener('click', () => void loadCandles(tf));
    }
  }
  el.querySelectorAll<HTMLButtonElement>('[data-tf]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      void loadCandles(b.dataset.tf!);
    }),
  );
  await loadCandles('15m');
};
