// One issue, three renderings: Telegram HTML (chunked under the 4096 limit),
// Markdown (archive and repo friendly) and a standalone HTML page.
import type { DailyData, TokenRow, WalletRow, KolToken } from './data.ts';
import { age, chainLabel, dexUrl, esc, mult, pct, short, usd } from './format.ts';

type Line = { html: string; md: string };
type Section = { title: string; intro?: string; lines: Line[] };

const sym = (t: { symbol: string | null; address: string }) => t.symbol || short(t.address);

function tokenLine(t: TokenRow, extra = ''): Line {
  const name = sym(t);
  const url = dexUrl(t.chain, t.address);
  const tag = t.chain === 'robinhood' ? ' [RH]' : '';
  const core = `${usd(t.mcap)} mcap, ${usd(t.volume_24h)} vol, ${pct(t.change_24h)} 24h`;
  const more = [t.category !== 'unclassified' ? t.category : '', t.holders ? `${t.holders.toLocaleString('en-US')} holders` : '', extra].filter(Boolean).join(', ');
  return {
    html: `<a href="${url}">$${esc(name)}</a>${tag} ${core}${more ? ` (${esc(more)})` : ''}`,
    md: `[$${name}](${url})${tag} ${core}${more ? ` (${more})` : ''}`,
  };
}

function walletLine(w: WalletRow): Line {
  const name = w.label || short(w.address);
  const net = w.buy_sol - w.sell_sol;
  const text = `${w.trades} trades on ${w.tokens} tokens, bought ${w.buy_sol.toFixed(1)} SOL, sold ${w.sell_sol.toFixed(1)} SOL (net ${net >= 0 ? '+' : ''}${net.toFixed(1)})`;
  const link = w.twitter ? `https://x.com/${w.twitter.replace(/^@/, '')}` : `https://solscan.io/account/${w.address}`;
  return { html: `<a href="${link}">${esc(name)}</a> ${text}`, md: `[${name}](${link}) ${text}` };
}

function walletTokenLine(k: KolToken): Line {
  const name = k.symbol || short(k.token);
  const url = dexUrl(k.chain, k.token);
  const text = `${k.wallets} wallet${k.wallets === 1 ? '' : 's'}, bought ${k.buy_sol.toFixed(1)} SOL, sold ${k.sell_sol.toFixed(1)} SOL${k.mcap ? `, now ${usd(k.mcap)}` : ''}`;
  return { html: `<a href="${url}">$${esc(name)}</a> ${text}`, md: `[$${name}](${url}) ${text}` };
}

function plain(text: string): Line {
  return { html: esc(text), md: text };
}

