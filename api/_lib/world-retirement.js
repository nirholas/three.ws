// @ts-check
// Lifecycle switch for the world.three.ws (Hyperfy) surface.
//
// The owner deleted the `hyperfy-world` Cloud Run service on 2026-10-23, so every
// probe of world.three.ws 404s forever. Rather than let that read as a permanent
// outage (a red rollup that trains everyone to ignore red), the surface carries an
// explicit "retired" lifecycle state that every probe honours: no network call, no
// alert, and a neutral `retired` status in healthz and the status page.
//
// Reversible by design. The monitor code and the deploy/world/ restore kit stay.
// To bring the world back, redeploy it (`bash deploy/world/apply-hardening.sh`)
// and flip the flag off:
//   setFlag('world_retired', { enabled: false })  or  unset WORLD_RETIRED.
// An explicit app_flags row always wins over the WORLD_RETIRED env fallback.

import { isFlagEnabled } from './flags.js';

export const WORLD_RETIRED_FLAG = 'world_retired';
export const WORLD_RETIRED_ON = '2026-10-23';
export const WORLD_RETIRED_DETAIL = `Retired ${WORLD_RETIRED_ON}: the hyperfy-world service was deleted on purpose. Restore with bash deploy/world/apply-hardening.sh, then turn the world_retired flag off.`;

function envRetired() {
	return /^(1|true|yes|on)$/i.test(String(process.env.WORLD_RETIRED || '').trim());
}

/** True when the world surface is formally retired (flag row, else WORLD_RETIRED env). */
export async function isWorldRetired() {
	return isFlagEnabled(WORLD_RETIRED_FLAG, { fallback: envRetired() });
}
