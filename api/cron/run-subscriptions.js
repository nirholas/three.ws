/**
 * Hourly cron — process due subscription charges.
 *
 * Selects agent_subscriptions WHERE status='active' AND next_charge_at <= NOW(),
 * verifies the backing delegation is still active, calls the skill's onPeriod
 * handler (imported dynamically from public/skills/subscription/skill.js), then
 * either advances next_charge_at on success or flips status to 'paused' on failure.
 *
 * Idempotent: re-running within the same period is a no-op because next_charge_at
 * is only reached once per period. Concurrent runs are additionally guarded by an
 * atomic conditional claim that marks the row with last_charge_at = NOW() before
 * invoking onPeriod; the claim fails (0 rows) if another worker already claimed
 * this period, so onPeriod is called at most once per (subscription, period).
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

// Max time we'll wait for the skill's onPeriod (which fetches the relayer).
// Override via SUBSCRIPTION_CHARGE_TIMEOUT_MS.
const ONPERIOD_TIMEOUT_MS = parseInt(
	process.env.SUBSCRIPTION_CHARGE_TIMEOUT_MS ?? '30000',
	10,
);

// Structured log helper — single-line JSON so Vercel log drains can parse it.
function log(event, fields = {}) {
	try {
		console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
	} catch {
		// Never let logging throw.
	}
}

function logError(event, fields = {}) {
	try {
		console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
	} catch {
		// Never let logging throw.
	}
}

// Race a promise against a timeout. Rejects with a tagged error on timeout.
function withTimeout(promise, ms, label) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			const err = new Error(`${label} timed out after ${ms}ms`);
			err.code = 'timeout';
			reject(err);
		}, ms);
		Promise.resolve(promise).then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			},
		);
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	// Auth: Vercel Cron header OR explicit Bearer $CRON_SECRET.
	// If neither is configured AND no Vercel cron header is present, reject.
	const auth = req.headers['authorization'] ?? '';
	const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
	const fromVercelCron = req.headers['x-vercel-cron'] === '1';
	if (!fromVercelCron) {
		if (!expected || auth !== expected) {
			return error(res, 401, 'unauthorized', 'cron secret required');
		}
	}

	const runId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const runStart = Date.now();
	log('subscription_cron.start', { runId, fromVercelCron });

	const origin = env.APP_ORIGIN;
	const relayerToken = env.CRON_SECRET ?? '';

	const report = {
		runId,
		processed: 0,
		charged: 0,
		skipped: 0,
		paused: 0,
		claimLost: 0,
		errors: [],
	};

	// Load the skill's onPeriod handler once per invocation.
	let onPeriod;
	try {
		({ onPeriod } = await import('../../public/skills/subscription/skill.js'));
	} catch (err) {
		logError('subscription_cron.skill_load_failed', { runId, message: err.message });
		return error(res, 500, 'internal_error', 'failed to load subscription skill');
	}

	// Select all active subscriptions whose charge window has arrived.
	let rows;
	try {
		rows = await sql`
			SELECT
				s.id,
				s.user_id,
				s.agent_id,
				s.delegation_id,
				s.period_seconds,
				s.amount_per_period,
				s.next_charge_at,
				s.last_charge_at,
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
	} catch (err) {
		logError('subscription_cron.select_failed', { runId, message: err.message });
		return error(res, 500, 'internal_error', 'failed to load subscriptions');
	}

	log('subscription_cron.selected', { runId, count: rows.length });

	for (const row of rows) {
		report.processed++;
		const rowStart = Date.now();
		const ctx = { runId, subscriptionId: row.id, agentId: row.agent_id };

		try {
			// Guard: delegation must still be active.
			if (row.delegation_status !== 'active') {
				await _pause(row.id, `delegation_${row.delegation_status}`);
				report.paused++;
				report.errors.push({ id: row.id, reason: `delegation_${row.delegation_status}` });
				log('subscription_cron.paused', {
					...ctx,
					reason: `delegation_${row.delegation_status}`,
				});
				continue;
			}

			// Guard: delegation must not be expired.
			if (row.delegation_expires_at && new Date(row.delegation_expires_at) <= new Date()) {
				await _pause(row.id, 'delegation_expired');
				report.paused++;
				report.errors.push({ id: row.id, reason: 'delegation_expired' });
				log('subscription_cron.paused', { ...ctx, reason: 'delegation_expired' });
				continue;
			}

			const usdcAddress = USDC_BY_CHAIN[row.chain_id];
			if (!usdcAddress) {
				await _pause(row.id, `chain_${row.chain_id}_unsupported`);
				report.skipped++;
				report.errors.push({ id: row.id, reason: `chain_${row.chain_id}_unsupported` });
				log('subscription_cron.skipped', {
					...ctx,
					reason: `chain_${row.chain_id}_unsupported`,
				});
				continue;
			}

			// Atomic claim: mark this period as being processed by writing
			// last_charge_at = NOW(). Matches only if:
			//   - next_charge_at hasn't moved (no racing writer),
			//   - status is still active,
			//   - last_charge_at is NULL OR < next_charge_at (not already claimed for this period).
			// If 0 rows returned, another worker claimed this period — skip.
			const claim = await sql`
				UPDATE agent_subscriptions
				SET last_charge_at = NOW()
				WHERE id = ${row.id}
				  AND status = 'active'
				  AND next_charge_at = ${row.next_charge_at}
				  AND (last_charge_at IS NULL OR last_charge_at < next_charge_at)
				RETURNING id
			`;
			if (claim.length === 0) {
				report.claimLost++;
				log('subscription_cron.claim_lost', ctx);
				continue;
			}

			let result;
			try {
				result = await withTimeout(
					onPeriod({
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
					}),
					ONPERIOD_TIMEOUT_MS,
					'onPeriod',
				);
			} catch (err) {
				const reason = (err.code === 'timeout' ? 'timeout: ' : '') + (err.message ?? 'unknown');
				await _safePause(row.id, reason, ctx);
				report.paused++;
				report.errors.push({ id: row.id, reason });
				logError('subscription_cron.onperiod_threw', {
					...ctx,
					code: err.code ?? 'unknown',
					message: err.message ?? 'unknown',
					durationMs: Date.now() - rowStart,
				});
				continue;
			}

			if (result && result.ok) {
				// Advance next_charge_at by exactly one period to enforce idempotency.
				const nextChargeAt = new Date(
					Date.parse(row.next_charge_at) + row.period_seconds * 1000,
				);
				try {
					await sql`
						UPDATE agent_subscriptions
						SET next_charge_at = ${nextChargeAt.toISOString()},
						    last_error     = NULL
						WHERE id = ${row.id}
					`;
				} catch (err) {
					// Charge succeeded on-chain but we failed to advance — log loudly.
					// Do NOT pause: next run's claim guard will prevent double-charge
					// since last_charge_at >= next_charge_at for this period.
					logError('subscription_cron.advance_failed', {
						...ctx,
						message: err.message,
						txHash: result.txHash,
					});
					report.errors.push({ id: row.id, reason: 'advance_failed', message: err.message });
					continue;
				}

				// Emit usage event — non-fatal if the table schema differs.
				await sql`
					INSERT INTO usage_events (user_id, kind, tool, status)
					VALUES (${row.user_id}, 'subscription_charge', 'subscription', 'success')
				`.catch((err) =>
					logError('subscription_cron.usage_event_failed', {
						...ctx,
						message: err.message,
					}),
				);

				report.charged++;
				log('subscription_cron.charged', {
					...ctx,
					txHash: result.txHash,
					durationMs: Date.now() - rowStart,
				});
			} else {
				const code = result?.code ?? 'unknown';
				const message = result?.message ?? '';
				await _safePause(row.id, `${code}: ${message}`.slice(0, 500), ctx);
				report.paused++;
				report.errors.push({ id: row.id, code, message });
				log('subscription_cron.paused', {
					...ctx,
					code,
					message,
					durationMs: Date.now() - rowStart,
				});
			}
		} catch (err) {
			// Catch-all so one bad row can't kill the run.
			logError('subscription_cron.row_unhandled', {
				...ctx,
				message: err.message ?? 'unknown',
				stack: err.stack,
			});
			report.errors.push({ id: row.id, reason: 'unhandled', message: err.message });
			// Best-effort pause so we don't loop on the same broken row next hour.
			await _safePause(row.id, `unhandled: ${(err.message ?? 'unknown').slice(0, 480)}`, ctx);
			report.paused++;
		}
	}

	log('subscription_cron.done', {
		runId,
		durationMs: Date.now() - runStart,
		processed: report.processed,
		charged: report.charged,
		paused: report.paused,
		skipped: report.skipped,
		claimLost: report.claimLost,
		errorCount: report.errors.length,
	});

	return json(res, 200, report);
});

async function _pause(id, lastError) {
	await sql`
		UPDATE agent_subscriptions
		SET status = 'paused', last_error = ${lastError}
		WHERE id = ${id}
	`;
}

// Like _pause but swallows its own errors so a DB hiccup during pause doesn't
// propagate out of the per-row handler. Logs the failure for ops visibility.
async function _safePause(id, lastError, ctx) {
	try {
		await _pause(id, lastError);
	} catch (err) {
		logError('subscription_cron.pause_failed', {
			...ctx,
			lastError,
			message: err.message,
		});
	}
}
