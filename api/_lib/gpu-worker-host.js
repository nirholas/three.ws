// Which Cloud Run host (and region) a self-hosted forge backend dispatches to.
//
// Used at job completion (api/_lib/forge-store.js records the serving host on
// the creation row) and by the NVIDIA lane probes (api/_lib/nvidia-lanes.js
// records the host next to the GPU the worker reported), so /api/nvidia/stats
// can split real job latency by GPU type. Hosts are internal and never served
// publicly; only the region derived from them is.

import { BACKENDS } from './forge-tiers.js';

export function hostOf(url) {
	try {
		return new URL(url).host || null;
	} catch {
		return null;
	}
}

// Cloud Run hostnames carry the region: the new form literally
// (name-123.us-central1.run.app), the legacy form as a two-letter code
// (name-hash-uc.a.run.app). Codes verified against the project's live service
// list on 2026-11-16.
const RUN_REGION_CODES = Object.freeze({ uc: 'us-central1', uk: 'us-east4', ew: 'europe-west1', ez: 'europe-west4' });

export function regionFromHost(host) {
	if (!host) return null;
	const modern = host.match(/^[a-z0-9-]+\.([a-z]+-[a-z]+\d+)\.run\.app$/);
	if (modern) return modern[1];
	const legacy = host.match(/-([a-z]{2})\.a\.run\.app$/);
	return legacy ? RUN_REGION_CODES[legacy[1]] || null : null;
}

// The backend's worker URL is its first required env var ending in _URL
// (BACKENDS[...].requiresEnv). Hosted and BYOK backends have no worker host.
export function backendWorkerHost(backendId, source = process.env) {
	const b = BACKENDS[backendId];
	if (!b || b.provider !== 'gcp') return null;
	const urlEnv = b.requiresEnv?.find((name) => name.endsWith('_URL'));
	return urlEnv && source[urlEnv] ? hostOf(source[urlEnv]) : null;
}
