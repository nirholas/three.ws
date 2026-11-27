// Which Forge editing tools the worker fleet can serve on this deployment.
//
// The generation engines already carry a `configured` flag in the catalog
// (api/_lib/forge-tiers.js buildCatalog). The tools that run on a finished model
// did not: the page offered every one of them and learned the worker was absent
// only after the visitor clicked, from a 501/503 written for operators. On
// 2026-11-27 that was true of three tools in production (HoloPart, the texture
// worker and LATO.2 had no URL on the API service).
//
// `available` here is the exact gate each tool's handler applies before it
// dispatches: the GCP provider's supportsMode(mode) for the regen-provider
// tools, and usdWorkerConfig() for the OpenUSD export. It reads env presence
// only. It never sends a request to a worker, so reading it cannot wake a
// scale-to-zero GPU container.
//
// The payload is public (it rides on the CDN-cached catalog), so it carries a
// tool id, a label and a boolean. No env var name and no worker address.

import { createRegenProvider } from '../_providers/gcp.js';
import { usdWorkerConfig } from './usd-export.js';

// One entry per Forge tool that needs a worker. `mode` is the regen-provider
// mode the handler checks; `worker` is the directory under workers/ that serves
// it and `handler` the API route, both for the fleet docs
// (docs/ops/gcp-model-workers.md) rather than the payload.
export const FORGE_TOOLS = Object.freeze([
	Object.freeze({ id: 'remesh', label: 'Optimize and Game-Ready export', mode: 'remesh', worker: 'workers/remesh', handler: 'api/forge-remesh.js, api/forge-gameready.js' }),
	Object.freeze({ id: 'lato2', label: 'Artist-mesh retopology', mode: 'lato2', worker: 'workers/model-lato2', handler: 'api/forge-gameready.js' }),
	Object.freeze({ id: 'stylize', label: 'Stylize', mode: 'stylize', worker: 'workers/stylize', handler: 'api/forge-stylize.js' }),
	Object.freeze({ id: 'segment', label: 'Segment into parts', mode: 'segment', worker: 'workers/segment', handler: 'api/forge-segment.js' }),
	Object.freeze({ id: 'rembg', label: 'Background removal', mode: 'rembg', worker: 'workers/rembg', handler: 'api/forge-rembg.js' }),
	Object.freeze({ id: 'rig', label: 'Auto-rig', mode: 'rerig', worker: 'workers/rig', handler: 'api/forge.js?action=rig' }),
	Object.freeze({ id: 'text2motion', label: 'Animate from text', mode: 'text2motion', worker: 'workers/model-text2motion', handler: 'api/forge-motion.js' }),
	Object.freeze({ id: 'texture', label: 'Magic Brush region retexture', mode: 'retex_region', worker: 'workers/texture', handler: 'api/studio/retexture-region.js' }),
	Object.freeze({ id: 'holopart', label: 'Regenerate a part (HoloPart)', mode: 'holopart', worker: 'workers/model-holopart', handler: 'api/forge-holopart.js' }),
	Object.freeze({ id: 'sam3d', label: 'Photo to scene objects', mode: 'sam3d', worker: 'workers/model-sam3d-objects', handler: 'api/forge-scene-objects.js' }),
	Object.freeze({ id: 'triposplat', label: 'Gaussian splat from an image', mode: 'triposplat', worker: 'workers/model-triposplat', handler: 'api/forge-splat.js' }),
	Object.freeze({ id: 'usd_export', label: 'OpenUSD export', usd: true, worker: 'workers/usd-export', handler: 'api/forge/export-usd.js' }),
]);

function regenProviderOrNull() {
	try {
		return createRegenProvider();
	} catch {
		// No GCP_RECONSTRUCTION_KEY: every worker tool is unreachable, which is
		// exactly what the handlers answer too.
		return null;
	}
}

function usdAvailable() {
	try {
		const cfg = usdWorkerConfig();
		return Boolean(cfg?.base && cfg?.key);
	} catch {
		return false;
	}
}

// { [toolId]: { label, available } } for every tool in FORGE_TOOLS.
export function forgeToolAvailability() {
	const provider = regenProviderOrNull();
	return Object.fromEntries(
		FORGE_TOOLS.map((t) => [
			t.id,
			{
				label: t.label,
				available: t.usd ? usdAvailable() : Boolean(provider?.supportsMode(t.mode)),
			},
		]),
	);
}
