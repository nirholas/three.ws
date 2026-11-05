/**
 * Pure risk scoring for the heatmap. Each dimension returns
 * { risk: 0-100 | null, level, reason }. Higher is riskier. `null` means the
 * free sources told us nothing, and it stays unknown: it is never rounded to
 * "low" and never counted toward the overall score.
 */

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const YEAR = 365 * 86400;

export function levelFor(risk) {
  if (!fin(risk)) return 'unknown';
  return risk < 35 ? 'low' : risk < 65 ? 'medium' : 'high';
}

const out = (risk, reason) => ({ risk, level: levelFor(risk), reason });
const unknown = (reason) => out(null, reason);

export function scoreContract({ audits, listedAt, hackLossUsd, nowSec }) {
  if (!fin(audits) && !fin(listedAt) && !fin(hackLossUsd)) return unknown('no audit, age or hack data');
  let risk = 50;
  const notes = [];
  if (fin(audits)) {
    if (audits === 0) { risk += 20; notes.push('no listed audit'); }
    else { risk -= Math.min(25, 12 + audits * 4); notes.push(`${audits} audit${audits === 1 ? '' : 's'}`); }
  }
  if (fin(listedAt)) {
    const age = (nowSec - listedAt) / YEAR;
    if (age < 0.5) { risk += 15; notes.push('listed under 6 months'); }
    else if (age >= 2) { risk -= 15; notes.push(`${Math.floor(age)}y track record`); }
  }
  if (fin(hackLossUsd) && hackLossUsd > 0) { risk += hackLossUsd >= 1e7 ? 30 : 15; notes.push('past hack on record'); }
  return out(clamp(risk), notes.join(', '));
}

export function scoreOracle({ maxDeviationBps, anyStale }) {
  if (!fin(maxDeviationBps) && anyStale == null) return unknown('no oracle feeds mapped to this protocol');
  if (anyStale) return out(85, 'a mapped oracle round is past its heartbeat');
  const d = Math.abs(maxDeviationBps);
  if (d > 100) return out(85, `${d.toFixed(0)} bps from exchange mids`);
  if (d > 30) return out(55, `${d.toFixed(0)} bps from exchange mids`);
  return out(15, `within ${Math.max(1, Math.ceil(d))} bps of exchange mids`);
}

export function scoreGovernance({ governanceIds, activeProposals }) {
  if (!Array.isArray(governanceIds) || governanceIds.length === 0) return unknown('no governance space listed');
  if (fin(activeProposals) && activeProposals > 0) return out(40, `${activeProposals} active proposal${activeProposals === 1 ? '' : 's'}`);
  return out(20, fin(activeProposals) ? 'governance listed, no live proposals' : 'governance listed');
}

export function scoreLiquidity({ tvl, change7d }) {
  if (!fin(tvl)) return unknown('no TVL data');
  let risk = tvl >= 1e9 ? 10 : tvl >= 1e8 ? 25 : tvl >= 1e7 ? 45 : 70;
  if (fin(change7d) && change7d <= -30) risk += 25;
  else if (fin(change7d) && change7d <= -15) risk += 12;
  return out(clamp(risk), `$${(tvl / 1e6).toFixed(0)}M TVL${fin(change7d) ? `, ${change7d.toFixed(1)}% over 7d` : ''}`);
}

export function scoreMarket({ change1d, change7d }) {
  if (!fin(change1d) && !fin(change7d)) return unknown('no price data');
  const swing = Math.max(Math.abs(change1d ?? 0) * 2, Math.abs(change7d ?? 0));
  const risk = swing >= 30 ? 85 : swing >= 15 ? 60 : swing >= 6 ? 35 : 15;
  return out(risk, `${swing.toFixed(1)}% weighted swing`);
}

export function overallRisk(cells) {
  const known = cells.map((c) => c.risk).filter(fin);
  if (known.length === 0) return { risk: null, level: 'unknown', known: 0 };
  const risk = Math.round(known.reduce((s, v) => s + v, 0) / known.length);
  return { risk, level: levelFor(risk), known: known.length };
}
