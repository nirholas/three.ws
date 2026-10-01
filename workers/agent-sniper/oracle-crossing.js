// agent-sniper — Oracle conviction-crossing entries (trigger = 'oracle_crossing').
//
// The measured case for this trigger (fleet window 2026-07-20..23): coins whose
// conviction crossed 50 pumped or graduated 77.5% of the time vs an 11.8% base
// rate, the crossing lands a median of 2 minutes after launch, and the median
// capturable upside from the crossing candle is 1.23x (35% reach >=1.5x). The
// fleet's launch-time gates could never trade this band: at minute zero the
// Oracle has no signal yet, and by design the gate fails open or skips. This
// watcher inverts the flow: instead of gating a launch-second buy on a score
// that does not exist yet, it polls oracle_conviction and BUYS THE CROSSING.
//
// Discipline learned from the same dataset: median terminal decay after a
// crossing is 0.32x, so a crossing strategy must ship with a reachable
// take-profit or an initials-out ladder; this module does not soften any exit.
//
// Safety: candidates route through the SAME executeBuy chokepoint as every
// other trigger (Mayhem gate, trade-firewall buy+sell round trip, budgets,
// concurrency, SOL headroom, market-cap clamps). The x402 rugpull veto is
// checked here as well so a fresh high/critical verdict never even queues.
//
// Dedupe: one attempt per (strategy, mint), remembered in-memory for the
// watcher's lifetime and bounded; the DB's unique (agent_id, mint, network)
// position constraint makes retries idempotent at the ledger anyway.

import { sql } from '../../api/_lib/db.js';
import { log } from './log.js';
import { cachedStrategies } from './strategy-store.js';
import { executeBuy } from './executor.js';
import { rugpullVeto } from './oracle-gate.js';
import { getTradeCtx } from './trade-client.js';
import { PUMP_SDK, bondingCurvePda, bondingCurveMarketCap } from '@pump-fun/pump-sdk';

const POLL_MS = Math.max(5_000, Number(process.env.SNIPER_CROSSING_POLL_MS || 20_000));
// Only coins this young qualify: the edge is the EARLY crossing (median 2m).
// A coin that first crosses conviction hours after launch is a different regime
// than the one we measured.
const MAX_COIN_AGE_MIN = Math.max(5, Number(process.env.SNIPER_CROSSING_MAX_AGE_MIN || 90));
// Only act on scores computed recently; a stale row is not a live crossing.
const MAX_SCORE_AGE_MIN = Math.max(1, Number(process.env.SNIPER_CROSSING_SCORE_AGE_MIN || 10));
const DEFAULT_MIN_SCORE = 50;
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
// A bonding curve with no real reserves prices at ~27.96 SOL and can never go
// lower, so a coin sitting under ~40 SOL is a dead curve, not a crossing. In the
// 2026-10-01 review, 36% of this trigger's trades bought such curves: 2% won,
// none graduated, and 241 of 256 left through liquidity decay.
const MIN_CURVE_MCAP_SOL = Math.max(0, Number(process.env.SNIPER_CROSSING_MIN_MCAP_SOL ?? 40));

const MAX_ATTEMPTED = 5_000;

/**
 * Pure candidate selection: which (strategy, coin) pairs should attempt a buy.
 * Mutates `attempted` (adds each selected pair's key) so a pair is only ever
 * selected once per watcher lifetime.
 *
 * @param {Array<{mint: string, score: number|string}>} rows   crossing rows, any order
 * @param {Array<{id: string, min_oracle_score?: number|null}>} arms  oracle_crossing strategies
 * @param {Set<string>} attempted  `${strategyId}:${mint}` pairs already tried
 * @returns {Array<{coin: object, strat: object}>}
 */
export function crossingCandidates(rows, arms, attempted) {
	const out = [];
	for (const coin of rows) {
		for (const strat of arms) {
			const minScore = Number(strat.min_oracle_score ?? DEFAULT_MIN_SCORE);
			if (Number(coin.score) < minScore) continue;
			const key = `${strat.id}:${coin.mint}`;
			if (attempted.has(key)) continue;
			attempted.add(key);
			out.push({ coin, strat });
		}
	}
	return out;
}

/**
 * Should a crossing buy go ahead given the coin's live curve? Pure.
 *
 * Unknown curve state passes: executeBuy re-quotes the curve itself and fails a
 * graduated or missing coin safely, so an RPC hiccup here must not silently
 * starve the arm.
 *
 * @param {{complete:boolean, mcapSol:number}|null} state
 * @param {{minMcapSol:number}} opts
 * @returns {{pass:boolean, reason?:string, mcapSol?:number}}
 */
export function curveEntryVerdict(state, { minMcapSol }) {
	if (!state) return { pass: true };
	if (state.complete) return { pass: false, reason: 'curve_complete', mcapSol: state.mcapSol };
	if (state.mcapSol != null && Number.isFinite(state.mcapSol) && state.mcapSol < minMcapSol) {
		return { pass: false, reason: 'dead_curve', mcapSol: state.mcapSol };
	}
	return { pass: true, mcapSol: state.mcapSol };
}

