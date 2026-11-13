// agora-citizens: single-owner lease. Two engines driving the same signers
// double-claim tasks and contradict each other on-chain, and with signers derived
// from AGORA_SIGNER_SEED a local run and the deployed service would share every
// keypair. So an engine holds a lease row in bot_heartbeat before it signs
// anything, renews it on the heartbeat, and stops if it ever loses it.
//
// The lease is scoped to the SIGNER SET, not the worker: fleets with different
// signers (another seed, or another machine's .cache/) never collide, so they
// never block each other. An engine that finds the lease held waits in standby
// instead of exiting, which is what lets a Cloud Run rolling deploy hand over:
// the new revision passes its startup probe, the old one is stopped, its lease
// ages out, and the new one takes over.

import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';

/** The lease row key for this engine's signer set. */
export function leaseKey(cfg, hostname = os.hostname()) {
	if (cfg.signerSeed) {
		const fp = createHash('sha256').update(String(cfg.signerSeed)).digest('hex').slice(0, 12);
		return `agora-citizens:seed-${fp}`;
	}
	return `agora-citizens:local-${String(hostname || 'host').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)}`;
}

/** How often the holder renews. */
export function leaseRenewMs(cfg) {
	return cfg.heartbeatMs > 0 ? cfg.heartbeatMs : 30_000;
}

/** A lease not renewed for this long is free to take (three missed renewals, at least 90s). */
export function leaseTtlMs(cfg) {
	return Math.max(90_000, 3 * leaseRenewMs(cfg));
}

export function newInstanceId() {
	return `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Take the lease, waiting in standby while another live engine holds it.
 * `acquire()` resolves { held: boolean, holder?: string, ageMs?: number }.
 * With `wait: false` a held lease throws instead (one-shot runs must not queue
 * behind a live fleet). Resolves once held; resolves null if `isStopped()` turns
 * true while waiting.
 */
export async function takeLease({ acquire, intervalMs, wait = true, isStopped = () => false, log }) {
	let announced = false;
	for (;;) {
		if (isStopped()) return null;
		const r = await acquire();
		if (r.held) {
			if (announced) log?.info('lease acquired after standby', {});
			return r;
		}
		if (!wait) {
			throw new Error(
				`another agora-citizens engine (${r.holder || 'unknown'}) holds the lease for these signers; refusing to double-drive them`,
			);
		}
		if (!announced) {
			log?.warn('standby: another engine holds the lease for these signers', { holder: r.holder, ageMs: r.ageMs });
			announced = true;
		}
		await sleep(intervalMs);
	}
}
