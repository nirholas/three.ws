#!/usr/bin/env node
// Turn a DCA intent into a concrete schedule and the exact order body the
// three.ws agent orders API accepts. Plans only: nothing is sent or signed.
//
//   node scripts/dca-plan.mjs --mint <mint> --total-sol 10 --every 1d --for 30d
//        [--slippage-bps 300] [--max-impact-pct 3] [--fee-sol 0.00001] [--json]
//
// --every and --for take 30m, 6h, 1d, 1w. The result is a POST body for
// /api/agents/<agent_id>/orders/preview (validate first) and then /orders.

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function seconds(spec, name) {
	const m = /^(\d+(?:\.\d+)?)(m|h|d|w)$/.exec(String(spec || ''));
	if (!m) {
		console.error(`--${name} must look like 30m, 6h, 1d or 2w`);
		process.exit(2);
	}
	return Math.round(Number(m[1]) * { m: 60, h: 3600, d: 86400, w: 604800 }[m[2]]);
}

const mint = opt('mint');
const totalSol = Number(opt('total-sol'));
const every = seconds(opt('every', '1d'), 'every');
const span = seconds(opt('for', '30d'), 'for');
const slippageBps = Number(opt('slippage-bps', '300'));
const maxImpact = Number(opt('max-impact-pct', '3'));
const feeSol = Number(opt('fee-sol', '0.00001'));

if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !(totalSol > 0)) {
	console.error('usage: node scripts/dca-plan.mjs --mint <mint> --total-sol <n> --every 1d --for 30d [--slippage-bps 300] [--max-impact-pct 3] [--json]');
	process.exit(2);
}
if (every < 60) {
	console.error('the orders API fires at most once a minute; --every must be at least 1m');
	process.exit(2);
}

const slices = Math.max(1, Math.min(1000, Math.floor(span / every)));
const perSlice = Math.floor((totalSol / slices) * 1e8) / 1e8;
const warnings = [];
if (Math.floor(span / every) > 1000) warnings.push('capped at 1000 slices, the orders API maximum; widen --every to cover the full span');
if (perSlice < 0.01) warnings.push(`each buy is ${perSlice} SOL; network fees and slippage eat a large share of buys this small`);
const feeShare = (feeSol / perSlice) * 100;
if (feeShare > 1) warnings.push(`base fees alone are ${feeShare.toFixed(2)}% of each buy`);

const start = new Date();
const end = new Date(start.getTime() + slices * every * 1000);
const order = {
	type: 'dca',
	side: 'buy',
	mint,
	size_sol: perSlice,
	schedule: { interval_seconds: every, slices },
	slippage_bps: slippageBps,
	max_price_impact_pct: maxImpact,
	// A day of grace past the last slice so a delayed final fill still runs.
	expires_at: new Date(end.getTime() + 86400000).toISOString(),
};

const plan = {
	total_sol: Number((perSlice * slices).toFixed(8)),
	slices,
	per_slice_sol: perSlice,
	every_seconds: every,
	first_buy: start.toISOString(),
	last_buy: new Date(start.getTime() + (slices - 1) * every * 1000).toISOString(),
	warnings,
	order,
};

if (args.includes('--json')) {
	console.log(JSON.stringify(plan, null, 2));
} else {
	console.log(`plan        ${slices} buys of ${perSlice} SOL, one every ${opt('every', '1d')}`);
	console.log(`total       ${plan.total_sol} SOL from ${plan.first_buy.slice(0, 10)} to ${plan.last_buy.slice(0, 10)}`);
	console.log(`guards      slippage ${slippageBps} bps, price-impact ceiling ${maxImpact}% per buy`);
	for (const w of warnings) console.log(`warning     ${w}`);
	console.log('\norder body (preview first: POST /api/agents/<agent_id>/orders/preview):');
	console.log(JSON.stringify(order, null, 2));
}