/** Read a coin's bonding curve: completion flag and market cap in SOL. Null when unreadable. */
async function readCurveState(network, mint) {
	try {
		const ctx = await getTradeCtx(network);
		const mintPk = new ctx.web3.PublicKey(mint);
		const info = await ctx.connection.getAccountInfo(bondingCurvePda(mintPk));
		if (!info) return null;
		const curve = PUMP_SDK.decodeBondingCurve(info);
		// A curve quoted in another token prices its market cap in THAT token's
		// units, so it is not comparable to a SOL floor. Report it as unknown and
		// leave the quote-mint policy to executeBuy (require_sol_quote).
		const quoteMint = curve.quoteMint?.toBase58?.();
		if (quoteMint && quoteMint !== ctx.web3.PublicKey.default.toBase58() && quoteMint !== WSOL_MINT) {
			return { complete: curve.complete === true, mcapSol: null };
		}
		const mcapLamports = bondingCurveMarketCap({
			mintSupply: curve.tokenTotalSupply,
			virtualQuoteReserves: curve.virtualQuoteReserves ?? curve.virtualSolReserves,
			virtualTokenReserves: curve.virtualTokenReserves,
		});
		return { complete: curve.complete === true, mcapSol: Number(mcapLamports.toString()) / 1e9 };
	} catch (err) {
		log.warn('crossing curve read failed', { mint, err: err?.message });
		return null;
	}
}

export function startOracleCrossingWatch({ cfg, queue, throttle, isHalted }) {
	const attempted = new Set(); // `${strategyId}:${mint}`
	let stopped = false;
	let timer = null;

	async function tick() {
		if (stopped || isHalted()) return;
		const arms = cachedStrategies().filter(
			(s) => (s.trigger || 'new_mint') === 'oracle_crossing' && s.network === cfg.network,
		);
		if (!arms.length) return;

		const floor = Math.min(...arms.map((s) => Number(s.min_oracle_score ?? DEFAULT_MIN_SCORE)));
		let rows;
		try {
			rows = await sql`
				select mint, symbol, name, score, tier, coin_first_seen_at
				from oracle_conviction
				where network = ${cfg.network}
				  and score >= ${floor}
				  and scored_at > now() - make_interval(mins => ${MAX_SCORE_AGE_MIN})
				  and coin_first_seen_at > now() - make_interval(mins => ${MAX_COIN_AGE_MIN})
				  -- A graduated coin has no curve to buy on: 894 of this trigger's
				  -- 1,748 attempts died on CoinGraduatedError before this filter.
				  and not exists (
				    select 1 from pumpfun_graduations g where g.mint = oracle_conviction.mint
				  )
				order by score desc
				limit 25
			`;
		} catch (err) {
			log.warn('crossing watch query failed', { err: err?.message });
			return;
		}
		if (!rows.length) return;

		if (attempted.size > MAX_ATTEMPTED) {
			// Oldest-first eviction is overkill here; a full clear only risks one
			// duplicate attempt per pair, which the position ledger dedupes.
			attempted.clear();
		}
		for (const { coin, strat } of crossingCandidates(rows, arms, attempted)) {
			log.info('crossing candidate', {
				agent: strat.agent_id, mint: coin.mint, symbol: coin.symbol,
				score: coin.score, tier: coin.tier, min: strat.min_oracle_score ?? DEFAULT_MIN_SCORE,
			});
			queue.push(async () => {
				if (stopped || isHalted()) return;
				const rug = await rugpullVeto(coin.mint, cfg.network);
				if (rug.reject) {
					log.info('crossing rugpull veto', { agent: strat.agent_id, mint: coin.mint, level: rug.level, score: rug.score });
					return;
				}
				const curve = curveEntryVerdict(await readCurveState(cfg.network, coin.mint), { minMcapSol: MIN_CURVE_MCAP_SOL });
				if (!curve.pass) {
					log.info('crossing curve skip', { agent: strat.agent_id, mint: coin.mint, reason: curve.reason, mcap_sol: curve.mcapSol });
					return;
				}
				await executeBuy({
					cfg, strat, throttle,
					mint: {
						mint: coin.mint, symbol: coin.symbol, name: coin.name,
						entry_trigger: 'oracle_crossing',
						trigger_ref: `score:${coin.score}`,
						score: Number(coin.score),
					},
				});
			});
		}
	}

	function loop() {
		if (stopped) return;
		tick()
			.catch((err) => log.error('crossing watch tick failed', { err: err?.message }))
			.finally(() => {
				if (!stopped) timer = setTimeout(loop, POLL_MS);
			});
	}
	timer = setTimeout(loop, POLL_MS);
	log.info('oracle-crossing watch armed', { network: cfg.network, pollMs: POLL_MS, maxAgeMin: MAX_COIN_AGE_MIN });

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
}
