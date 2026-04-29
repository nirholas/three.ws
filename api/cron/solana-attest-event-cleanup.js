/**
 * Stale-claim reaper for the pumpkit -> attestation bridge.
 *
 * Drops solana_attest_event_claims rows where the leader crashed or the
 * Solana RPC timed out before a signature could be recorded. The handler
 * deletes its own claim on tx-send failure, but a process crash between
 * `INSERT claim` and `delete on throw` leaves an orphan that would block
 * future retries forever.
 *
 * Runs every 10 minutes via Vercel Cron (vercel.json). Manually triggerable
 * with `Authorization: Bearer $CRON_SECRET`.
 */

import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';

const STALE_AFTER_SECS = 60 * 60; // 1 hour

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	const result = await sql`
		delete from solana_attest_event_claims
		where signature is null
		  and claimed_at < now() - (${STALE_AFTER_SECS} || ' seconds')::interval
		returning agent_asset, network, event_id, claimed_at
	`;

	return json(res, 200, {
		deleted: result.length,
		stale_after_secs: STALE_AFTER_SECS,
		samples: result.slice(0, 10),
	});
});
