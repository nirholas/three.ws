/**
 * Pure portfolio risk assessment over positions (caller-supplied, or read from
 * a public wallet by _wallet-holdings.js) and live HQ data: protocol health
 * scores, perp funding, and the stablecoin list. No I/O, no storage. Heuristic
 * and informational only.
 *
 * Protocol exposure comes from two places: a position the caller tagged with a
 * protocol, and a held token that is a rated protocol's own token (matched on
 * chain and address from protocol-health's `token` field, never on a name).
 */

const WEAK_SCORE = 60;
const CROWDED_LEVELS = new Set(['HIGH', 'EXTREME']);

function gradeFor(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

const fmtUsd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

const tokenKey = (chain, address) => `${String(chain).toLowerCase()}:${/^0x/i.test(address) ? String(address).toLowerCase() : address}`;

export function assessPortfolio(positions, { protocols = [], rates = [], stablecoins = [] } = {}) {
  const clean = (Array.isArray(positions) ? positions : [])
    .filter((p) => p && typeof p.symbol === 'string' && p.symbol.trim() && Number.isFinite(p.usd) && p.usd > 0)
    .slice(0, 50);
  if (clean.length === 0) {
    throw Object.assign(new Error('positions must contain at least one {symbol, usd} with usd > 0'), { status: 400 });
  }

  const total = clean.reduce((s, p) => s + p.usd, 0);
  const byProtocol = new Map();
  for (const p of protocols) {
    byProtocol.set(String(p.name).toLowerCase(), p);
    if (p.slug) byProtocol.set(String(p.slug).toLowerCase(), p);
  }
  const fundingBySymbol = new Map(rates.map((r) => [String(r.symbol).toUpperCase(), r]));
  const stableSymbols = new Set([...stablecoins].map((x) => String(x).trim().toUpperCase()).filter(Boolean));
  // Several rated protocols can share one token; the largest by TVL owns it.
  const byToken = new Map();
  for (const p of protocols) {
    if (!p.token?.chain || !p.token?.address) continue;
    const key = tokenKey(p.token.chain, p.token.address);
    const prev = byToken.get(key);
    if (!prev || (p.tvl ?? 0) > (prev.tvl ?? 0)) byToken.set(key, p);
  }
  const exposure = new Map();
  const expose = (proto, name, usd, via) => {
    const key = proto ? proto.slug || proto.name : name.toLowerCase();
    const row = exposure.get(key) ?? { protocol: proto ? proto.name : name, slug: proto?.slug ?? null, score: proto?.score ?? null, grade: proto?.grade ?? null, usd: 0, via: new Set() };
    row.usd += usd;
    row.via.add(via);
    exposure.set(key, row);
  };

  let penalty = 0;
  const rows = clean.map((p) => {
    const weight = p.usd / total;
    const flags = [];
    const symbol = p.symbol.trim().toUpperCase();

    const tagged = typeof p.protocol === 'string' && p.protocol.trim() ? p.protocol.trim() : null;
    const tokenProto = p.token?.chain && p.token?.address ? byToken.get(tokenKey(p.token.chain, p.token.address)) : null;
    let proto = null;
    if (tagged) {
      proto = byProtocol.get(tagged.toLowerCase()) ?? null;
      expose(proto, tagged, p.usd, 'position');
      if (!proto) {
        flags.push('protocol_unrated');
        penalty += weight * 5;
      }
    } else if (tokenProto) {
      proto = tokenProto;
      expose(proto, proto.name, p.usd, 'protocol_token');
    }
    if (proto && proto.score < WEAK_SCORE) {
      flags.push(`weak_protocol:${proto.name}:${proto.score}`);
      penalty += weight * 40 * ((WEAK_SCORE - proto.score) / WEAK_SCORE);
    }
    const stablecoin = stableSymbols.has(symbol);

    const fr = fundingBySymbol.get(symbol);
    if (fr && CROWDED_LEVELS.has(fr.level)) {
      flags.push(`crowded_leverage:${fr.level}`);
      penalty += weight * 10;
    }

    return {
      symbol,
      protocol: tagged ?? tokenProto?.name ?? null,
      chain: p.chain ? String(p.chain).trim() : null,
      usd: p.usd,
      weightPct: +(weight * 100).toFixed(2),
      stablecoin,
      ...(proto ? { protocolScore: proto.score, protocolGrade: proto.grade ?? null } : {}),
      flags,
    };
  });

  // Concentration is measured per asset, not per row: native and wrapped SOL,
  // or one token held on two chains or in two protocols, are one exposure.
  const assets = new Map();
  for (const r of rows) assets.set(r.symbol, (assets.get(r.symbol) ?? 0) + r.usd / total);
  const hhi = [...assets.values()].reduce((s, w) => s + w ** 2, 0);
  const [topSymbol, topWeight] = [...assets.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
  const topPct = +(topWeight * 100).toFixed(2);
  penalty += Math.min(40, Math.max(0, hhi - 0.1) * 60);
  if (assets.size > 1 && topPct > 50) {
    for (const r of rows) if (r.symbol === topSymbol) r.flags.push('single_position_over_50pct');
    penalty += Math.min(15, (topPct - 50) * 0.3);
  }

  const score = Math.max(0, Math.round(100 - penalty));
  const flagged = rows.filter((r) => r.flags.length > 0);
  const stableUsd = rows.reduce((s, r) => s + (r.stablecoin ? r.usd : 0), 0);
  const stablecoinPct = +((stableUsd / total) * 100).toFixed(2);
  const protocolExposure = [...exposure.values()]
    .map((e) => ({ ...e, usd: Math.round(e.usd * 100) / 100, pct: +((e.usd / total) * 100).toFixed(2), via: [...e.via] }))
    .sort((a, b) => b.usd - a.usd);
  const exposurePct = +((protocolExposure.reduce((s, e) => s + e.usd, 0) / total) * 100).toFixed(2);
  const pctText = (usd, p) => (usd > 0 && p < 0.01 ? '<0.01%' : `${p}%`);
  const facts = [
    `Portfolio ${fmtUsd(total)} across ${rows.length} positions in ${assets.size} assets: risk score ${score}/100 (grade ${gradeFor(score)}).`,
    `Largest asset ${topSymbol} is ${topPct}% of the portfolio; concentration index ${hhi.toFixed(2)}.`,
    stableSymbols.size > 0 ? `Stablecoins are ${stablecoinPct}% of the portfolio.` : 'Stablecoin share unknown: the stablecoin list was unavailable.',
    protocolExposure.length > 0
      ? `Protocol exposure ${pctText(protocolExposure.reduce((s, e) => s + e.usd, 0), exposurePct)}: ${protocolExposure.slice(0, 3).map((e) => `${e.protocol} ${pctText(e.usd, e.pct)}${e.grade ? ` (health ${e.grade}, ${e.score}/100)` : ' (unrated)'}`).join('; ')}.`
      : 'No exposure to a rated protocol was found in these positions.',
    ...flagged.map((r) => `${r.symbol}${r.protocol ? ` in ${r.protocol}` : ''}: ${r.flags.join(', ')}`),
  ];

  return {
    positions: rows,
    summary: {
      totalUsd: Math.round(total),
      score,
      grade: gradeFor(score),
      concentrationIndex: +hhi.toFixed(3),
      topAsset: topSymbol,
      topPositionPct: topPct,
      flaggedCount: flagged.length,
      stablecoinPct: stableSymbols.size > 0 ? stablecoinPct : null,
      protocolExposurePct: exposurePct,
    },
    protocolExposure,
    facts,
  };
}
