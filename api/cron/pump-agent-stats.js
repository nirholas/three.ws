// GET/POST /api/cron/pump-agent-stats
//
// For every pump_agent_mints row, fetch the bonding curve (pre-graduation) or
// canonical AMM pool (post-graduation) state plus a recent-tx snapshot, and
// upsert into pump_agent_stats. Read endpoints (solana-card, passport) join
// against this table instead of hitting RPC on every page load.
//
// Auth: `Bearer $CRON_SECRET` or Vercel cron header.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { getConnection, getPumpSdk, getAmmPoolState, solanaPubkey } from '../_lib/pump.js';

const MAX_PER_RUN = 100;

// Pump.fun graduation threshold (mainnet curve). Used only as a UI hint —
// progress_pct is a coarse bar, not financial advice.
const GRADUATION_REAL_SOL = 85_000_000_000n; // ~85 SOL in lamports

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = req.headers.authorization || '';
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron) {
		if (!env.CRON_SECRET) return error(res, 503, 'not_configured', 'CRON_SECRET unset');
		if (auth !== `Bearer ${env.CRON_SECRET}`)
			return error(res, 401, 'unauthorized', 'cron auth required');
	}

	const mints = await sql`
		select id, mint, network from pump_agent_mints
		order by id limit ${MAX_PER_RUN}
	`;

	const report = { scanned: mints.length, updated: 0, errors: 0, graduations: 0 };
	for (const m of mints) {
		try {
			const stats = await snapshotMint(m);

			// Detect graduation flip false→true vs prior snapshot.
			const [prior] = await sql`
				select graduated from pump_agent_stats where mint_id=${m.id} limit 1
			`;
			const justGraduated = stats.graduated && prior && !prior.graduated;

			await sql`
				insert into pump_agent_stats
					(mint_id, network, mint, graduated, bonding_curve, amm,
					 last_signature, last_signature_at, recent_tx_count, refreshed_at, error)
				values (
					${m.id}, ${m.network}, ${m.mint}, ${stats.graduated},
					${stats.bonding_curve ? JSON.stringify(stats.bonding_curve) : null}::jsonb,
					${stats.amm ? JSON.stringify(stats.amm) : null}::jsonb,
					${stats.last_signature}, ${stats.last_signature_at},
					${stats.recent_tx_count}, now(), null
				)
				on conflict (mint_id) do update set
					graduated         = excluded.graduated,
					bonding_curve     = excluded.bonding_curve,
					amm               = excluded.amm,
					last_signature    = excluded.last_signature,
					last_signature_at = excluded.last_signature_at,
					recent_tx_count   = excluded.recent_tx_count,
					refreshed_at      = now(),
					error             = null
			`;

			// Price-point time series.
			const price = derivePrice(stats);
			if (price) {
				await sql`
					insert into pump_agent_price_points (mint_id, sol_per_token, market_cap_lamports, source)
					values (${m.id}, ${price.sol_per_token}, ${price.market_cap_lamports?.toString() ?? null}, ${price.source})
				`;
			}

			// Emit a self-sourced graduation signal (no upstream bot needed).
			if (justGraduated) {
				report.graduations++;
				try {
					await sql`
						insert into pumpfun_signals (wallet, agent_asset, kind, weight, payload, tx_signature)
						values (
							null, ${m.mint}, 'graduation', 0.3,
							${JSON.stringify({ source: 'pump-agent-stats', network: m.network })}::jsonb,
							${`graduated:${m.mint}:${Date.now()}`}
						)
						on conflict (tx_signature) do nothing
					`;
				} catch {
					// pumpfun_signals table optional
				}
			}

			report.updated++;
		} catch (e) {
			report.errors++;
			await sql`
				insert into pump_agent_stats (mint_id, network, mint, error, refreshed_at)
				values (${m.id}, ${m.network}, ${m.mint}, ${e.message || 'snapshot failed'}, now())
				on conflict (mint_id) do update set error = excluded.error, refreshed_at = now()
			`;
		}
	}

	return json(res, 200, report);
});

