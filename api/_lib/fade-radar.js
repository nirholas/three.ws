// Fade Radar, the inverse of the Smart Money Radar.
// ---------------------------------------------------------------------------
// Smart Money asks "who reputable is buying this coin". Fade Radar asks the
// question that turns out to be sharper on pump.fun: "how much of this coin's
// buy side is money that has never once been right?"
//
// A REVERSE INDICATOR is a wallet the graph has watched buy at least
// RI_MIN_JUDGED coins whose outcome is already known, and that has zero winners
// among them (a winner is a coin that graduated to an AMM, or peaked at 3x or
// better). Those wallets exist in numbers: they are the exit liquidity every
// dead launch is built on. When they crowd a fresh coin, that coin is
// overwhelmingly a coin nobody else wants.
//
// This is not a short. Nothing on the pump.fun curve can be sold before it is
// bought, so "fading" here is an AVOIDANCE signal, never an inverted position,
// and this module never emits a trade. It scores a coin, ranks the live feed by
// that score, publishes the reverse-indicator board, and reports the measured
// odds behind the score (`getFadeCalibration`) so the number can be checked
// rather than believed.
//
// Reads the same maintained graph the firewall and the sniper scorer read
// (`smart_wallet_reputation`, refreshed by api/cron/smart-money-graph), so the
// fade side stays exactly as fresh as the smart side and needs no new job.
//
// Honest degradation, matching smart-money.js: a missing DATABASE_URL, an
// uncomputed graph or a failed query resolves to a well-formed zero-data result
// with `computed:false`. It never throws and never blocks a caller. A caller can
// always tell "no data" from "clean coin" by that flag.
//
// Derived only from on-chain addresses and observed outcomes. No curated lists,
// no invented names. $THREE is the only coin three.ws promotes; every mint here
// is whatever runtime coin the caller or the live feed hands us.

const NETWORK = 'mainnet';

// Judged coins a wallet must have been observed buying before its record counts.
// Below this, a zero-winner wallet is just a new wallet.
export const RI_MIN_JUDGED = 5;
// Observed buyers a coin needs before a share is a fact rather than noise. The
// footprint table records the observation window's buyers, so a coin with three
// of them can read 66% off a single wallet.
export const MIN_BUYERS = 5;
// Reverse-indicator share of buyers at which the measured win rate collapses.
export const AVOID_SHARE = 0.25;

const CACHE_TTL_MS = 20_000;
const CALIBRATION_TTL_MS = 12 * 60 * 60 * 1000;
const CALIBRATION_KEY = 'fade_radar_calibration';

let _sqlPromise = null;
async function getSql() {
	if (_sqlPromise) return _sqlPromise;
	_sqlPromise = import('./db.js')
		.then((m) => m.sql)
		.catch((err) => {
			console.warn('[fade-radar] db import failed:', err?.message);
			return null;
		});
	return _sqlPromise;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const lamportsToSol = (v) => {
	try {
		return Math.round((Number(BigInt(v ?? 0)) / 1e9) * 1000) / 1000;
	} catch {
		return Math.round((num(v) / 1e9) * 1000) / 1000;
	}
};
const pct = (part, whole) => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0);
const round1 = (x) => Math.round(x * 10) / 10;

const _mintCache = new Map();
function cacheGet(key) {
	const hit = _mintCache.get(key);
	if (!hit) return undefined;
	if (Date.now() - hit.at > CACHE_TTL_MS) {
		_mintCache.delete(key);
		return undefined;
	}
	return hit.value;
}
function cacheSet(key, value) {
	_mintCache.set(key, { at: Date.now(), value });
	if (_mintCache.size > 3_000) {
		const it = _mintCache.keys();
		for (let i = 0; i < 750; i++) _mintCache.delete(it.next().value);
	}
}

/**
 * The verdict for a reverse-indicator share of the buy side.
 *
 * @param {number} buyerShare 0..1 share of observed buyers that are reverse indicators
 * @param {number} buyers     observed buyers behind that share
 * @returns {'clear'|'caution'|'avoid'|'unknown'}
 */
export function fadeVerdict(buyerShare, buyers) {
	if (!Number.isFinite(buyers) || buyers < MIN_BUYERS) return 'unknown';
	if (!Number.isFinite(buyerShare) || buyerShare <= 0) return 'clear';
	return buyerShare >= AVOID_SHARE ? 'avoid' : 'caution';
}

