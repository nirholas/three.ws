/**
 * Hourly cron — process due subscription charges.
 *
 * Selects agent_subscriptions WHERE status='active' AND next_charge_at <= NOW(),
 * verifies the backing delegation is still active, calls the skill's onPeriod
 * handler (imported dynamically from public/skills/subscription/skill.js), then
 * either advances next_charge_at on success or flips status to 'paused' on failure.
 *
 * Idempotent: re-running within the same period is a no-op because next_charge_at
 * is only reached once per period.
 *
 * Scheduled via vercel.json crons — "0 * * * *" (every hour on the hour).
 */

import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';

// USDC contract addresses by chain ID.
const USDC_BY_CHAIN = {
	84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
	11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	// Auth: Vercel Cron header OR explicit Bearer $CRON_SECRET.
	const auth = req.headers['authorization'] ?? '';
	const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
	const fromVercelCron = req.headers['x-vercel-cron'] === '1';
	if (!fromVercelCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	const origin = env.APP_ORIGIN;
	const relayerToken = env.CRON_SECRET ?? '';

	const report = { processed: 0, charged: 0, skipped: 0, paused: 0, errors: [] };

	// Load the skill's onPeriod handler once per invocation.
	const { onPeriod } = await import('../../public/skills/subscription/skill.js');

	// Select all active subscriptions whose charge window has arrived.
	const rows = await sql`
		SELECT
			s.id,
			s.user_id,
			s.agent_id,
			s.delegation_id,
			s.period_seconds,
			s.amount_per_period,
			s.next_charge_at,
			d.status          AS delegation_status,
			d.expires_at      AS delegation_expires_at,
			d.chain_id,
			ai.wallet_address AS owner_address
		FROM agent_subscriptions s
		JOIN agent_delegations d  ON d.id  = s.delegation_id
		JOIN agent_identities  ai ON ai.id = s.agent_id
		WHERE s.status = 'active'
		  AND s.next_charge_at <= NOW()
	`;

	for (const row of rows) {
		report.processed++;

		// Guard: delegation must still be active.
		if (row.delegation_status !== 'active') {
			await _pause(row.id, `delegation_${row.delegation_status}`);
			report.paused++;
			report.errors.push({ id: row.id, reason: `delegation_${row.delegation_status}` });
			continue;
		}

		// Guard: delegation must not be expired.
		if (row.delegation_expires_at && new Date(row.delegation_expires_at) <= new Date()) {
			await _pause(row.id, 'delegation_expired');
			report.paused++;
			report.errors.push({ id: row.id, reason: 'delegation_expired' });
			continue;
		}

		const usdcAddress = USDC_BY_CHAIN[row.chain_id];
		if (!usdcAddress) {
			await _pause(row.id, `chain_${row.chain_id}_unsupported`);
			report.skipped++;
			report.errors.push({ id: row.id, reason: `chain_${row.chain_id}_unsupported` });
			continue;
		}

		let result;
		try {
			result = await onPeriod({
				agent: {
					agentId: row.agent_id,
					chainId: row.chain_id,
					ownerAddress: row.owner_address,
					usdcAddress,
					relayerToken,
					origin,
				},
				subscription: {
					id: row.id,
					delegationId: row.delegation_id,
					amountPerPeriod: row.amount_per_period,
				},
			});
		} catch (err) {
			await _pause(row.id, (err.message ?? 'unknown').slice(0, 500));
			report.paused++;
			report.errors.push({ id: row.id, reason: err.message ?? 'unknown' });
			continue;
		}

		if (result.ok) {
			// Advance next_charge_at by exactly one period to enforce idempotency.
			const nextChargeAt = new Date(
				Date.parse(row.next_charge_at) + row.period_seconds * 1000,
			);
			await sql`
				UPDATE agent_subscriptions
				SET last_charge_at = NOW(),
				    next_charge_at = ${nextChargeAt.toISOString()},
				    last_error     = NULL
				WHERE id = ${row.id}
			`;

			// Emit usage event — non-fatal if the table schema differs.
			await sql`
				INSERT INTO usage_events (user_id, kind, tool, status)
				VALUES (${row.user_id}, 'subscription_charge', 'subscription', 'success')
			`.catch(() => null);

			report.charged++;
		} else {
			await _pause(row.id, `${result.code ?? ''}: ${result.message ?? ''}`.slice(0, 500));
			report.paused++;
			report.errors.push({ id: row.id, code: result.code, message: result.message });
		}
	}

	return json(res, 200, report);
});

async function _pause(id, lastError) {
	await sql`
		UPDATE agent_subscriptions
		SET status = 'paused', last_error = ${lastError}
		WHERE id = ${id}
	`;
}
