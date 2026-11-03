// Platform analytics: every headline number three.ws publishes about itself,
// in one read, each with a daily series and a plain-language `method`.
//
// This is the data layer behind GET /api/platform/analytics and the /analytics
// page. It answers "how big is the platform and is it growing" from the real
// tables that record each activity, never from a counter someone typed in.
//
// Contract:
//   - Every metric carries `total` (all time), `window_total` (inside the
//     requested window), a zero-filled `daily` series over the window, and a
//     `method` string saying exactly which rows were counted.
//   - Metrics are read in SOURCES (one or two queries per table). A source that
//     fails or times out yields `null` for each of its metrics plus one entry in
//     `errors`; it never fails the whole read and never reports a zero it did
//     not measure.
//   - Counting predicates match the endpoints that already publish the same
//     figure, so the analytics page and the home page can never disagree:
//     agents use the /api/home-stats and /api/platform/stats predicate, 3D
//     models the /api/home-stats one, marketplace sales the MARKET_PAID_KINDS
//     gate /pulse uses, and hire volume is read through platformEconomyStats(),
//     the helper behind /api/agent-economy/volume.

import { sql } from './db.js';
import { settleDaily } from './x402/self-facilitator-totals.js';
import { platformEconomyStats } from './agent-economy.js';
import { MARKET_PAID_KINDS } from './marketplace-kinds.js';
import { TOKEN_MINT, TOKEN_DECIMALS } from './token/config.js';
import { SOLANA_USDC_MINT } from '../payments/_config.js';

const DAY_MS = 86_400_000;
const USDC_DECIMALS = 6;
// A source slower than this is reported as unavailable rather than holding the
// whole response hostage. The slowest measured source (x402 settlements over
// 1.5M log rows) finished in under 5 s on production data on 2026-09-30.
const SOURCE_TIMEOUT_MS = 15_000;

export const ANALYTICS_WINDOWS = Object.freeze({ '30d': 30, '90d': 90, all: null });
export const DEFAULT_WINDOW = '30d';

/** Normalise a `?window=` value to one of ANALYTICS_WINDOWS' keys. */
export function resolveWindow(raw) {
	const key = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase();
	return Object.hasOwn(ANALYTICS_WINDOWS, key) ? key : DEFAULT_WINDOW;
}

