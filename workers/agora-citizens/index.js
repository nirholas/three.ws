// agora-citizens — the life engine entrypoint.
//
// Long-lived process (NOT a Vercel cron), modeled on workers/agent-mm. It
// registers a fleet of real AgenC agents on Solana devnet, keeps a small pool of
// on-chain Fetcher work supplied, then runs each citizen's daily loop on its own
// jittered cadence — every transition a real on-chain action projected into
// agora_citizens / agora_activity and the live feed.
//
//   AGORA_DRY_RUN=1 node index.js   — print the plan, touch nothing
//   AGORA_ONCE=1   node index.js    — one tick per citizen, then exit
//   node index.js                   — run the fleet continuously
//
// Scale the fleet with AGORA_MAX_CITIZENS; pace it with AGORA_TICK_MS /
// AGORA_TICK_JITTER_MS. See README.md.

import http from 'node:http';
import { loadConfig } from './config.js';
import { makeStore } from './store.js';
import { bootFleet, tickCitizen, replenishWork, planDryRun } from './engine.js';
import { seedWorld } from './seed.js';
import { reconcileOnce } from './reconcile.js';
import { MindKeeper } from './mind.js';
import { llmComplete } from '../../api/_lib/llm.js';
import { log } from './log.js';
import { leaseKey, leaseRenewMs, leaseTtlMs, newInstanceId, takeLease } from './lease.js';

// Reconcile cadence — re-read open postings from the chain and drop any that are
// no longer open (claimed/cancelled/expired) off the board. Independent of ticks.
const MIND_MS = Math.max(60_000, Number(process.env.AGORA_MIND_INTERVAL_MS || 300_000));
const RECONCILE_MS = Math.max(30_000, Number(process.env.AGORA_RECONCILE_MS) || 60_000);

const BOOT_AT = new Date().toISOString();

// Cloud Run services must answer a startup/health probe on $PORT. This worker is
// a background daemon (its real work is the loop, not HTTP), so we bind a tiny
// liveness endpoint only when PORT is set. Locally (no PORT) nothing listens.
let _live = { citizens: 0, dispatcher: false };
function startHealthServer() {
	const port = Number(process.env.PORT);
	if (!Number.isFinite(port) || port <= 0) return;
	http
		.createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ ok: true, worker: 'agora-citizens', bootAt: BOOT_AT, ..._live }));
		})
		.listen(port, () => log.info('health server listening', { port }));
}

function jitter(cfg) {
	return cfg.tickBaseMs + Math.floor(Math.random() * (cfg.tickJitterMs + 1));
}

// citizenId → that citizen's signer-bound AgenC client, so the reconcile sweep can
// refund an expired posting's escrow to the citizen that created it. Only citizens
// this process is running can be signed for; anyone else's posting is left alone.
function signerLookup(ctx) {
	return (citizenId) => ctx.citizens.find((c) => c.id === citizenId)?.client || null;
}

async function runOnce(ctx) {
	await replenishWork(ctx, true);
	const outcomes = {};
	for (const citizen of ctx.citizens) {
		const node = await tickCitizen(ctx, citizen);
		outcomes[node] = (outcomes[node] || 0) + 1;
	}
	// Reconcile so a one-shot run also closes any posting the chain has moved on.
	try {
		await reconcileOnce({ cfg: ctx.cfg, store: ctx.store, readClient: ctx.readClient, signerFor: signerLookup(ctx) });
	} catch (err) {
		log.warn('reconcile (once) failed', { err: err?.message });
	}
	log.info('single sweep complete', { citizens: ctx.citizens.length, outcomes });
}

