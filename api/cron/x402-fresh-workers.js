// GET/POST /api/cron/x402-fresh-workers
//
// Per-minute driver of the fresh-wallet workers lane: every tick mints a few
// brand-new Solana wallets, funds each with exactly one job's worth of USDC
// plus its own fees, has each pay a real three.ws x402 endpoint for useful
// work (a 3D prop for the /forged library, or a dataset for /data-desk), then
// empties and closes every wallet so nothing strands. Fired by the economy
// heartbeat (economy-tick.js) like every other engine.
//
// Safety, in check order:
//   • X402_AUTONOMOUS_ENABLED=false (global) or X402_FRESH_WORKERS_ENABLED=false
//     (this lane) → clean skip.
//   • assertRingSpendInvariants(): external spend off, no charity split, the
//     facilitator resolves to self. Any violation no-ops the tick (fail closed).
//   • validateRingConfig(): an ERROR finding (settlement would not route
//     in-house) blocks the tick; warnings are logged.
//   • Inside run(): the SOL funder never dips under the sponsor floor, the
//     daily USDC cap holds, every payTo is checked against the controlled set
//     before a single signature, and every wallet's state is written before
//     money moves so the next tick can finish an interrupted one.
//
// Real on-chain payments only. Every job is a real generation or a real data
// fetch; nothing is mocked.

import { randomUUID } from 'node:crypto';

import { json, method, wrapCron } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { getRedis } from '../_lib/redis.js';
import { sql } from '../_lib/db.js';
import { logger } from '../_lib/usage.js';
import { validateRingConfig } from '../_lib/x402/ring-config.js';
import { gateOnRingConfig } from '../_lib/x402/ring-tick-plan.js';
import { assertRingSpendInvariants } from '../_lib/x402/ring-allowlist.js';
import { freshWorkersConfig } from '../_lib/x402/fresh-workers/plan.js';
import { run } from '../_lib/x402/fresh-workers/run.js';
import { requireCron } from '../_lib/cron-auth.js';

const log = logger('x402-fresh-workers-cron');

const ORIGIN = () => env.APP_ORIGIN || 'https://three.ws';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	if (process.env.X402_AUTONOMOUS_ENABLED === 'false') {
		return json(res, 200, { ok: true, skipped: true, reason: 'X402_AUTONOMOUS_ENABLED=false' });
	}
	if (!freshWorkersConfig().enabled) {
		return json(res, 200, { ok: true, skipped: true, reason: 'X402_FRESH_WORKERS_ENABLED=false' });
	}

	const invariants = await assertRingSpendInvariants({ context: 'x402-fresh-workers' });
	if (!invariants.ok) {
		return json(res, 200, { ok: false, skipped: true, reason: 'ring_invariant_violation', violations: invariants.violations.map((v) => v.flag) });
	}
	const gate = gateOnRingConfig(validateRingConfig());
	if (gate.blocked) {
		log.warn('fresh_workers_config_blocked', { errors: gate.errors.map((e) => e.code || e.message) });
		return json(res, 200, { ok: false, skipped: true, reason: 'ring_config_error', errors: gate.errors });
	}
	if (gate.warnings.length) log.info('fresh_workers_config_warnings', { warnings: gate.warnings.map((w) => w.code || w.message) });

	const runId = randomUUID();
	let redis = null;
	try { redis = getRedis(); } catch { redis = null; }
	const out = await run({ sql, redis, origin: ORIGIN(), runId });
	return json(res, out.ok === false && !out.skipped ? 502 : 200, out);
});
