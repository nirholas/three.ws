#!/usr/bin/env node
// Preview and simulate a candidate fee schedule for the native launchpad config.
// Spends nothing and signs nothing: the schedule goes through the SDK validators,
// then `createConfigAndPool` is simulated against a live RPC with signature
// verification off.
//
//   node scripts/native-launchpad-simulate-fees.mjs --start 3000 --end 100 --periods 20 --slots 200 \
//        [--mode exponential|linear] [--network mainnet|devnet] [--payer <funded address>]
//
// Omit the fee flags to simulate the live lane schedule.

import 'dotenv/config';
import { previewFeeConfig, simulateFeeConfig } from '../api/_lib/native-launch/fee-config.js';
import { defaultFeeSchedule } from '../api/_lib/native-launch/config.js';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const num = (name, fallback) => (flag(name) === undefined ? fallback : Number(flag(name)));
const base = defaultFeeSchedule();
const schedule = {
	mode: flag('mode') ?? base.mode,
	start_fee_bps: num('start', base.start_fee_bps),
	end_fee_bps: num('end', base.end_fee_bps),
	periods: num('periods', base.periods),
	duration_slots: num('slots', base.duration_slots),
};
const network = flag('network') ?? 'mainnet';

try {
	const preview = await previewFeeConfig(schedule);
	console.log(preview.preview);
	console.log(preview.referral_preview);
	console.log('fee curve:', JSON.stringify(preview.fee_curve));
	const sim = await simulateFeeConfig({ network, schedule, payer: flag('payer') });
	console.log(
		sim.ok
			? `simulation OK on ${network}: config + pool accepted by the DBC program (${sim.units_consumed} compute units, tx ${sim.unsigned_tx_base64.length} base64 chars, unsigned)`
			: `simulation FAILED on ${network}: ${JSON.stringify(sim.error)}\n${sim.logs_tail.join('\n')}`,
	);
	process.exit(sim.ok ? 0 : 1);
} catch (e) {
	console.error(`${e.code || 'error'}: ${e.message}`);
	if (e.details?.length > 1) console.error(e.details.join('\n'));
	process.exit(1);
}
