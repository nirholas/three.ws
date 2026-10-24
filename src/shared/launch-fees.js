// Launch-time fee configuration rules, shared by the server (api/_lib/native-launch,
// api/pump) and the launch UI so the number a creator sees is the number the
// program accepts. Pure functions, no imports.
//
// The limits mirror the Meteora Dynamic Bonding Curve SDK's own validators
// (getFeeSchedulerParams) and pump.fun's fee-sharing config rules. The server
// still runs the SDK validators on top; this module exists so the browser can
// reject a bad value before any request is made.

export const SLOT_SECONDS = 0.4;
export const MIN_FEE_BPS = 25;
export const MAX_FEE_BPS = 9_900;
export const MAX_FEE_PERIODS = 65_535;
export const MAX_SHAREHOLDERS = 10;
// The program pays a swap referrer this share of the protocol's cut of the trading fee.
export const REFERRAL_SHARE_OF_PROTOCOL_FEE_PERCENT = 20;
export const PROTOCOL_SHARE_OF_TRADING_FEE_PERCENT = 20;

export const FEE_SCHEDULE_MODES = Object.freeze({ linear: 0, exponential: 1 });

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const isInt = (v) => Number.isInteger(v);

function pct(bps) {
	const v = bps / 100;
	return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function span(slots) {
	const seconds = Math.round(slots * SLOT_SECONDS);
	if (seconds < 90) return `${seconds} seconds`;
	const minutes = seconds / 60;
	if (minutes < 90) return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes`;
	const hours = minutes / 60;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

// Validates a decaying-fee schedule. Returns { ok, errors[], schedule } where
// `schedule` is the normalised value. Rate-limiter mode is refused with the SDK's
// reason: the program rejects it for new configs.
export function validateFeeSchedule(input) {
	const errors = [];
	const mode = input?.mode ?? 'exponential';
	if (mode === 'rate_limiter' || mode === 'rateLimiter') {
		errors.push(
			'The rate limiter is deprecated by the Dynamic Bonding Curve program and is rejected for new configs. Use a linear or exponential fee schedule.',
		);
	} else if (!(mode in FEE_SCHEDULE_MODES)) {
		errors.push('mode must be "linear" or "exponential".');
	}
	const start = input?.start_fee_bps;
	const end = input?.end_fee_bps;
	const periods = input?.periods ?? 0;
	const duration = input?.duration_slots ?? 0;
	for (const [label, v] of [['start_fee_bps', start], ['end_fee_bps', end]]) {
		if (!isInt(v) || v < MIN_FEE_BPS || v > MAX_FEE_BPS) {
			errors.push(`${label} must be a whole number of basis points between ${MIN_FEE_BPS} and ${MAX_FEE_BPS}.`);
		}
	}
	if (isInt(start) && isInt(end)) {
		if (end > start) {
			errors.push('end_fee_bps must be less than or equal to start_fee_bps: a schedule can only fall.');
		} else if (start === end) {
			if (periods !== 0 || duration !== 0) {
				errors.push('periods and duration_slots must both be 0 when the fee is constant.');
			}
		} else {
			if (!isInt(periods) || periods <= 0 || !isInt(duration) || duration <= 0) {
				errors.push('periods and duration_slots must both be greater than 0 when the fee falls.');
			} else {
				if (periods > MAX_FEE_PERIODS) errors.push(`periods must be at most ${MAX_FEE_PERIODS}.`);
				if (duration < periods) errors.push('duration_slots must be at least periods.');
			}
		}
	}
	if (errors.length) return { ok: false, errors, schedule: null };
	return {
		ok: true,
		errors: [],
		schedule: { mode, start_fee_bps: start, end_fee_bps: end, periods, duration_slots: duration },
	};
}

// "Fee starts at 50% and falls to 1% over about 40 seconds (100 slots, in 25 steps)."
export function describeFeeSchedule(schedule) {
	if (schedule.start_fee_bps === schedule.end_fee_bps) {
		return `Fee is a flat ${pct(schedule.start_fee_bps)} from the first trade.`;
	}
	const shape =
		schedule.mode === 'linear' ? 'in equal steps' : 'with the steepest drop first';
	return `Fee starts at ${pct(schedule.start_fee_bps)} and falls to ${pct(schedule.end_fee_bps)} over about ${span(schedule.duration_slots)} (${schedule.duration_slots} slots, ${schedule.periods} steps, ${shape}).`;
}

// Plain-language line for the swap referral share of a trading fee, as a percentage
// of the whole trading fee.
export function referralShareOfTradingFeePercent() {
	return (PROTOCOL_SHARE_OF_TRADING_FEE_PERCENT * REFERRAL_SHARE_OF_PROTOCOL_FEE_PERCENT) / 100;
}

export function describeReferral() {
	return `A swap referrer earns ${REFERRAL_SHARE_OF_PROTOCOL_FEE_PERCENT}% of the protocol's ${PROTOCOL_SHARE_OF_TRADING_FEE_PERCENT}% cut of each trading fee (${referralShareOfTradingFeePercent()}% of the fee), paid by the program when the swap names a referral token account.`;
}

// Validates a shared fee vault split: 1 to 10 distinct wallets whose percentages
// total exactly 100. Each row is { address, percent } or { address, share_bps }.
// Returns { ok, errors[], shareholders: [{ address, share_bps }] } (bps total 10000,
// the unit pump.fun's fee-sharing config takes).
export function validateShareholders(rows) {
	const errors = [];
	if (!Array.isArray(rows) || rows.length === 0) {
		return { ok: false, errors: ['Add at least one shareholder.'], shareholders: [] };
	}
	if (rows.length > MAX_SHAREHOLDERS) errors.push(`A shared fee vault holds at most ${MAX_SHAREHOLDERS} shareholders.`);
	const seen = new Set();
	const out = [];
	let total = 0;
	for (const [i, row] of rows.entries()) {
		const address = typeof row?.address === 'string' ? row.address.trim() : '';
		const bps = row?.share_bps ?? (typeof row?.percent === 'number' ? Math.round(row.percent * 100) : NaN);
		if (!BASE58.test(address)) errors.push(`Shareholder ${i + 1} needs a valid Solana wallet address.`);
		else if (seen.has(address)) errors.push(`Shareholder ${i + 1} repeats a wallet already in the list.`);
		seen.add(address);
		if (!isInt(bps) || bps < 1 || bps > 10_000) {
			errors.push(`Shareholder ${i + 1} needs a share between 0.01% and 100%.`);
			continue;
		}
		total += bps;
		out.push({ address, share_bps: bps });
	}
	if (total !== 10_000) errors.push(`Shares must total 100% (currently ${pct(total)}).`);
	return { ok: errors.length === 0, errors, shareholders: out };
}