export function buildSections(d: DailyData): Section[] {
  const s: Section[] = [];
  const marketLines = d.markets.map((m) => {
    const text = `${chainLabel(m.chain)}: ${usd(m.total_mcap)} trench mcap, tokens under $1B (${pct(m.mcap_change_pct, 1)}), ${usd(m.total_volume_24h)} 24h volume (${pct(m.volume_change_pct, 1)}), ${m.launches_24h.toLocaleString('en-US')} launches, ${m.graduations_24h.toLocaleString('en-US')} graduations${m.native_usd ? `, ${m.chain === 'solana' ? 'SOL' : 'ETH'} ${usd(m.native_usd)}` : ''}`;
    return plain(text);
  });
  s.push({ title: 'Market pulse', lines: marketLines });

  if (d.launches.length) {
    s.push({
      title: 'Launchpads, last 24h',
      lines: d.launches.slice(0, 8).map((l) => plain(`${chainLabel(l.chain)} ${l.launchpad ?? 'unknown'}: ${l.launches.toLocaleString('en-US')} launches, ${l.graduations.toLocaleString('en-US')} graduated${l.launches ? ` (${((l.graduations / l.launches) * 100).toFixed(2)}%)` : ''}`)),
    });
  }
  if (d.runners.length) s.push({ title: 'Daily runners', intro: 'Biggest 24h gainers with real volume and liquidity.', lines: d.runners.map((t) => tokenLine(t, `${t.multiple && t.multiple >= 1.5 ? `${mult(t.multiple)} from first seen, ` : ''}${age(t.age_hours)} old`)) });
  if (d.newRunners.length) s.push({ title: 'New and already moving', intro: 'Launched in the last 48 hours and holding volume.', lines: d.newRunners.map((t) => tokenLine(t, `${age(t.age_hours)} old`)) });
  if (d.techPicks.length) s.push({ title: 'Tech watch', intro: 'Highest tech score among tokens with volume. Real product signals, not memes.', lines: d.techPicks.map((t) => tokenLine(t, `tech ${Math.round(t.tech_score * 100)}`)) });
  if (d.persistent.length) s.push({ title: 'Staying power', intro: 'On the most discovery lists over the day.', lines: d.persistent.map((t) => tokenLine(t, `${t.lists} lists, ${t.appearances} appearances`)) });
  if (d.holdersGrowth.length) s.push({ title: 'Holder growth', lines: d.holdersGrowth.map((t) => tokenLine(t)) });
  if (d.topVolume.length) s.push({ title: 'Volume leaders', lines: d.topVolume.map((t) => tokenLine(t)) });
  if (d.dying.length || d.dead.length) {
    s.push({
      title: 'What faded',
      intro: 'Peak market cap above $50K, now down hard. These are the patterns the archive learns from.',
      lines: [...d.dead.map((t) => tokenLine(t, `dead, ${pct(-(t.drawdown_pct ?? 0))} from ATH ${usd(t.ath_mcap)}`)), ...d.dying.map((t) => tokenLine(t, `dying, ${pct(-(t.drawdown_pct ?? 0))} from ATH ${usd(t.ath_mcap)}`))],
    });
  }
  if (d.kolWallets.length) s.push({ title: 'KOL activity', lines: d.kolWallets.slice(0, 10).map(walletLine) });
  if (d.kolTokens.length) s.push({ title: 'Where KOLs are trading', lines: d.kolTokens.map(walletTokenLine) });
  if (d.smartWallets.length) s.push({ title: 'Smart money', lines: d.smartWallets.slice(0, 10).map(walletLine) });
  if (d.smartTokens.length) s.push({ title: 'Where smart money is trading', lines: d.smartTokens.map(walletTokenLine) });
  if (d.categories.length) {
    s.push({ title: 'Sectors', lines: d.categories.slice(0, 12).map((c) => plain(`${c.category}: ${c.tokens} tokens, ${usd(c.volume_24h)} volume, ${usd(c.mcap)} mcap, avg ${pct(c.avg_change_24h)} 24h`)) });
  }
  if (d.robinhood.length) s.push({ title: 'Robinhood Chain', lines: d.robinhood.map((t) => tokenLine(t, `${t.launchpad ?? 'dex'}`)) });
  if (d.promoted.length) s.push({ title: 'Paid attention', intro: 'Boosted on DexScreener in the last day. Attention that was bought, read accordingly.', lines: d.promoted.map((t) => tokenLine(t)) });
  s.push({
    title: 'Archive',
    lines: [plain(`${d.stats.archiveTokens.toLocaleString('en-US')} tokens and ${d.stats.archiveSnapshots.toLocaleString('en-US')} snapshots on record. Last 24h: ${d.stats.tokensSeen24h.toLocaleString('en-US')} tokens seen, ${d.stats.snapshots24h.toLocaleString('en-US')} snapshots, ${d.stats.tradesRecorded24h.toLocaleString('en-US')} tracked trades across ${d.stats.walletsTracked.toLocaleString('en-US')} watched wallets.`)],
  });
  return s;
}

export function renderMarkdown(d: DailyData, narrative?: string | null): string {
  const out = [`# Pulse daily, ${d.day}`, ''];
  if (narrative) out.push(narrative, '');
  for (const sec of buildSections(d)) {
    out.push(`## ${sec.title}`, '');
    if (sec.intro) out.push(sec.intro, '');
    for (const l of sec.lines) out.push(`- ${l.md}`);
    out.push('');
  }
  return out.join('\n');
}

export function renderTelegram(d: DailyData, narrative?: string | null, dashboardUrl?: string): string[] {
  const limit = 3800;
  const messages: string[] = [];
  let cur = `<b>Pulse daily, ${d.day}</b>${narrative ? `\n\n${esc(narrative)}` : ''}${dashboardUrl ? `\n\n<a href="${dashboardUrl}">Open the dashboard</a>` : ''}`;
  const push = (block: string) => {
    if (cur.length + block.length + 2 > limit) {
      messages.push(cur);
      cur = block;
    } else cur += `\n\n${block}`;
  };
  for (const sec of buildSections(d)) {
    const head = `<b>${esc(sec.title)}</b>${sec.intro ? `\n<i>${esc(sec.intro)}</i>` : ''}`;
    let block = head;
    for (const l of sec.lines) {
      const next = `\n- ${l.html}`;
      if (block.length + next.length > limit) {
        push(block);
        block = `<b>${esc(sec.title)}</b> (cont.)`;
      }
      block += next;
    }
    push(block);
  }
  messages.push(cur);
  return messages;
}

export function renderHtml(d: DailyData, narrative?: string | null): string {
  const body = buildSections(d)
    .map((sec) => `<section><h2>${esc(sec.title)}</h2>${sec.intro ? `<p class="intro">${esc(sec.intro)}</p>` : ''}<ul>${sec.lines.map((l) => `<li>${l.html}</li>`).join('')}</ul></section>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulse daily ${d.day}</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#14171a;--mut:#5b6670;--acc:#0b6bcb;--line:#e3e7eb}@media(prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#e8eaed;--mut:#9aa4ae;--acc:#6db3ff;--line:#252a30}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6rem}h2{font-size:1.1rem;margin:2rem 0 .25rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}.intro{color:var(--mut);margin:.25rem 0}ul{padding-left:1.2rem}li{margin:.25rem 0}a{color:var(--acc)}</style></head>
<body><main><h1>Pulse daily, ${d.day}</h1>${narrative ? `<p>${esc(narrative)}</p>` : ''}${body}</main></body></html>`;
}
