#!/usr/bin/env node
// Score a Solana meme token 0-100 from public three.ws data, with the
// contribution of every factor shown so the number can be argued with.
//
//   node scripts/score.mjs <mint> [--json]
//
// Reads three free, keyless endpoints (THREE_WS_API_URL overrides the host):
//   /api/crypto/security   authorities, liquidity lock, liquidity depth
//   /api/crypto/holders    top-holder concentration
//   /api/crypto/token      market cap, 24h volume, 24h change, pool age
// A hard safety failure caps the score at 10 whatever else looks good.

const BASE = (process.env.THREE_WS_API_URL || 'https://three.ws').replace(/\/$/, '');
const mint = process.argv[2];
if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
	console.error('usage: node scripts/score.mjs <mint> [--json]');
	process.exit(2);
}

async function get(path) {
	const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return res.json();
}

const [security, holders, token] = await Promise.allSettled([
	get(`/api/crypto/security?address=${mint}`),
	get(`/api/crypto/holders?address=${mint}`),
	get(`/api/crypto/token?address=${mint}`),
]);
const val = (r) => (r.status === 'fulfilled' ? r.value : null);
const sec = val(security);
const hold = val(holders);
const tok = val(token);
const missing = [
	!sec && 'security',
	!hold && 'holders',
	!tok && 'token market data',
].filter(Boolean);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// log-scaled 0..1 between two anchors, for quantities spanning orders of magnitude
const logScale = (x, lo, hi) => (x > 0 ? clamp((Math.log10(x) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)), 0, 1) : 0);

const factors = [];
const add = (name, points, max, note) => factors.push({ name, points: Math.round(points * 10) / 10, max, note });

// Safety: 30 points. Authorities and lock are binary; either authority live is a hard fail.
const checks = sec?.checks || {};
const hardFail = sec ? checks.mintAuthorityRevoked === false || checks.freezeAuthorityRevoked === false : false;
if (sec) {
	add('authorities revoked', checks.mintAuthorityRevoked && checks.freezeAuthorityRevoked ? 15 : 0, 15, hardFail ? 'mint or freeze authority is live' : 'both revoked');
	add('liquidity locked or burned', checks.lpBurnedOrLocked ? 10 : 0, 10, checks.lpBurnedOrLocked ? 'yes' : 'no or unknown');
	add('metadata immutable', checks.metadataMutable === false ? 5 : 0, 5, checks.metadataMutable === false ? 'yes' : 'mutable or unknown');
}

// Liquidity depth: 20 points, $5k scores 0, $500k scores full.
const liquidity = sec?.checks?.liquidityUsd ?? tok?.liquidityUsd ?? 0;
add('liquidity depth', 20 * logScale(liquidity, 5e3, 5e5), 20, `$${Math.round(liquidity).toLocaleString('en-US')}`);

// Distribution: 20 points, top 10 at or under 20% scores full, 70% or more scores 0.
if (hold && Number.isFinite(hold.top10Pct)) {
	add('holder distribution', 20 * clamp((70 - hold.top10Pct) / 50, 0, 1), 20, `top 10 hold ${hold.top10Pct}%`);
}

// Activity: 20 points, volume relative to market cap (0.05x to 1x daily turnover).
if (tok) {
	const turnover = tok.marketCapUsd > 0 ? tok.volume24hUsd / tok.marketCapUsd : 0;
	add('trading activity', 20 * logScale(turnover, 0.05, 1), 20, `24h volume is ${(turnover * 100).toFixed(1)}% of market cap`);
	// Survival: 10 points for a pool that has existed 30 days or more, 0 at under a day.
	const ageDays = tok.pairCreatedAt ? (Date.now() - new Date(tok.pairCreatedAt).getTime()) / 86400000 : 0;
	add('pool age', 10 * logScale(ageDays, 1, 30), 10, `${ageDays.toFixed(1)} days`);
}

const raw = factors.reduce((s, f) => s + f.points, 0);
const possible = factors.reduce((s, f) => s + f.max, 0);
// Rescale to what could be measured so a missing source does not read as a bad token,
// then cap hard failures.
let score = possible ? Math.round((raw / possible) * 100) : 0;
if (hardFail) score = Math.min(score, 10);
const band = hardFail ? 'avoid' : score >= 75 ? 'strong' : score >= 55 ? 'fair' : score >= 35 ? 'weak' : 'avoid';

const result = {
	mint,
	score,
	band,
	hard_fail: hardFail,
	measured_points: possible,
	factors,
	missing_sources: missing,
	market: tok ? { market_cap_usd: tok.marketCapUsd, volume_24h_usd: tok.volume24hUsd, change_24h_pct: tok.change24h } : null,
};

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(result, null, 2));
} else {
	console.log(`score  ${score}/100 (${band})${hardFail ? '  HARD FAIL' : ''}`);
	for (const f of factors) console.log(`  ${f.name.padEnd(28)} ${String(f.points).padStart(5)} / ${f.max}   ${f.note}`);
	if (missing.length) console.log(`  unavailable: ${missing.join(', ')} (score rescaled to ${possible} measured points)`);
}