/**
 * Score one coin's buy side. Pure, so the whole scoring contract is unit-tested
 * without a database.
 *
 * 0 is a coin no reverse indicator has touched; 100 is a coin whose entire
 * observed buy side, by wallets and by SOL, is money that has never been right.
 * Buyers and volume are both counted because they fail differently: ten dust
 * wallets are a crowd with no conviction, one large reverse-indicator buy is
 * conviction with no crowd, and a coin wants to be clean of both.
 *
 * @param {{buyers?:number, riBuyers?:number, totalBuySol?:number, riBuySol?:number}} input
 */
export function fadeScore(input = {}) {
	const buyers = Math.max(0, Math.trunc(num(input.buyers)));
	const riBuyers = Math.min(buyers, Math.max(0, Math.trunc(num(input.riBuyers))));
	const totalBuySol = Math.max(0, num(input.totalBuySol));
	const riBuySol = Math.min(totalBuySol, Math.max(0, num(input.riBuySol)));

	const buyerShare = pct(riBuyers, buyers);
	// With no volume recorded, the buyer share carries the whole score rather
	// than being halved by a zero it cannot know anything about.
	const volumeShare = totalBuySol > 0 ? pct(riBuySol, totalBuySol) : buyerShare;
	const score = Math.round(100 * (0.6 * buyerShare + 0.4 * volumeShare));

	return {
		score,
		buyers,
		ri_buyers: riBuyers,
		ri_buyer_share: Math.round(buyerShare * 1000) / 1000,
		ri_volume_share: Math.round(volumeShare * 1000) / 1000,
		ri_buy_sol: Math.round(riBuySol * 1000) / 1000,
		total_buy_sol: Math.round(totalBuySol * 1000) / 1000,
		verdict: fadeVerdict(buyerShare, buyers),
		confidence: buyers >= 10 ? 'high' : buyers >= MIN_BUYERS ? 'medium' : 'low',
	};
}

/** A plain sentence a trader can read in one second. */
export function fadeSummary(shaped) {
	const { verdict, ri_buyers: ri, buyers, score } = shaped;
	if (verdict === 'unknown') {
		return buyers > 0
			? `Only ${buyers} buyer${buyers === 1 ? '' : 's'} observed so far, too few to read the buy side.`
			: 'No buyers observed yet, so there is nothing to read.';
	}
	if (verdict === 'clear') {
		return `None of the ${buyers} observed buyers is a proven reverse indicator.`;
	}
	const share = Math.round(shaped.ri_buyer_share * 100);
	const volShare = Math.round(shaped.ri_volume_share * 100);
	const lead = verdict === 'avoid' ? 'Heavy reverse-indicator presence' : 'Some reverse-indicator presence';
	return `${lead}: ${ri} of ${buyers} observed buyers (${share}%) and ${volShare}% of the buy volume come from wallets with no winner on record. Fade score ${score}.`;
}

/** The well-formed zero-data shape. */
function emptyMint(mint, network) {
	return {
		mint,
		network,
		...fadeScore({}),
		notable: [],
		summary: 'No buyers observed yet, so there is nothing to read.',
		computed: false,
	};
}

/**
 * One coin's fade read: how much of its observed buy side is proven-losing money.
 *
 * @param {string} mint
 * @param {'mainnet'|'devnet'} [network]
 */
