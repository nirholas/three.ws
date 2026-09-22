#!/usr/bin/env node
// Position size from account risk, the way the risk-manager skill does it.
//
//   node scripts/position-size.mjs --equity 20 --entry 0.00072 --stop 0.00061
//        [--risk-pct 1] [--max-position-pct 10] [--held 0] [--drawdown-pct 0] [--json]
//
// equity and held are in the same unit (SOL or USD). entry and stop are prices
// in any unit, as long as both use the same one. Prints the size that loses at
// most risk-pct of equity if the stop is hit, capped by the concentration limit
// and cut in half when the account is in drawdown. Pure arithmetic, no network.

const args = process.argv.slice(2);
const num = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	if (i < 0) return fallback;
	const v = Number(args[i + 1]);
	if (!Number.isFinite(v)) {
		console.error(`--${name} needs a number`);
		process.exit(2);
	}
	return v;
};

const equity = num('equity');
const entry = num('entry');
const stop = num('stop');
const riskPct = num('risk-pct', 1);
const maxPositionPct = num('max-position-pct', 10);
const held = num('held', 0);
const drawdownPct = num('drawdown-pct', 0);

if (!(equity > 0) || !(entry > 0) || !(stop > 0)) {
	console.error('usage: node scripts/position-size.mjs --equity <n> --entry <price> --stop <price> [--risk-pct 1] [--max-position-pct 10] [--held 0] [--drawdown-pct 0] [--json]');
	process.exit(2);
}
if (stop >= entry) {
	console.error('the stop must sit below the entry for a long position');
	process.exit(2);
}

const stopDistancePct = ((entry - stop) / entry) * 100;
// Drawdown rule: at 10% or more below the equity peak, risk per trade halves;
// at 20% or more, no new positions until the account recovers or the owner resets.
const halted = drawdownPct >= 20;
const effectiveRiskPct = halted ? 0 : drawdownPct >= 10 ? riskPct / 2 : riskPct;
const riskBudget = (equity * effectiveRiskPct) / 100;
const byRisk = riskBudget / (stopDistancePct / 100);
const byConcentration = Math.max(0, (equity * maxPositionPct) / 100 - held);
const size = halted ? 0 : Math.min(byRisk, byConcentration);
const maxLoss = size * (stopDistancePct / 100);

let verdict = 'GO';
let reason = 'within the risk budget and the concentration limit';
if (halted) {
	verdict = 'NO-GO';
	reason = `account is ${drawdownPct}% below its peak; new positions are paused at 20%`;
} else if (byConcentration <= 0) {
	verdict = 'NO-GO';
	reason = `already holding ${held}, at or above the ${maxPositionPct}% concentration limit`;
} else if (byConcentration < byRisk) {
	verdict = 'REDUCE';
	reason = `capped by the ${maxPositionPct}% concentration limit`;
} else if (stopDistancePct > 50) {
	verdict = 'REDUCE';
	reason = `a ${stopDistancePct.toFixed(0)}% stop is too wide to be a real stop`;
}

const out = {
	equity,
	entry,
	stop,
	stop_distance_pct: Number(stopDistancePct.toFixed(2)),
	risk_pct: effectiveRiskPct,
	risk_budget: Number(riskBudget.toFixed(6)),
	size_by_risk: Number(byRisk.toFixed(6)),
	size_by_concentration: Number(byConcentration.toFixed(6)),
	position_size: Number(size.toFixed(6)),
	position_pct_of_equity: Number(((size / equity) * 100).toFixed(2)),
	max_loss_at_stop: Number(maxLoss.toFixed(6)),
	verdict,
	reason,
};

if (args.includes('--json')) {
	console.log(JSON.stringify(out, null, 2));
} else {
	console.log('RISK CHECK');
	console.log(`- Position: ${out.position_size} (${out.position_pct_of_equity}% of equity)`);
	console.log(`- Stop: ${stop} (${out.stop_distance_pct}% below entry ${entry})`);
	console.log(`- Max loss at stop: ${out.max_loss_at_stop} (${effectiveRiskPct}% of equity)`);
	console.log(`- Verdict: ${verdict}, ${reason}`);
}
