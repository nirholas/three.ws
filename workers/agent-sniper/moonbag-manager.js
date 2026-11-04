// agent-sniper moon-bag manager.
//
// A terminal profitable exit can keep a free "moon bag" in the wallet and close
// the position row. Nothing used to look at that bag again. This sweep re-quotes
// every retained bag, keeps its high-water mark, sells the whole bag on a
// trailing stop, and writes off a dead one so it is not quoted forever.
//
// The sweep takes its store, quote and sell as dependencies so the decision
// flow is testable without RPC or a database; `defaultDeps` binds the real ones.

import { sql } from '../../api/_lib/db.js';
import { log } from './log.js';
import { getTradeCtx } from './trade-client.js';
import { quoteAmmSell } from './amm-exit.js';
import { decideMoonbagAction } from './exit-logic.js';
import { writeTick, tickRow } from './telemetry.js';

const iso = (ms) => (ms != null ? new Date(ms).toISOString() : null);

/** One pass over every open moon bag. A bag that errors never stops the others. */
export async function runMoonbagSweep(cfg, deps = defaultDeps(cfg)) {
	let bags;
	try {
		bags = await deps.store.listBags(cfg.network, cfg.moonbagBatch);
	} catch (err) {
		log.error('moonbag list failed', { err: err?.message });
		return { quoted: 0, sold: 0, writtenOff: 0 };
	}
	const out = { quoted: 0, sold: 0, writtenOff: 0 };
	for (const bag of bags) {
		try {
			const value = await deps.quote(bag);
			if (value == null) continue; // transient quote failure: try next sweep
			const now = deps.now();
			const rounded = Math.round(value);
			const decision = decideMoonbagAction({
				value: rounded,
				peak: Number(bag.moonbag_peak_value_lamports || bag.moonbag_last_value_lamports || 0),
				prevValue: bag.moonbag_last_value_lamports != null ? Number(bag.moonbag_last_value_lamports) : null,
				staleSince: bag.moonbag_stale_since ? new Date(bag.moonbag_stale_since).getTime() : null,
				entry: Number(bag.moonbag_entry_lamports || 0),
			}, now, cfg.moonbag);
			await deps.store.saveQuote(bag.id, {
				moonbag_last_value_lamports: rounded,
				moonbag_peak_value_lamports: Math.round(decision.peak),
				moonbag_stale_since: iso(decision.staleSince),
				moonbag_last_quoted_at: new Date(now),
			});
			out.quoted++;
			await deps.recordTick(tickRow({ ...bag, position_id: bag.id, base_amount: bag.moonbag_base_amount }, rounded, 'moonbag'));
			if (decision.action === 'sell') {
				log.info('moonbag trailing stop', { mint: bag.mint, value: rounded, peak: decision.peak });
				await deps.sell(bag, decision.reason);
				out.sold++;
			} else if (decision.action === 'write_off') {
				await deps.store.writeOff(bag.id, decision.reason);
				out.writtenOff++;
			}
		} catch (err) {
			log.error('moonbag tick failed', { mint: bag.mint, err: err?.message });
		}
	}
	return out;
}

function defaultDeps(cfg) {
	return {
		store: {
			async listBags(network, limit) {
				return sql`
					SELECT p.*, s.slippage_bps AS slippage_bps_live
					FROM agent_sniper_positions p
					LEFT JOIN agent_sniper_strategies s ON s.agent_id = p.agent_id AND s.network = p.network
					WHERE p.network = ${network} AND p.status = 'closed'
					  AND p.moonbag_base_amount > 0 AND p.moonbag_closed_at IS NULL
					ORDER BY p.moonbag_last_quoted_at ASC NULLS FIRST
					LIMIT ${limit}
				`;
			},
			async saveQuote(id, p) {
				await sql`
					UPDATE agent_sniper_positions SET
						moonbag_last_value_lamports = ${p.moonbag_last_value_lamports},
						moonbag_peak_value_lamports = ${p.moonbag_peak_value_lamports},
						moonbag_stale_since = ${p.moonbag_stale_since},
						moonbag_last_quoted_at = ${p.moonbag_last_quoted_at.toISOString()}
					WHERE id = ${id}
				`;
			},
			async writeOff(id, reason) {
				await sql`
					UPDATE agent_sniper_positions
					SET moonbag_closed_at = now(), moonbag_exit_reason = ${reason}
					WHERE id = ${id} AND moonbag_closed_at IS NULL
				`;
			},
		},
		async quote(bag) {
			const ctx = await getTradeCtx(cfg.network);
			const baseAmount = new ctx.BN(BigInt(bag.moonbag_base_amount).toString());
			const slippagePct = (bag.slippage_bps_live ?? bag.slippage_bps ?? 500) / 100;
			try {
				const q = await ctx.client.quoteForSell({ mint: new ctx.web3.PublicKey(bag.mint), baseAmount, slippagePct });
				return Number(q.expectedQuoteOut.toString());
			} catch (err) {
				if (err?.name !== 'CoinGraduatedError') {
					log.warn('moonbag re-quote failed', { mint: bag.mint, err: err?.message });
					return null;
				}
			}
			try {
				const { expectedQuoteOut } = await quoteAmmSell({ network: cfg.network, mint: bag.mint, baseAmount, slippagePct });
				return Number(expectedQuoteOut);
			} catch (err) {
				log.warn('moonbag amm re-quote failed', { mint: bag.mint, err: err?.message });
				return null;
			}
		},
		async sell(bag, reason) {
			const { executeMoonbagSell } = await import('./executor.js');
			return executeMoonbagSell({ cfg, bag, reason });
		},
		recordTick: (tick) => writeTick(tick),
		now: () => Date.now(),
	};
}