export async function getFadeForMint(mint, network = NETWORK) {
	const net = network === 'devnet' ? 'devnet' : NETWORK;
	if (!mint || typeof mint !== 'string') return emptyMint(mint, net);

	const key = `${net}:${mint}`;
	const cached = cacheGet(key);
	if (cached !== undefined) return cached;

	const sql = await getSql();
	if (!sql) {
		const empty = emptyMint(mint, net);
		cacheSet(key, empty);
		return empty;
	}

	let rows;
	try {
		// Every observed non-creator buyer of the coin, joined to its record.
		// The creator is excluded: a dev holding its own supply is a different
		// signal (dev_sold / concentration already carry it) and would otherwise
		// count once in every coin it launched.
		rows = await sql`
			SELECT w.wallet,
			       w.buy_lamports,
			       COALESCE(r.trades_seen, 0) AS trades_seen,
			       COALESCE(r.winners, 0)     AS winners,
			       COALESCE(r.losers, 0)      AS losers,
			       r.realized_score,
			       r.last_seen
			FROM pump_coin_wallets w
			LEFT JOIN smart_wallet_reputation r
			       ON r.address = w.wallet AND r.network = ${net}
			WHERE w.mint = ${mint} AND w.buy_lamports > 0 AND NOT w.is_creator
		`;
	} catch (err) {
		console.warn('[fade-radar] mint read failed:', err?.message);
		const empty = emptyMint(mint, net);
		cacheSet(key, empty);
		return empty;
	}

	if (!rows.length) {
		const empty = emptyMint(mint, net);
		cacheSet(key, empty);
		return empty;
	}

	const isRi = (r) => Number(r.trades_seen) >= RI_MIN_JUDGED && Number(r.winners) === 0;
	let totalLam = 0n;
	let riLam = 0n;
	const ri = [];
	for (const r of rows) {
		let lam = 0n;
		try {
			lam = BigInt(r.buy_lamports ?? 0);
		} catch {
			lam = 0n;
		}
		totalLam += lam;
		if (isRi(r)) {
			riLam += lam;
			ri.push({
				wallet: r.wallet,
				buy_sol: lamportsToSol(lam),
				judged_buys: Number(r.trades_seen) || 0,
				winners: 0,
				losers: Number(r.losers) || 0,
				realized_score: num(r.realized_score),
				last_seen: r.last_seen,
			});
		}
	}
	ri.sort((a, b) => b.judged_buys - a.judged_buys || b.buy_sol - a.buy_sol);

	const shaped = fadeScore({
		buyers: rows.length,
		riBuyers: ri.length,
		totalBuySol: lamportsToSol(totalLam),
		riBuySol: lamportsToSol(riLam),
	});
	const result = {
		mint,
		network: net,
		...shaped,
		notable: ri.slice(0, 8),
		summary: fadeSummary(shaped),
		computed: true,
	};
	cacheSet(key, result);
	return result;
}

/**
 * The live board: recent coins ranked by how much proven-losing money is in them.
 *
 * @param {{hours?:number, limit?:number, minBuyers?:number, network?:string}} [opts]
 */
export async function listFadeFeed(opts = {}) {
	const net = opts.network === 'devnet' ? 'devnet' : NETWORK;
	const hours = Math.min(72, Math.max(1, Math.trunc(num(opts.hours, 6))));
	const limit = Math.min(100, Math.max(1, Math.trunc(num(opts.limit, 40))));
	const minBuyers = Math.min(50, Math.max(1, Math.trunc(num(opts.minBuyers, MIN_BUYERS))));

	const sql = await getSql();
	if (!sql) return { coins: [], window_hours: hours, computed: false };

	let rows;
	try {
		rows = await sql`
			WITH recent AS (
				SELECT i.mint, i.symbol, i.name, i.image_uri, i.category, i.first_seen_at,
				       i.quality_score, i.organic_score,
				       (g.mint IS NOT NULL) AS graduated
				FROM pump_coin_intel i
				LEFT JOIN pumpfun_graduations g ON g.mint = i.mint
				WHERE i.network = ${net}
				  AND i.first_seen_at > now() - make_interval(hours => ${hours}::int)
			)
			SELECT r.mint, r.symbol, r.name, r.image_uri, r.category, r.first_seen_at,
			       r.quality_score, r.organic_score, r.graduated,
			       count(*)::int AS buyers,
			       count(*) FILTER (
			           WHERE s.trades_seen >= ${RI_MIN_JUDGED} AND s.winners = 0
			       )::int AS ri_buyers,
			       sum(w.buy_lamports) AS total_lamports,
			       COALESCE(sum(w.buy_lamports) FILTER (
			           WHERE s.trades_seen >= ${RI_MIN_JUDGED} AND s.winners = 0
			       ), 0) AS ri_lamports
			FROM recent r
			JOIN pump_coin_wallets w
			  ON w.mint = r.mint AND w.buy_lamports > 0 AND NOT w.is_creator
			LEFT JOIN smart_wallet_reputation s
			  ON s.address = w.wallet AND s.network = ${net}
			GROUP BY r.mint, r.symbol, r.name, r.image_uri, r.category, r.first_seen_at,
			         r.quality_score, r.organic_score, r.graduated
			HAVING count(*) >= ${minBuyers}
			   AND count(*) FILTER (
			           WHERE s.trades_seen >= ${RI_MIN_JUDGED} AND s.winners = 0
			       ) > 0
			ORDER BY (count(*) FILTER (
			              WHERE s.trades_seen >= ${RI_MIN_JUDGED} AND s.winners = 0
			          )::numeric / count(*)) DESC,
			         count(*) DESC
			LIMIT ${limit}
		`;
	} catch (err) {
		console.warn('[fade-radar] feed read failed:', err?.message);
		return { coins: [], window_hours: hours, computed: false };
	}

	const coins = rows.map((r) => {
		const shaped = fadeScore({
			buyers: Number(r.buyers),
			riBuyers: Number(r.ri_buyers),
			totalBuySol: lamportsToSol(r.total_lamports),
			riBuySol: lamportsToSol(r.ri_lamports),
		});
		return {
			mint: r.mint,
			symbol: r.symbol,
			name: r.name,
			image_uri: r.image_uri,
			category: r.category,
			first_seen_at: r.first_seen_at,
			graduated: !!r.graduated,
			quality_score: num(r.quality_score),
			organic_score: num(r.organic_score),
			...shaped,
			summary: fadeSummary(shaped),
		};
	});
	return { coins, window_hours: hours, computed: true };
}

