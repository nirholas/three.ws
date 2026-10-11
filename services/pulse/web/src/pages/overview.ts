import { api } from '../api.ts';
import { chart, lineOption } from '../charts.ts';
import { empty, errorBox, html, int, mount, pct, raw, short, skeleton, tokenCell, usd } from '../ui.ts';
import type { Page } from '../router.ts';

export const overview: Page = async (el, _p, onCleanup) => {
  mount(el, html`<h1>Market overview</h1><p class="sub">Solana and Robinhood Chain, refreshed every few minutes.</p>${skeleton(8)}`);
  let o: any;
  try {
    o = await api('/overview');
  } catch (e) {
    mount(el, errorBox((e as Error).message));
    el.querySelector('[data-retry]')?.addEventListener('click', () => overview(el, [], onCleanup));
    return;
  }
  const latest = (c: string) => o.markets.find((m: any) => m.chain === c);
  const kpi = (label: string, value: string, delta?: any) => html`<div class="card kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="d">${delta ?? raw('&nbsp;')}</div></div>`;
  const sol = latest('solana');
  const rh = latest('robinhood');
  const hot = o.hot as any[];
  const statusCount = (chain: string, status: string) => o.status.find((s: any) => s.chain === chain && s.status === status)?.tokens ?? 0;
  mount(
    el,
    html`<h1>Market overview</h1><p class="sub">Trench market cap excludes tokens above $1B (majors, stables, xStocks).</p>
    <div class="grid g4">
      ${kpi('Solana trench mcap', usd(sol?.total_mcap), `${int(sol?.tracked_tokens)} tokens tracked`)}
      ${kpi('Solana 24h volume', usd(sol?.total_volume_24h), `${int(sol?.launches_1h)} launches last hour`)}
      ${kpi('Robinhood Chain mcap', usd(rh?.total_mcap), `${int(rh?.tracked_tokens)} tokens tracked`)}
      ${kpi('Robinhood Chain 24h volume', usd(rh?.total_volume_24h), `${int(rh?.launches_1h)} launches last hour`)}
      ${kpi('Running now', int(statusCount('solana', 'running') + statusCount('robinhood', 'running')), 'above $100K mcap, rising')}
      ${kpi('Fading', int(statusCount('solana', 'dying') + statusCount('robinhood', 'dying')), 'down 70%+ from peak')}
      ${kpi('Dead', int(statusCount('solana', 'dead') + statusCount('robinhood', 'dead')), 'down 90%+ or no liquidity')}
      ${kpi('Firehose', o.stream?.connected ? `${int(o.stream.trades1h)} trades/h` : 'offline', o.stream ? `${int(o.stream.graduations1h)} graduations last hour` : 'run npm start to stream')}
    </div>
    <div class="grid g2" style="margin-top:14px">
      <section class="card"><h2>Trench market cap (7d)</h2><div class="chart" id="c-mcap"></div></section>
      <section class="card"><h2>24h volume (7d)</h2><div class="chart" id="c-vol"></div></section>
      <section class="card"><h2>Launches and graduations per hour (48h)</h2><div class="chart" id="c-launch"></div></section>
      <section class="card"><h2>Sector volume (24h)</h2><div class="chart" id="c-cat"></div></section>
    </div>
    <section style="margin-top:14px"><h2>Hottest right now, live from the firehose</h2>
      ${hot.length ? html`<div class="tablewrap"><table><thead><tr><th>Token</th><th>Trades (1h)</th><th>Buys</th><th>Sells</th><th>SOL volume</th><th>Traders</th><th>Mcap</th></tr></thead><tbody>${hot.map((h) => html`<tr><td class="l"><a href="#/token/solana/${h.mint}">${h.symbol || short(h.mint)}</a></td><td>${int(h.trades)}</td><td class="up">${int(h.buys)}</td><td class="down">${int(h.sells)}</td><td>${h.vol.toFixed(1)}</td><td>${int(h.traders)}</td><td>${usd(h.lastMcapUsd)}</td></tr>`)}</tbody></table></div>` : empty('The firehose is not streaming.', 'Start the full process with npm start to see live pump.fun and PumpSwap activity here.')}
    </section>`,
  );
  const series = (chainKey: string, field: string) => o.series.filter((r: any) => r.chain === chainKey).map((r: any) => [Date.parse(r.ts), r[field]] as [number, number]);
  const cleaners = await Promise.all([
    chart(el.querySelector('#c-mcap')!, (p) => lineOption(p, [{ name: 'Solana', data: series('solana', 'total_mcap'), area: true }, { name: 'Robinhood Chain', data: series('robinhood', 'total_mcap'), color: p.warn }], usd)),
    chart(el.querySelector('#c-vol')!, (p) => lineOption(p, [{ name: 'Solana', data: series('solana', 'total_volume_24h'), area: true }, { name: 'Robinhood Chain', data: series('robinhood', 'total_volume_24h'), color: p.warn }], usd)),
    chart(el.querySelector('#c-launch')!, (p) => ({
      grid: { left: 44, right: 14, top: 28, bottom: 28 },
      legend: { top: 0, textStyle: { color: p.mut } },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'time', axisLabel: { color: p.mut }, axisLine: { lineStyle: { color: p.line } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut } },
      series: [
        { name: 'Solana launches', type: 'bar', stack: 'l', data: o.launches.filter((r: any) => r.chain === 'solana').map((r: any) => [Date.parse(r.hour), r.launches]), itemStyle: { color: p.acc } },
        { name: 'Robinhood launches', type: 'bar', stack: 'l', data: o.launches.filter((r: any) => r.chain === 'robinhood').map((r: any) => [Date.parse(r.hour), r.launches]), itemStyle: { color: p.warn } },
        { name: 'Graduations', type: 'line', showSymbol: false, data: o.launches.map((r: any) => [Date.parse(r.hour), r.graduations]), lineStyle: { color: p.link } },
      ],
    })),
    chart(el.querySelector('#c-cat')!, (p) => ({
      grid: { left: 90, right: 20, top: 8, bottom: 24 },
      tooltip: { trigger: 'item', valueFormatter: (v) => usd(Number(v)) },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut, formatter: (v: number) => usd(v) } },
      yAxis: { type: 'category', inverse: true, data: o.categories.slice(0, 12).map((c: any) => c.category), axisLabel: { color: p.fg } },
      series: [{ type: 'bar', data: o.categories.slice(0, 12).map((c: any) => c.volume_24h), itemStyle: { color: p.acc, borderRadius: [0, 4, 4, 0] } }],
    })),
  ]);
  onCleanup(() => cleaners.forEach((c) => c()));
  void pct;
  void tokenCell;
};
