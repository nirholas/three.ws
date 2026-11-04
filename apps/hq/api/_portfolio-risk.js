/**
 * Pure portfolio risk assessment over caller-supplied positions and live HQ
 * data (protocol health scores, perp funding). No I/O, no storage. Heuristic
 * and informational only.
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

export function assessPortfolio(positions, { protocols = [], rates = [] } = {}) {
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

  let penalty = 0;
  const rows = clean.map((p) => {
    const weight = p.usd / total;
    const flags = [];
    const symbol = p.symbol.trim().toUpperCase();

    if (typeof p.protocol === 'string' && p.protocol.trim()) {
      const proto = byProtocol.get(p.protocol.trim().toLowerCase());
      if (!proto) {
        flags.push('protocol_unrated');
        penalty += weight * 5;
      } else if (proto.score < WEAK_SCORE) {
        flags.push(`weak_protocol:${proto.name}:${proto.score}`);
        penalty += weight * 40 * ((WEAK_SCORE - proto.score) / WEAK_SCORE);
      }
    }

    const fr = fundingBySymbol.get(symbol);
    if (fr && CROWDED_LEVELS.has(fr.level)) {
      flags.push(`crowded_leverage:${fr.level}`);
      penalty += weight * 10;
    }

    return {
      symbol,
      protocol: p.protocol ? String(p.protocol).trim() : null,
      chain: p.chain ? String(p.chain).trim() : null,
      usd: p.usd,
      weightPct: +(weight * 100).toFixed(2),
      flags,
    };
  });

  const hhi = rows.reduce((s, r) => s + (r.weightPct / 100) ** 2, 0);
  const top = rows.reduce((a, b) => (b.weightPct > a.weightPct ? b : a));
  penalty += Math.min(40, Math.max(0, hhi - 0.1) * 60);
  if (rows.length > 1 && top.weightPct > 50) {
    top.flags.push('single_position_over_50pct');
    penalty += Math.min(15, (top.weightPct - 50) * 0.3);
  }

  const score = Math.max(0, Math.round(100 - penalty));
  const flagged = rows.filter((r) => r.flags.length > 0);
  const facts = [
    `Portfolio ${fmtUsd(total)} across ${rows.length} positions: risk score ${score}/100 (grade ${gradeFor(score)}).`,
    `Largest position ${top.symbol} is ${top.weightPct}% of the portfolio; concentration index ${hhi.toFixed(2)}.`,
    ...flagged.map((r) => `${r.symbol}${r.protocol ? ` in ${r.protocol}` : ''}: ${r.flags.join(', ')}`),
  ];

  return {
    positions: rows,
    summary: {
      totalUsd: Math.round(total),
      score,
      grade: gradeFor(score),
      concentrationIndex: +hhi.toFixed(3),
      topPositionPct: top.weightPct,
      flaggedCount: flagged.length,
    },
    facts,
  };
}