function utcDayKey(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

function todayUtcMs(now) {
	return Date.parse(`${utcDayKey(now)}T00:00:00Z`);
}

/**
 * First UTC day of a bounded window, inclusive: a 30 day window is today plus
 * the 29 days before it. `null` for the all-time window.
 */
export function windowStartDay(windowKey, now = Date.now()) {
	const days = ANALYTICS_WINDOWS[windowKey];
	if (!days) return null;
	return utcDayKey(todayUtcMs(now) - (days - 1) * DAY_MS);
}

/** Every UTC day key from `fromDay` to today, inclusive. */
export function dayRange(fromDay, now = Date.now()) {
	const end = todayUtcMs(now);
	const out = [];
	for (let t = Date.parse(`${fromDay}T00:00:00Z`); t <= end; t += DAY_MS) out.push(utcDayKey(t));
	return out;
}

function atomicToUnits(atomic, decimals) {
	return Number(atomic || 0) / 10 ** decimals;
}

// ── Sources ─────────────────────────────────────────────────────────────────
// Each source reads one table and returns { total: {key: n}, daily: [{day, key: n}] }.
// `daily` rows only exist for days with activity; zero-filling happens once, below.

async function agentsSource(sinceDay) {
	const bound = sinceDay ? `${sinceDay}T00:00:00Z` : null;
	const [totals, daily] = await Promise.all([
		sql`
			SELECT
				COUNT(*)::bigint AS agents,
				COUNT(*) FILTER (WHERE COALESCE(meta->>'solana_address', '') <> '' OR wallet_address IS NOT NULL)::bigint AS agents_with_wallet
			FROM agent_identities
			WHERE deleted_at IS NULL
		`,
		sql`
			SELECT
				to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
				COUNT(*)::bigint AS agents,
				COUNT(*) FILTER (WHERE COALESCE(meta->>'solana_address', '') <> '' OR wallet_address IS NOT NULL)::bigint AS agents_with_wallet
			FROM agent_identities
			WHERE deleted_at IS NULL
			  AND (${bound}::timestamptz IS NULL OR created_at >= ${bound}::timestamptz)
			GROUP BY 1
		`,
	]);
	return {
		total: { agents: Number(totals[0]?.agents || 0), agents_with_wallet: Number(totals[0]?.agents_with_wallet || 0) },
		daily: daily.map((r) => ({ day: r.day, agents: Number(r.agents), agents_with_wallet: Number(r.agents_with_wallet) })),
	};
}

async function launchesSource(sinceDay) {
	const rows = await sql`
		WITH launches AS (
			SELECT created_at FROM pump_agent_mints WHERE network = 'mainnet'
			UNION ALL
			SELECT created_at FROM fixed_supply_launches WHERE network = 'mainnet'
		)
		SELECT
			to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
			COUNT(*)::bigint AS coins_launched
		FROM launches
		GROUP BY 1
	`;
	const daily = rows.map((r) => ({ day: r.day, coins_launched: Number(r.coins_launched) }));
	return {
		total: { coins_launched: daily.reduce((n, r) => n + r.coins_launched, 0) },
		daily: sinceDay ? daily.filter((r) => r.day >= sinceDay) : daily,
	};
}

async function forgeSource(sinceDay) {
	const bound = sinceDay ? `${sinceDay}T00:00:00Z` : null;
	const [totals, daily] = await Promise.all([
		sql`
			SELECT COUNT(*)::bigint AS n
			FROM forge_creations
			WHERE status = 'done' AND glb_url IS NOT NULL AND (outcome IS NULL OR outcome != 'rejected')
		`,
		sql`
			SELECT
				to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
				COUNT(*)::bigint AS n
			FROM forge_creations
			WHERE status = 'done' AND glb_url IS NOT NULL AND (outcome IS NULL OR outcome != 'rejected')
			  AND (${bound}::timestamptz IS NULL OR created_at >= ${bound}::timestamptz)
			GROUP BY 1
		`,
	]);
	return {
		total: { models_generated: Number(totals[0]?.n || 0) },
		daily: daily.map((r) => ({ day: r.day, models_generated: Number(r.n) })),
	};
}

async function llmSource(sinceDay) {
	// One pass over the partial index usage_events_llm_time: the all-time total
	// is the sum of the all-time daily series, and a bounded window keeps only
	// its own days of that series.
	const allDaily = await sql`
		SELECT
			to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
			COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS n
		FROM usage_events
		WHERE kind = 'llm'
		GROUP BY 1
	`;
	const daily = allDaily.map((r) => ({ day: r.day, llm_tokens: Number(r.n) }));
	return {
		total: { llm_tokens: daily.reduce((n, r) => n + r.llm_tokens, 0) },
		daily: sinceDay ? daily.filter((r) => r.day >= sinceDay) : daily,
	};
}

async function x402Source(sinceDay) {
	// Grouped by day over the (action, ok, ts) index; the all-time totals are the
	// sum of the days, so the table is scanned once.
	// Live log plus the rollup of days already archived and pruned.
	const rows = await settleDaily(sql, SOLANA_USDC_MINT);
	const daily = rows.map((r) => ({
		day: r.day,
		x402_settlements: Number(r.settlements),
		x402_volume_usd: atomicToUnits(r.usdc_atomic, USDC_DECIMALS),
	}));
	return {
		total: {
			x402_settlements: daily.reduce((n, r) => n + r.x402_settlements, 0),
			x402_volume_usd: daily.reduce((n, r) => n + r.x402_volume_usd, 0),
		},
		daily: sinceDay ? daily.filter((r) => r.day >= sinceDay) : daily,
	};
}

async function marketplaceSource(sinceDay) {
	const rows = await sql`
		SELECT
			to_char((COALESCE(confirmed_at, created_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
			COUNT(*)::bigint AS sales,
			COALESCE(SUM(amount) FILTER (WHERE currency_mint = ${TOKEN_MINT}), 0)::text AS three_atomic,
			COALESCE(SUM(amount) FILTER (WHERE currency_mint = ${SOLANA_USDC_MINT}), 0)::text AS usdc_atomic
		FROM skill_purchases
		WHERE status = 'confirmed' AND kind = ANY(${MARKET_PAID_KINDS})
		GROUP BY 1
	`;
	const daily = rows.map((r) => ({
		day: r.day,
		marketplace_sales: Number(r.sales),
		marketplace_volume_three: atomicToUnits(r.three_atomic, TOKEN_DECIMALS),
		marketplace_volume_usd: atomicToUnits(r.usdc_atomic, USDC_DECIMALS),
	}));
	const sum = (k) => daily.reduce((n, r) => n + r[k], 0);
	return {
		total: {
			marketplace_sales: sum('marketplace_sales'),
			marketplace_volume_three: sum('marketplace_volume_three'),
			marketplace_volume_usd: sum('marketplace_volume_usd'),
		},
		daily: sinceDay ? daily.filter((r) => r.day >= sinceDay) : daily,
	};
}

// Creator fees, from the agent_coin_earnings snapshot parity order 015 fills.
// The launchpad reports fees per creator WALLET, so this counts exactly the
// wallets api/_lib/agent-earnings.js counts toward an agent: the agent's own
// custodial wallet, not shared with another agent's coin. Each wallet is
// counted once however many coins it launched.
const COUNTED_CREATOR_WALLETS = () => sql`
	SELECT DISTINCT ON (e.creator) e.creator, e.earned_lamports
	FROM agent_coin_earnings e
	JOIN agent_identities ai ON ai.id = e.agent_id AND ai.deleted_at IS NULL
	WHERE e.network = 'mainnet'
	  AND e.source = 'pumpfun_creator_fees'
	  AND e.wallet_agent_count = 1
	  AND e.creator = ai.meta->>'solana_address'
	ORDER BY e.creator, e.refreshed_at DESC NULLS LAST
`;

async function creatorFeesSource(sinceDay) {
	const [totals, daily] = await Promise.all([
		sql`
			WITH w AS (${COUNTED_CREATOR_WALLETS()})
			SELECT COALESCE(SUM(earned_lamports), 0)::text AS lamports FROM w
		`,
		sql`
			WITH w AS (${COUNTED_CREATOR_WALLETS()})
			SELECT
				to_char((b.bucket_start AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
				COALESCE(SUM(b.fee_lamports), 0)::text AS lamports
			FROM creator_fee_buckets b
			JOIN w ON w.creator = b.creator
			WHERE b.bucket_interval = '1d'
			GROUP BY 1
		`,
	]);
	const rows = daily.map((r) => ({ day: r.day, creator_fees: atomicToUnits(r.lamports, 9) }));
	return {
		total: { creator_fees: atomicToUnits(totals[0]?.lamports, 9) },
		daily: sinceDay ? rows.filter((r) => r.day >= sinceDay) : rows,
	};
}

async function hiresSource(sinceDay, now) {
	// Reuses the /api/agent-economy/volume read so hire volume is one number
	// platform-wide. Its daily series is a trailing window in days; the all-time
	// window asks for enough days to reach the platform's first hire.
	const windowDays = sinceDay
		? Math.round((todayUtcMs(now) - Date.parse(`${sinceDay}T00:00:00Z`)) / DAY_MS) + 1
		: 3650;
	const stats = await platformEconomyStats({ windowDays, topLimit: 1, recentLimit: 1, maxWindowDays: 3650 });
	return {
		total: { hire_volume_usd: Number(stats.totals?.volume_usd || 0) },
		daily: (stats.daily || []).map((r) => ({ day: String(r.day).slice(0, 10), hire_volume_usd: Number(r.volume_usd || 0) })),
	};
}

// ── Metric catalogue ────────────────────────────────────────────────────────
// Order here is the order the page renders. `unit` drives formatting:
// count | tokens | usd | three | sol.

export const METRICS = Object.freeze([
	{
		key: 'agents',
		source: 'agents',
		label: 'Agents',
		unit: 'count',
		method: 'Every agent identity on three.ws that has not been deleted (table agent_identities, deleted_at is null), published or not. The daily series counts agents by the day they were created. Same rows /api/home-stats and /api/platform/stats count.',
	},
	{
		key: 'agents_with_wallet',
		source: 'agents',
		label: 'Agents with a wallet',
		unit: 'count',
		method: 'Agents from the row above that hold a wallet: a custodial Solana address provisioned in their record, or a linked EVM wallet address. Wallets are provisioned when an agent first needs one, so this trails the agent count. Each agent is counted once even if it has both.',
	},
	{
		key: 'coins_launched',
		source: 'launches',
		label: 'Coins launched',
		unit: 'count',
		method: 'Coins launched on Solana mainnet through three.ws: bonding-curve launches recorded in pump_agent_mints plus fixed-supply launches recorded in fixed_supply_launches. Devnet test launches are excluded. Counted by launch day.',
	},
	{
		key: 'models_generated',
		source: 'forge',
		label: '3D models generated',
		unit: 'count',
		method: 'Finished 3D generations (table forge_creations): status done, a GLB file stored, and not rejected by the quality gate. Failed and in-progress jobs are not counted. Counted by the day the job was started. Same predicate /api/home-stats uses.',
	},
	{
		key: 'llm_tokens',
		source: 'llm',
		label: 'LLM tokens processed',
		unit: 'tokens',
		method: 'Input plus output tokens of every metered language-model call the platform made for agents, chats and tools (usage_events rows of kind llm). Metering began on 2026-06-08, so earlier calls are not in the total.',
	},
	{
		key: 'x402_settlements',
		source: 'x402',
		label: 'x402 settlements',
		unit: 'count',
		method: 'Successful on-chain settlements by the three.ws self-hosted Solana x402 facilitator (x402_self_facilitator_log, action settle, ok). Failed and verify-only attempts are excluded. This includes the platform\'s own self-cycled agent ring, reported on its own at /api/x402-ring.',
	},
	{
		key: 'x402_volume_usd',
		source: 'x402',
		label: 'x402 volume',
		unit: 'usd',
		method: 'The amount moved by the settlements above that were paid in USDC, at face value (1 USDC = $1). Settlements paid in $THREE are counted in the settlement number but not added here, so no token price is assumed.',
	},
	{
		key: 'marketplace_sales',
		source: 'marketplace',
		label: 'Marketplace sales',
		unit: 'count',
		method: 'Paid skill purchases on the marketplace (skill_purchases with status confirmed and kind purchase or time pass). Free trials, bundles and pending or expired checkouts are not sales and are excluded. Counted by confirmation day.',
	},
	{
		key: 'marketplace_volume_three',
		source: 'marketplace',
		label: 'Marketplace volume ($THREE)',
		unit: 'three',
		method: 'The price paid for the sales above that settled in $THREE, in whole tokens.',
	},
	{
		key: 'marketplace_volume_usd',
		source: 'marketplace',
		label: 'Marketplace volume (USD)',
		unit: 'usd',
		method: 'The price paid for the sales above that settled in USDC, at face value.',
	},
	{
		key: 'hire_volume_usd',
		source: 'hires',
		label: 'Agent-to-agent hire volume',
		unit: 'usd',
		method: 'USD paid by one agent to another for a paid skill over x402 (agent_hires, status completed), by completion day. The same ledger /agent-economy-volume charts.',
	},
	{
		key: 'creator_fees',
		source: 'creatorFees',
		label: 'Creator fees earned',
		unit: 'sol',
		method: 'Trading fees earned by agents as the creator of the coins they launched, in SOL, from the per-coin earnings snapshot refreshed every 30 minutes (agent_coin_earnings). The launchpad reports fees per creator wallet, so a wallet is counted once, and only when it is the agent\'s own custodial wallet and no other agent\'s coin shares it, the same rule each agent\'s earnings page uses. The daily series sums the index\'s daily fee buckets for those wallets, which reach back about 100 days, so the all-time series can add up to less than the lifetime total.',
	},
]);

const SOURCES = {
	agents: agentsSource,
	launches: launchesSource,
	forge: forgeSource,
	llm: llmSource,
	x402: x402Source,
	marketplace: marketplaceSource,
	hires: hiresSource,
	creatorFees: creatorFeesSource,
};

function withTimeout(promise, ms, name) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Summing per-day decimal amounts drifts in the last float digits
// (11752.067000000001). Six places is the finest unit any metric here has.
function tidy(n) {
	return Number.isInteger(n) ? n : Number(n.toFixed(6));
}

function zeroFill(days, rows, key) {
	const byDay = new Map();
	for (const r of rows) byDay.set(r.day, (byDay.get(r.day) || 0) + (Number(r[key]) || 0));
	return days.map((day) => ({ day, value: tidy(byDay.get(day) || 0) }));
}

/**
 * Read every metric for one window.
 *
 * @param {object} [opts]
 * @param {'30d'|'90d'|'all'} [opts.window]
 * @param {number} [opts.now] clock override for tests
 * @param {Record<string, Function>} [opts.sources] source override for tests
 */
export async function readPlatformAnalytics({ window = DEFAULT_WINDOW, now = Date.now(), sources = SOURCES } = {}) {
	const windowKey = resolveWindow(window);
	const sinceDay = windowStartDay(windowKey, now);

	const names = Object.keys(sources);
	const settled = await Promise.allSettled(
		names.map((name) => withTimeout(Promise.resolve().then(() => sources[name](sinceDay, now)), SOURCE_TIMEOUT_MS, name)),
	);
	const results = {};
	const failures = {};
	settled.forEach((s, i) => {
		if (s.status === 'fulfilled') results[names[i]] = s.value;
		else failures[names[i]] = s.reason;
	});

	// The all-time window starts on the first day any source recorded activity.
	let fromDay = sinceDay;
	if (!fromDay) {
		const first = Object.values(results)
			.flatMap((r) => r.daily.map((d) => d.day))
			.sort()[0];
		fromDay = first || utcDayKey(now);
	}
	const days = dayRange(fromDay, now);

	const metrics = {};
	const errors = [];
	for (const m of METRICS) {
		const base = { key: m.key, label: m.label, unit: m.unit, method: m.method };
		const r = results[m.source];
		if (!r) {
			const err = failures[m.source];
			console.warn(`[platform-analytics] source ${m.source} failed`, err?.message || err);
			errors.push({
				metric: m.key,
				source: m.source,
				error: /timed out/.test(String(err?.message)) ? 'timeout' : 'query_failed',
				message: `The ${m.label.toLowerCase()} figure could not be read, so it is shown as unavailable rather than as zero.`,
			});
			metrics[m.key] = { ...base, available: false, total: null, window_total: null, daily: null };
			continue;
		}
		const daily = zeroFill(days, r.daily, m.key);
		metrics[m.key] = {
			...base,
			available: true,
			total: tidy(r.total[m.key]),
			window_total: tidy(daily.reduce((n, d) => n + d.value, 0)),
			daily,
		};
	}

	return {
		window: windowKey,
		window_days: days.length,
		from: fromDay,
		to: utcDayKey(now),
		updated_at: new Date(now).toISOString(),
		metrics,
		errors,
	};
}
