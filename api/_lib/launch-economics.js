// Launch economics: the one setting every launch surface reads.
//
// A creator deciding how to launch needs three numbers, and they must be the
// numbers the platform actually enforces, not copy that drifted from them:
//
//   1. The creator's share of the coin's creator fees.
//   2. The platform's share (non-zero only on a gasless launch, where the
//      platform paid the rent and recovers it from the fees it co-owns on-chain).
//   3. How much of the platform's revenue is routed to the $THREE buyback.
//
// All three live in the `launch_economics` row of app_settings, merged over the
// defaults below. The launch studio, the launch detail page, the CLI table, the
// MCP tools, the gasless builder (which writes the split into the coin's
// on-chain fee-sharing config) and the fee claimer all call getLaunchEconomics(),
// so changing the row changes every surface at once. The buyback share is the
// published $THREE commitment (THREE_BUYBACK_COMMIT_BPS), read from the same
// helper the buyback engine uses.
//
// Operators change the row with SQL; the next read (60s cache) picks it up:
//   INSERT INTO app_settings (key, value) VALUES ('launch_economics', '{"gasless_platform_share_bps": 1500}')
//   ON CONFLICT (key) DO UPDATE SET value = app_settings.value || excluded.value, updated_at = now();

import { sql } from './db.js';
import { commitBpsFromEnv } from './token/buyback-math.js';

export const LAUNCH_ECONOMICS_KEY = 'launch_economics';

/** The public page that lists every confirmed $THREE buyback with its signature. */
export const BUYBACK_LEDGER_PATH = '/three-token#tk-bb-proof';
/** The JSON behind that ledger. */
export const BUYBACK_LEDGER_API = '/api/three-token/stats';

export const LAUNCH_ECONOMICS_DEFAULTS = Object.freeze({
	// Platform share of a gasless coin's creator fees, in bps. The creator keeps
	// the rest. Written into the coin's on-chain fee-sharing config at launch.
	gasless_platform_share_bps: 2000,
	gasless_enabled: true,
	// Anomaly guards on sponsored spend.
	gasless_per_account_daily: 1,
	gasless_platform_daily: 50,
	// Hard ceiling on what one sponsored launch may cost the sponsor. The measured
	// cost of a create plus fee-sharing setup is about 0.026 SOL.
	gasless_max_lamports: 40_000_000,
	// The sponsor keeps this much SOL after any launch, so a burst of launches can
	// never drain it below the floor the balance monitor refills from.
	gasless_sponsor_floor_lamports: 50_000_000,
});

const MIN_PLATFORM_SHARE_BPS = 500;
const MAX_PLATFORM_SHARE_BPS = 5000;

function intIn(raw, fallback, min, max) {
	const n = Number(raw);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Merge a stored row over the defaults and clamp every field to a safe range.
 * Pure, so tests pin the clamping without a database.
 * @param {object|null} stored
 * @param {Record<string,string|undefined>} [vars]
 */
export function normalizeLaunchEconomics(stored, vars = process.env) {
	const d = LAUNCH_ECONOMICS_DEFAULTS;
	const s = stored && typeof stored === 'object' ? stored : {};
	const platformShare = intIn(
		s.gasless_platform_share_bps,
		d.gasless_platform_share_bps,
		MIN_PLATFORM_SHARE_BPS,
		MAX_PLATFORM_SHARE_BPS,
	);
	const buybackBps = commitBpsFromEnv(vars);
	return {
		gasless: {
			enabled: s.gasless_enabled === undefined ? d.gasless_enabled : s.gasless_enabled === true,
			platform_share_bps: platformShare,
			creator_share_bps: 10_000 - platformShare,
			per_account_daily: intIn(s.gasless_per_account_daily, d.gasless_per_account_daily, 0, 100),
			platform_daily: intIn(s.gasless_platform_daily, d.gasless_platform_daily, 0, 10_000),
			max_lamports: intIn(s.gasless_max_lamports, d.gasless_max_lamports, 5_000_000, 200_000_000),
			sponsor_floor_lamports: intIn(
				s.gasless_sponsor_floor_lamports,
				d.gasless_sponsor_floor_lamports,
				0,
				10_000_000_000,
			),
		},
		// A standard (self-funded) launch: the creator keeps every creator fee.
		standard: { creator_share_bps: 10_000, platform_share_bps: 0 },
		buyback: {
			// Share of platform revenue committed to buying $THREE.
			share_of_platform_revenue_bps: buybackBps,
			// What that means for one gasless coin's creator fees.
			share_of_gasless_creator_fees_bps: Math.round((platformShare * buybackBps) / 10_000),
			ledger_path: BUYBACK_LEDGER_PATH,
			ledger_api: BUYBACK_LEDGER_API,
		},
	};
}

const TTL_MS = 60_000;
let cache = null;

/** The live economics. A database miss falls back to the defaults, never to a guess. */
export async function getLaunchEconomics({ fresh = false } = {}) {
	if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
	let stored = null;
	try {
		const [row] = await sql`SELECT value FROM app_settings WHERE key = ${LAUNCH_ECONOMICS_KEY}`;
		stored = row?.value ?? null;
	} catch (err) {
		console.warn('[launch-economics] settings read failed, using defaults', err?.message);
	}
	const value = normalizeLaunchEconomics(stored);
	cache = { at: Date.now(), value };
	return value;
}

/** Test seam: drop the cached row so the next read hits the database. */
export function _resetLaunchEconomicsCache() {
	cache = null;
}

/**
 * One human sentence per launch kind, built from the live numbers so copy can
 * never disagree with the enforced split.
 * @param {ReturnType<typeof normalizeLaunchEconomics>} econ
 */
export function describeFeeSplit(econ, { gasless }) {
	const pct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
	if (!gasless) return 'You keep 100% of the creator fees. You pay the launch rent and network fee yourself.';
	return (
		`three.ws pays the launch rent and network fee. In return the coin's creator fees are split on-chain: ` +
		`${pct(econ.gasless.creator_share_bps)} to you, ${pct(econ.gasless.platform_share_bps)} to three.ws, ` +
		`and ${pct(econ.buyback.share_of_platform_revenue_bps)} of the three.ws share buys $THREE.`
	);
}
