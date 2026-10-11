// The four probes behind GET /api/health: database, rpc, worker, wallet.
//
// Each probe reads the live subsystem gatherer (api/_lib/ops/subsystem-health.js)
// and adds one real check of its own where the gatherer has none: the wallet
// probe encrypts and decrypts a canary through the same secret box that guards
// every custodial agent key, because a misconfigured box is the failure that
// makes signup mint wallet-less agents. The roll-up is the worst probe.

import { gatherSubsystemHealth } from './ops/subsystem-health.js';
import { encryptSecret, decryptSecret } from './secret-box.js';

const RANK = { ok: 0, unknown: 0, paused: 0, degraded: 1, down: 2 };

export function worstStatus(statuses) {
	let worst = 'ok';
	for (const s of statuses) if ((RANK[s] ?? 0) > RANK[worst]) worst = s;
	return worst;
}

function fold(name, parts) {
	const live = parts.filter(Boolean);
	if (!live.length) return { name, status: 'unknown', detail: 'no signal' };
	const status = worstStatus(live.map((p) => p.status));
	const bad = live.filter((p) => p.status === 'degraded' || p.status === 'down');
	return {
		name,
		status,
		detail: (bad.length ? bad : live).map((p) => `${p.label || p.name}: ${p.detail || p.status}`).join('; '),
		checks: live.map((p) => ({ name: p.name, status: p.status })),
	};
}

async function probeCustodyCanary() {
	const base = { name: 'secret_box', label: 'Custodial key encryption' };
	try {
		const canary = `health-${Date.now()}`;
		const back = await decryptSecret(await encryptSecret(canary));
		return back === canary ? { ...base, status: 'ok', detail: 'encrypt/decrypt round trip ok' } : { ...base, status: 'down', detail: 'decrypt returned different bytes' };
	} catch (err) {
		return { ...base, status: 'down', detail: `agent wallet keys cannot be sealed: ${err?.message || 'secret box error'}` };
	}
}

/** @returns {Promise<{ status: string, checked_at: string, probes: Record<string, object> }>} */
export async function gatherHealth() {
	const [health, canary] = await Promise.all([gatherSubsystemHealth({ probeDb: true }), probeCustodyCanary()]);
	const by = Object.fromEntries(health.subsystems.map((s) => [s.name, s]));
	const probes = {
		database: fold('database', [by.database]),
		rpc: fold('rpc', [by.rpc_lanes, by.helius]),
		worker: fold('worker', [by.sniper]),
		wallet: fold('wallet', [canary, by.three_token_rail]),
	};
	return {
		status: worstStatus(Object.values(probes).map((p) => p.status)),
		checked_at: new Date().toISOString(),
		probes,
	};
}