async function snapshotMint({ network, mint }) {
	const mintPk = solanaPubkey(mint);
	if (!mintPk) throw new Error('invalid mint pubkey');

	const out = {
		graduated: false,
		bonding_curve: null,
		amm: null,
		last_signature: null,
		last_signature_at: null,
		recent_tx_count: 0,
	};

	// Bonding curve
	let curve = null;
	try {
		const { sdk } = await getPumpSdk({ network });
		if (sdk.fetchBuyState) {
			const state = await sdk.fetchBuyState(mintPk, mintPk);
			curve = state.bondingCurve;
		} else if (sdk.fetchBondingCurve) {
			curve = await sdk.fetchBondingCurve(mintPk);
		}
	} catch {
		curve = null;
	}

	if (curve && !curve.complete) {
		const realSol = BigInt(curve.realSolReserves?.toString?.() ?? '0');
		const pct =
			GRADUATION_REAL_SOL > 0n
				? Number((realSol * 10000n) / GRADUATION_REAL_SOL) / 100
				: null;
		out.bonding_curve = {
			real_sol: realSol.toString(),
			real_token: curve.realTokenReserves?.toString?.() ?? null,
			virtual_sol: curve.virtualSolReserves?.toString?.() ?? null,
			virtual_token: curve.virtualTokenReserves?.toString?.() ?? null,
			complete: curve.complete ?? false,
			progress_pct: pct != null ? Math.min(100, Math.max(0, pct)) : null,
		};
	} else {
		// Try AMM pool
		try {
			const amm = await getAmmPoolState({ network, mint: mintPk });
			out.graduated = true;
			out.amm = {
				pool: amm.poolKey.toString(),
				base_reserve: amm.baseReserve.toString(),
				quote_reserve: amm.quoteReserve.toString(),
				lp_supply: amm.pool.lpSupply?.toString?.() ?? null,
			};
		} catch (e) {
			if (e.code !== 'pool_not_found') throw e;
			// graduated state inferred from curve.complete only
			if (curve?.complete) out.graduated = true;
		}
	}

	// Recent activity snapshot via RPC
	try {
		const conn = getConnection({ network });
		const sigs = await conn.getSignaturesForAddress(mintPk, { limit: 50 });
		out.recent_tx_count = sigs.length;
		if (sigs.length > 0) {
			out.last_signature = sigs[0].signature;
			if (sigs[0].blockTime) {
				out.last_signature_at = new Date(sigs[0].blockTime * 1000).toISOString();
			}
		}
	} catch {
		// RPC hiccup — leave activity fields null
	}

	return out;
}

// Compute coarse sol-per-token + market_cap_lamports from a stats snapshot.
// Bonding curve: virtual_sol / virtual_token (the AMM-style invariant pump uses).
// AMM: quote_reserve / base_reserve.
function derivePrice(stats) {
	if (stats.bonding_curve) {
		const vSol = Number(stats.bonding_curve.virtual_sol || 0);
		const vTok = Number(stats.bonding_curve.virtual_token || 0);
		if (vSol > 0 && vTok > 0) {
			const sol_per_token = vSol / vTok;
			// total supply ≈ virtual_token + real_token (heuristic, sufficient for charting)
			const totalTok =
				BigInt(stats.bonding_curve.virtual_token || 0) +
				BigInt(stats.bonding_curve.real_token || 0);
			const market_cap_lamports =
				totalTok > 0n ? BigInt(Math.floor(sol_per_token * Number(totalTok))) : null;
			return { sol_per_token, market_cap_lamports, source: 'bonding_curve' };
		}
	}
	if (stats.amm) {
		const q = Number(stats.amm.quote_reserve || 0);
		const b = Number(stats.amm.base_reserve || 0);
		if (q > 0 && b > 0) {
			return { sol_per_token: q / b, market_cap_lamports: null, source: 'amm' };
		}
	}
	return null;
}