/**
 * The reverse-indicator board: the wallets themselves, worst record first.
 *
 * @param {{limit?:number, minJudged?:number, activeHours?:number, network?:string}} [opts]
 */
export async function listReverseIndicators(opts = {}) {
	const net = opts.network === 'devnet' ? 'devnet' : NETWORK;
	const limit = Math.min(100, Math.max(1, Math.trunc(num(opts.limit, 25))));
	const minJudged = Math.min(500, Math.max(RI_MIN_JUDGED, Math.trunc(num(opts.minJudged, RI_MIN_JUDGED))));
	const activeHours = Math.max(0, Math.trunc(num(opts.activeHours, 0)));

	const sql = await getSql();
	if (!sql) return { wallets: [], computed: false };

	let rows;
	try {
		rows = await sql`
			SELECT address, trades_seen, winners, losers, realized_score, labels,
			       first_seen, last_seen
			FROM smart_wallet_reputation
			WHERE network = ${net}
			  AND winners = 0
			  AND trades_seen >= ${minJudged}
			  AND (${activeHours}::int = 0 OR last_seen > now() - make_interval(hours => ${activeHours}::int))
			ORDER BY trades_seen DESC, last_seen DESC NULLS LAST
			LIMIT ${limit}
		`;
	} catch (err) {
		console.warn('[fade-radar] wallet board read failed:', err?.message);
		return { wallets: [], computed: false };
	}

	return {
		computed: true,
		wallets: rows.map((r) => ({
			wallet: r.address,
			judged_buys: Number(r.trades_seen) || 0,
			winners: 0,
			losers: Number(r.losers) || 0,
			realized_score: num(r.realized_score),
			labels: Array.isArray(r.labels) ? r.labels : [],
			first_seen: r.first_seen,
			last_seen: r.last_seen,
		})),
	};
}

/**
 * The measured odds behind the score, computed out of sample.
 *
 * The honesty problem this solves: a wallet's record is built from coin outcomes,
 * so scoring the same coins it was built on would grade the signal on its own
 * answer sheet. So the labelled history is split in half by outcome time, the
 * reverse-indicator cohort is rebuilt using ONLY coins labelled in the earlier
 * half, and the win rate is measured on coins labelled in the later half, which
 * that cohort could not have seen. What comes back is the real thing: how often a
 * coin in each band went on to graduate or 3x, against the baseline for coins
 * with no reverse indicator in them at all.
 *
 * The query walks the full labelled history, so the result is cached in
 * `app_settings` for CALIBRATION_TTL_MS and served stale while a refresh runs.
 *
 * @param {{network?:string, force?:boolean}} [opts]
 */
