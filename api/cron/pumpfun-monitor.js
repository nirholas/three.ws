/**
 * In-house pumpfun -> attestation monitor.
 *
 * Reads the live state already maintained by `/api/cron/pump-agent-stats`
 * (graduation flag, AMM/curve snapshots, recent trades) and emits real
 * on-chain threews.* SPL Memo attestations whenever a tracked condition
 * flips. This makes the event-attested reputation tier work *without*
 * any external pumpkit/MCP bot configured.
 *
 * Runs every 3 minutes via Vercel Cron (vercel.json). Manually triggerable
 * with `Authorization: Bearer $CRON_SECRET`.
 *
 * Source taxonomy: emits with `payload.source = 'pumpfun.<event>'` so the
 * reputation reads `payload.source like 'pumpkit.%'` continue to recognise
 * pumpkit-sourced events; we extend the read query in solana-reputation.js
 * to also count `pumpfun.%`.
 */

import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { mintAttestation, deriveEventId, loadAttesterKeypair } from '../_lib/attest-event.js';

const MAX_PER_RUN = 50;
const WHALE_TRADE_USD_FLOOR = 1_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	if (!process.env.ATTEST_AGENT_SECRET_KEY) {
		// Skip cleanly when the attester key isn't provisioned — returning 503
		// every 3 min would mark the cron job as failing in the dashboard.
		return json(res, 200, { skipped: true, reason: 'attester_not_configured' });
	}

	// Pull the latest stats joined with the agent's Metaplex Core asset and
	// the prior cursor state. Only consider mints whose stats have changed
	// since the last cursor checkpoint.
	const rows = await sql`
		select
			m.id            as mint_id,
			m.mint          as token_mint,
			m.network,
			m.agent_id,
			m.agent_authority,
			s.graduated,
			s.last_signature,
			s.last_signature_at,
			a.id            as agent_row_id,
			a.user_id,
			coalesce(a.meta->'onchain'->>'sol_asset', a.meta->>'sol_mint_address') as agent_asset,
			c.last_graduated,
			c.last_authority,
			c.last_trade_signature
		from pump_agent_mints m
		join pump_agent_stats  s on s.mint_id = m.id
		join agent_identities  a on a.id = m.agent_id
		left join pumpfun_monitor_cursor c on c.mint_id = m.id
		where coalesce(a.meta->'onchain'->>'sol_asset', a.meta->>'sol_mint_address') is not null
		  and (
		     c.mint_id is null
		  or c.last_graduated      is distinct from s.graduated
		  or c.last_authority      is distinct from m.agent_authority
		  or c.last_trade_signature is distinct from s.last_signature
		  )
		order by s.refreshed_at desc nulls last
		limit ${MAX_PER_RUN}
	`;

	const attester = loadAttesterKeypair();
	const report = { scanned: rows.length, minted: 0, deduped: 0, in_progress: 0, errors: 0, events: [] };

	for (const r of rows) {
		const events = detectEvents(r);
		for (const ev of events) {
			try {
				const result = await mintAttestation({
					...ev,
					agent_asset: r.agent_asset,
					network:     r.network,
					token_mint:  r.token_mint,
					attester,
				});
				report[result.status === 'minted' ? 'minted'
					: result.status === 'deduped' ? 'deduped' : 'in_progress']++;
				report.events.push({
					mint: r.token_mint, type: ev.event_type, status: result.status,
					signature: result.signature,
				});
			} catch (e) {
				report.errors++;
				report.events.push({
					mint: r.token_mint, type: ev.event_type,
					status: 'error', error: e?.message || String(e),
				});
			}
		}

		// Always update the cursor — even when nothing was emitted — so we
		// don't re-scan unchanged rows next tick.
		await sql`
			insert into pumpfun_monitor_cursor (mint_id, last_graduated, last_authority, last_trade_signature, last_processed_at)
			values (${r.mint_id}, ${r.graduated}, ${r.agent_authority}, ${r.last_signature}, now())
			on conflict (mint_id) do update set
				last_graduated       = excluded.last_graduated,
				last_authority       = excluded.last_authority,
				last_trade_signature = excluded.last_trade_signature,
				last_processed_at    = now()
		`;
	}

	return json(res, 200, report);
});

/** Map a single (stats, cursor) row to the attestation events to emit. */
function detectEvents(r) {
	const out = [];
	const slot_or_ts = r.last_signature_at
		? new Date(r.last_signature_at).getTime()
		: Date.now();

	// Graduation flip false -> true.
	if (r.graduated === true && r.last_graduated !== true) {
		out.push({
			event_type: 'graduation',
			source:     'pumpfun.graduation',
			event_id:   deriveEventId({ event_type: 'graduation', mint: r.token_mint, slot_or_ts: 'final' }),
			task_id:    `pumpfun:${r.token_mint}:graduation`,
			detail:     { network: r.network },
		});
	}

	// CTO: agent_authority changed (creator takeover).
	if (r.agent_authority && r.last_authority && r.agent_authority !== r.last_authority) {
		out.push({
			event_type: 'cto_detected',
			source:     'pumpfun.cto',
			event_id:   deriveEventId({
				event_type: 'cto',
				mint:       r.token_mint,
				slot_or_ts: `${r.last_authority}->${r.agent_authority}`,
			}),
			task_id:    `pumpfun:${r.token_mint}:cto:${slot_or_ts}`,
			detail:     { from: r.last_authority, to: r.agent_authority, network: r.network },
		});
	}

	return out;
}

// Exported for tests.
export { detectEvents, WHALE_TRADE_USD_FLOOR };
