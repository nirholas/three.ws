// Developer API plans: the one place the Free, Builder, Scale and Enterprise
// plans are defined.
//
// Everything else derives from this table: the gateway envelope (monthly call
// quota, burst rate, concurrent calls), the webhook cap, the checkout prices,
// the /developers page and the dashboard. A number that appears anywhere else
// is a bug. The published page renders these values and a calculation note; it
// never carries a typed number.
//
// Developer plans are separate from the product plans in data/plans.json
// (hosted agents, storage, free-model messages) and from the $THREE holding
// ladder in api/_lib/three-tier.js, which is loyalty, not a developer plan.
// A developer plan governs one thing: how many calls an account may make to
// the versioned API (/api/v1/*), how fast, and how many at once.
//
// Prices are in USD per 30-day period. Paying in $THREE applies
// THREE_DISCOUNT_BPS (env DEV_PLAN_THREE_DISCOUNT_BPS, default 2000, one fifth
// off). Credits and USDC pay the listed price. Kept free of imports so tests
// and the public page builder can load it without a database.

const PERIOD_DAYS = 30;

const PLANS = Object.freeze([
	Object.freeze({
		id: 'free',
		name: 'Free',
		tagline: 'Build and test against the whole API at no cost.',
		priceUsd: 0,
		includedCalls: 10_000,
		burstPerMinute: 60,
		concurrent: 4,
		webhooks: 2,
		purchasable: false,
		contactSales: false,
		rank: 0,
	}),
	Object.freeze({
		id: 'builder',
		name: 'Builder',
		tagline: 'For a shipped product with real traffic and a few integrations.',
		priceUsd: 29,
		includedCalls: 250_000,
		burstPerMinute: 600,
		concurrent: 16,
		webhooks: 10,
		purchasable: true,
		contactSales: false,
		rank: 1,
	}),
	Object.freeze({
		id: 'scale',
		name: 'Scale',
		tagline: 'For platforms and agents that call the API as part of every request.',
		priceUsd: 199,
		includedCalls: 3_000_000,
		burstPerMinute: 3_000,
		concurrent: 64,
		webhooks: 50,
		purchasable: true,
		contactSales: false,
		rank: 2,
	}),
	Object.freeze({
		id: 'enterprise',
		name: 'Enterprise',
		tagline: 'Custom quotas, a signed agreement, and a named contact.',
		priceUsd: 1_499,
		includedCalls: 30_000_000,
		burstPerMinute: 12_000,
		concurrent: 256,
		webhooks: 250,
		purchasable: true,
		contactSales: true,
		rank: 3,
	}),
]);

const BY_ID = new Map(PLANS.map((p) => [p.id, p]));

export const DEV_PLAN_IDS = Object.freeze(PLANS.map((p) => p.id));
export const DEV_PLAN_PERIOD_DAYS = PERIOD_DAYS;
export const DEV_PLAN_PERIOD_MS = PERIOD_DAYS * 86_400_000;
export const DEFAULT_DEV_PLAN_ID = 'free';
export const DEV_PLAN_PAY_ASSETS = Object.freeze(['credits', 'USDC', 'THREE']);
export const DEV_PLAN_UPGRADE_URL = '/developers';
export const DEV_PLAN_MANAGE_URL = '/dashboard/developers#plan';

function bpsFromEnv() {
	const raw = Number(process.env.DEV_PLAN_THREE_DISCOUNT_BPS);
	if (!Number.isFinite(raw)) return 2000;
	return Math.min(9000, Math.max(0, Math.round(raw)));
}

/** Discount, in basis points, for paying a plan in $THREE. */
export function threeDiscountBps() {
	return bpsFromEnv();
}

/** The $THREE price of a plan, in USD, after the configured discount. */
export function threePriceUsd(plan) {
	return Math.round(plan.priceUsd * (1 - threeDiscountBps() / 10_000) * 100) / 100;
}

/** All plans, lowest first, each with its derived $THREE price. */
export function listDevPlans() {
	return PLANS.map((p) => ({ ...p, threePriceUsd: threePriceUsd(p) }));
}

/** One plan by id. Throws a 400 for an unknown id. */
export function devPlanById(id) {
	const plan = BY_ID.get(String(id || DEFAULT_DEV_PLAN_ID).toLowerCase());
	if (!plan) {
		const err = new Error(`plan must be one of: ${DEV_PLAN_IDS.join(', ')}`);
		err.status = 400;
		err.code = 'bad_plan';
		throw err;
	}
	return { ...plan, threePriceUsd: threePriceUsd(plan) };
}

export function isKnownDevPlan(id) {
	return BY_ID.has(String(id || '').toLowerCase());
}

/**
 * Round-trip check for the published page: every plan has every field the
 * page renders, in the right shape. The page builder calls this so a config
 * edit that drops a field fails at build time rather than rendering "undefined".
 */
export function validateDevPlans() {
	const problems = [];
	let lastRank = -1;
	for (const p of PLANS) {
		for (const k of ['includedCalls', 'burstPerMinute', 'concurrent', 'webhooks']) {
			if (!Number.isInteger(p[k]) || p[k] <= 0) problems.push(`${p.id}.${k} must be a positive integer`);
		}
		if (!Number.isFinite(p.priceUsd) || p.priceUsd < 0) problems.push(`${p.id}.priceUsd must be a non-negative number`);
		if (p.rank !== lastRank + 1) problems.push(`${p.id}.rank must be ${lastRank + 1}`);
		lastRank = p.rank;
		if (p.purchasable && p.priceUsd === 0) problems.push(`${p.id} is purchasable but free`);
	}
	return problems;
}

/**
 * The calculation note shown wherever the plans are published. Built from the
 * config so the sentence can never disagree with the numbers.
 */
export function devPlanCalculationNote() {
	const bps = threeDiscountBps();
	const pct = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
	return (
		`Prices are per ${PERIOD_DAYS}-day period and are read from the plan configuration at request time; ` +
		`the $THREE price is the listed price less ${pct}%. Included calls reset at the start of each period. ` +
		`Burst is a sliding one-minute window per account; concurrent is the number of calls in flight at once per account. ` +
		`An upgrade mid-period is charged pro rata for the days left in the period; a downgrade takes effect when the period ends.`
	);
}