export async function getFadeCalibration(opts = {}) {
	const net = opts.network === 'devnet' ? 'devnet' : NETWORK;
	const sql = await getSql();
	if (!sql) return { bands: [], computed: false };

	let stored = null;
	try {
		const [row] = await sql`SELECT value FROM app_settings WHERE key = ${CALIBRATION_KEY}`;
		stored = row?.value ?? null;
	} catch {
		stored = null;
	}
	const age = stored?.computed_at ? Date.now() - Date.parse(stored.computed_at) : Infinity;
	if (stored && !opts.force && Number.isFinite(age) && age < CALIBRATION_TTL_MS) return stored;

	let fresh;
	try {
		fresh = await computeCalibration(sql, net);
	} catch (err) {
		console.warn('[fade-radar] calibration failed:', err?.message);
		return stored ?? { bands: [], computed: false };
	}
	try {
		await sql`
			INSERT INTO app_settings (key, value)
			VALUES (${CALIBRATION_KEY}, ${JSON.stringify(fresh)}::jsonb)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value
		`;
	} catch (err) {
		console.warn('[fade-radar] calibration store failed:', err?.message);
	}
	return fresh;
}

async function computeCalibration(sql, net) {
	const rows = await sql`
		WITH judged AS (
			SELECT o.mint, o.outcome, o.labeled_at,
			       (o.outcome IN ('graduated', 'pumped')) AS win
			FROM pump_coin_outcomes o
			WHERE o.outcome IN ('graduated', 'pumped', 'flat', 'rugged')
		),
		span AS (
			SELECT min(labeled_at) AS lo, max(labeled_at) AS hi FROM judged
		),
		split AS (
			SELECT lo + (hi - lo) / 2 AS at FROM span
		),
		train AS (
			SELECT w.wallet, count(*)::int AS n, count(*) FILTER (WHERE j.win)::int AS wins
			FROM pump_coin_wallets w
			JOIN judged j ON j.mint = w.mint
			WHERE w.buy_lamports > 0 AND NOT w.is_creator
			  AND j.labeled_at < (SELECT at FROM split)
			GROUP BY w.wallet
		),
		test AS (
			SELECT j.mint, j.outcome, j.win FROM judged j
			WHERE j.labeled_at >= (SELECT at FROM split)
		),
		per_coin AS (
			SELECT t.mint,
			       count(*)::int AS buyers,
			       count(*) FILTER (
			           WHERE tr.n >= ${RI_MIN_JUDGED} AND tr.wins = 0
			       )::int AS ri_buyers
			FROM test t
			JOIN pump_coin_wallets w
			  ON w.mint = t.mint AND w.buy_lamports > 0 AND NOT w.is_creator
			LEFT JOIN train tr ON tr.wallet = w.wallet
			GROUP BY t.mint
		)
		SELECT CASE
		           WHEN p.ri_buyers::numeric / p.buyers >= ${AVOID_SHARE} THEN 'avoid'
		           WHEN p.ri_buyers > 0 THEN 'caution'
		           ELSE 'clear'
		       END AS band,
		       count(*)::int AS coins,
		       round(100.0 * avg(CASE WHEN t.win THEN 1 ELSE 0 END), 2) AS win_pct,
		       round(100.0 * avg(CASE WHEN t.outcome = 'graduated' THEN 1 ELSE 0 END), 2) AS graduated_pct,
		       round(100.0 * avg(CASE WHEN t.outcome = 'rugged' THEN 1 ELSE 0 END), 2) AS rugged_pct
		FROM per_coin p
		JOIN test t ON t.mint = p.mint
		WHERE p.buyers >= ${MIN_BUYERS}
		GROUP BY 1
	`;
	const byBand = new Map(rows.map((r) => [r.band, r]));
	const baseline = byBand.get('clear');
	const baselineWin = baseline ? num(baseline.win_pct) : 0;
	const bands = ['clear', 'caution', 'avoid'].map((band) => {
		const r = byBand.get(band);
		const winPct = r ? num(r.win_pct) : 0;
		return {
			band,
			coins: r ? Number(r.coins) : 0,
			win_pct: round1(winPct),
			graduated_pct: r ? round1(num(r.graduated_pct)) : 0,
			rugged_pct: r ? round1(num(r.rugged_pct)) : 0,
			// How many times likelier a coin in this band is to win than one with
			// no reverse indicator in it. Below 1 is the whole point of the page.
			lift: baselineWin > 0 ? Math.round((winPct / baselineWin) * 100) / 100 : null,
		};
	});
	return {
		computed: true,
		network: net,
		bands,
		baseline_win_pct: round1(baselineWin),
		sample_coins: bands.reduce((a, b) => a + b.coins, 0),
		method: 'out_of_sample_time_split',
		ri_min_judged: RI_MIN_JUDGED,
		min_buyers: MIN_BUYERS,
		avoid_share: AVOID_SHARE,
		computed_at: new Date().toISOString(),
	};
}
