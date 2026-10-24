// Candidate fee configuration for the native lane: validate a decaying-fee schedule,
// run it through Meteora's own config validators, describe it in plain language and,
// on request, simulate creating the config plus a pool under it against a live RPC.
// Nothing here signs or sends: the simulation runs with signature verification off
// and the returned transaction is unsigned.

import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getConnection, solanaPubkey } from '../pump.js';
import { validateFeeSchedule, describeFeeSchedule, describeReferral, referralShareOfTradingFeePercent } from '../../../src/shared/launch-fees.js';
import { curveBuildParams, defaultFeeSchedule, quoteMintFor, feeWallet, NATIVE_LANE } from './config.js';
import { getDbcClient, withQuoteTokenProgram } from './dbc.js';

const badRequest = (message, details) => Object.assign(new Error(message), { status: 400, code: 'validation_error', details });

let _sdk = null;
const sdk = async () => (_sdk ||= await import('@meteora-ag/dynamic-bonding-curve-sdk'));

// Fee in basis points `slot` slots after activation, evaluated from the scheduler
// parameters the SDK resolves (getBaseFeeParams): the fee steps down once every
// `periodFrequency` slots, `numberOfPeriod` times, linearly or by a fixed ratio.
// The SDK dropped its own evaluator in 2.0, so this mirrors the program's rule.
export async function feeBpsAtSlot(baseFeeParams, slot) {
	const { getBaseFeeParams, MAX_BASIS_POINT } = await sdk();
	const sp = getBaseFeeParams(baseFeeParams);
	const cliff = Number(sp.cliffFeeNumerator.toString());
	const periods = Number(sp.firstFactor);
	const frequency = Number(sp.secondFactor.toString());
	const reduction = Number(sp.thirdFactor.toString());
	if (periods === 0 || frequency === 0) return cliff / 100_000;
	const elapsed = Math.min(Math.floor(slot / frequency), periods);
	const numerator =
		sp.baseFeeMode === 0
			? cliff - elapsed * reduction
			: cliff * (1 - reduction / (MAX_BASIS_POINT ?? 10_000)) ** elapsed;
	return Math.round((numerator / 100_000) * 100) / 100;
}

async function feeCurve(baseFeeParams, durationSlots) {
	const marks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(durationSlots * f));
	return Promise.all(
		marks.map(async (slot) => ({
			slot,
			seconds: Math.round(slot * 0.4),
			fee_bps: await feeBpsAtSlot(baseFeeParams, slot),
		})),
	);
}

// Validates `input` (defaults to the live lane schedule) and returns the normalised
// schedule, its preview text and the fee curve. Throws a 400 with every problem found.
export async function previewFeeConfig(input) {
	const checked = validateFeeSchedule(input ?? defaultFeeSchedule());
	if (!checked.ok) throw badRequest(checked.errors[0], checked.errors);
	const { schedule } = checked;
	const { buildCurveWithMarketCap, validateConfigParameters } = await sdk();
	let config;
	try {
		config = buildCurveWithMarketCap(curveBuildParams({ feeSchedule: schedule }));
		validateConfigParameters({ ...config, leftoverReceiver: Keypair.generate().publicKey });
	} catch (e) {
		throw badRequest(e.message, [e.message]);
	}
	return {
		schedule,
		preview: describeFeeSchedule(schedule),
		referral_preview: describeReferral(),
		referral_share_of_trading_fee_percent: referralShareOfTradingFeePercent(),
		fee_curve: await feeCurve(curveBuildParams({ feeSchedule: schedule }).fee.baseFeeParams, schedule.duration_slots),
		config,
	};
}

// Simulates `createConfigAndPool` for a candidate schedule on `network`. The fee
// payer only has to exist and hold SOL; its signature is never checked.
export async function simulateFeeConfig({ network = 'mainnet', schedule, payer } = {}) {
	const quoteMintStr = quoteMintFor(network);
	const quoteMint = solanaPubkey(quoteMintStr);
	if (!quoteMint) {
		throw Object.assign(new Error(`native launchpad quote mint not set on ${network}`), { status: 503, code: 'lane_not_configured' });
	}
	const payerPk = solanaPubkey(payer || feeWallet());
	if (!payerPk) throw badRequest('payer wallet required: pass wallet_address (any funded address; it is never asked to sign)');
	const { config } = await previewFeeConfig(schedule);
	const connection = getConnection({ network });
	const client = await getDbcClient({ network });
	const tx = await client.partner.createConfigAndPool({
		...config,
		config: Keypair.generate().publicKey,
		feeClaimer: payerPk,
		leftoverReceiver: payerPk,
		quoteMint,
		payer: payerPk,
		preCreatePoolParam: {
			name: 'Fee Config Simulation',
			symbol: 'SIM',
			uri: 'https://three.ws/launchpad',
			poolCreator: payerPk,
			baseMint: Keypair.generate().publicKey,
		},
	});
	const info = await connection.getAccountInfo(quoteMint);
	if (!info) throw Object.assign(new Error(`quote mint ${quoteMintStr} not found on ${network}`), { status: 503, code: 'lane_not_configured' });
	const instructions = await withQuoteTokenProgram(tx.instructions, info.owner);
	const message = new TransactionMessage({
		payerKey: payerPk,
		recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
		instructions,
	}).compileToV0Message();
	const versioned = new VersionedTransaction(message);
	const sim = await connection.simulateTransaction(versioned, { sigVerify: false, replaceRecentBlockhash: true });
	return {
		network,
		quote: NATIVE_LANE.quote,
		quote_mint: quoteMintStr,
		ok: !sim.value.err,
		error: sim.value.err ?? null,
		units_consumed: sim.value.unitsConsumed ?? null,
		logs_tail: (sim.value.logs || []).slice(-6),
		unsigned_tx_base64: Buffer.from(versioned.serialize()).toString('base64'),
		note: 'Simulation only. The config account is an ephemeral key, so this transaction is not submittable.',
	};
}