async function runForever(ctx) {
	const cfg = ctx.cfg;
	let draining = false;
	const timers = new Set();

	// Each citizen ticks on its own jittered timer so the fleet never stampedes
	// the RPC / faucet in lockstep.
	const schedule = (citizen) => {
		const delay = jitter(cfg);
		const timer = setTimeout(async () => {
			timers.delete(timer);
			if (draining) return;
			try {
				await tickCitizen(ctx, citizen);
			} catch (err) {
				log.error('unhandled tick error', { name: citizen.spec.displayName, err: err?.message });
			}
			if (!draining) schedule(citizen);
		}, delay);
		timers.add(timer);
	};

	// Replenish work on a steady cadence (independent of citizen ticks).
	const supplyTimer = setInterval(() => {
		if (!draining) replenishWork(ctx).catch((err) => log.warn('replenish error', { err: err?.message }));
	}, Math.max(cfg.tickBaseMs, 30_000));

	// Reconcile the board against the chain on its own cadence (Task 03): close
	// out postings that are claimed/cancelled/expired and link agent-to-agent hires.
	const reconcileTimer = setInterval(() => {
		if (!draining) {
			reconcileOnce({ cfg, store: ctx.store, readClient: ctx.readClient, signerFor: signerLookup(ctx) }).catch((err) =>
				log.warn('reconcile error', { err: err?.message }),
			);
		}
	}, RECONCILE_MS);

	// The heartbeat IS the lease renewal (lease.js). Losing the lease means another
	// engine took these signers over after we stopped renewing (a stalled process,
	// a partition): stop at once rather than double-drive them. Cloud Run restarts
	// the instance, and it waits in standby until the lease is free again.
	const lease = ctx.lease;
	const beat = async () => {
		const r = await lease.acquire({
			cluster: cfg.cluster,
			bootAt: BOOT_AT,
			citizens: ctx.citizens.length,
			dispatcher: !!ctx.dispatcher,
		});
		if (!r.held && !draining) {
			log.error('lease lost: another engine now drives these signers; stopping', { holder: r.holder, key: lease.key });
			shutdown('lease-lost', 1);
		}
	};
	const heartbeatTimer = setInterval(() => {
		if (!draining) beat().catch((err) => log.warn('lease renew error', { err: err?.message }));
	}, leaseRenewMs(cfg));

	// Slow-path mind: observe every projected activity, reflect and plan on its
	// own timer. A model outage only skips a reflection; the world loop never waits.
	let mindTimer = null;
	if (process.env.AGORA_MIND !== '0') {
		const keeper = new MindKeeper({ store: ctx.store, llm: llmComplete, log });
		for (const c of ctx.citizens) keeper.register({ id: c.id, name: c.spec.displayName, profession: c.spec.profession });
		ctx.store = keeper.wrapStore(ctx.store);
		mindTimer = setInterval(() => {
			if (!draining) keeper.tick().catch((err) => log.warn('mind error', { err: err?.message }));
		}, MIND_MS);
	}

	await replenishWork(ctx, true);
	for (const citizen of ctx.citizens) schedule(citizen);
	log.info('fleet running', { citizens: ctx.citizens.length, tickBaseMs: cfg.tickBaseMs, jitterMs: cfg.tickJitterMs });

	function shutdown(signal, code = 0) {
		if (draining) return;
		draining = true;
		log.info('shutdown', { signal });
		for (const t of timers) clearTimeout(t);
		clearInterval(supplyTimer);
		clearInterval(reconcileTimer);
		if (mindTimer) clearInterval(mindTimer);
		clearInterval(heartbeatTimer);
		// Neon HTTP + Upstash REST are stateless — nothing to close. Give an
		// in-flight tick a moment to land its projection writes.
		setTimeout(() => process.exit(code), 2_000);
	}
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err: err?.message }));
}

async function main() {
	const cfg = loadConfig();
	const store = makeStore(cfg);
	log.info('boot', {
		cluster: cfg.cluster,
		dryRun: cfg.dryRun,
		once: cfg.once,
		maxCitizens: cfg.maxCitizens,
		dispatchTasks: cfg.dispatchTasks,
		hasRedis: store.hasRedis,
	});

	if (cfg.dryRun) {
		const plan = await planDryRun(cfg, store);
		log.info('dry-run plan', plan);
		// Also print a human-readable plan to stdout for quick inspection.
		console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
		return;
	}

	// World-seed: fill the Commons with real rigged agents (no on-chain register,
	// no SOL), then exit. Decoupled from the funded loop so the world can be alive
	// immediately; on-chain registration + work happen when the fleet runs funded.
	if (cfg.seedOnly) {
		const summary = await seedWorld(cfg, store);
		console.log(JSON.stringify({ ok: true, seed: summary }, null, 2));
		setTimeout(() => process.exit(0), 500);
		return;
	}

	startHealthServer();

	// Single owner per signer set (lease.js): hold the lease before signing
	// anything. The continuous fleet waits in standby while another engine holds
	// it (a rolling deploy's old revision); a one-shot run refuses instead of
	// queueing behind a live fleet.
	const key = leaseKey(cfg);
	const instanceId = newInstanceId();
	const ttlMs = leaseTtlMs(cfg);
	const acquire = (meta = { cluster: cfg.cluster, bootAt: BOOT_AT, phase: 'boot' }) =>
		store.acquireLease(key, instanceId, ttlMs, meta);
	let stopped = false;
	const stopWaiting = () => {
		stopped = true;
	};
	process.once('SIGTERM', stopWaiting);
	process.once('SIGINT', stopWaiting);
	const held = await takeLease({ acquire, intervalMs: 15_000, wait: !cfg.once, isStopped: () => stopped, log });
	process.off('SIGTERM', stopWaiting);
	process.off('SIGINT', stopWaiting);
	if (!held) {
		log.info('stopped while in standby', { key });
		process.exit(0);
	}
	log.info('lease acquired', { key, instanceId, ttlMs });

	const ctx = await bootFleet(cfg, store);
	ctx.lease = { key, acquire };
	_live = { citizens: ctx.citizens.length, dispatcher: !!ctx.dispatcher };

	if (cfg.once) {
		// Keep the lease fresh through a long one-shot tick so a fleet in standby
		// cannot take these signers mid-run.
		const renew = setInterval(() => acquire({ cluster: cfg.cluster, bootAt: BOOT_AT, phase: 'once' }), leaseRenewMs(cfg));
		await runOnce(ctx);
		clearInterval(renew);
		setTimeout(() => process.exit(0), 1_000);
		return;
	}

	await runForever(ctx);
}

main().catch((err) => {
	log.error('fatal', { err: err?.message, stack: err?.stack });
	process.exit(1);
});
