// BYOK geometry-style provider registry — the single source of truth shared by
// the /api/forge endpoint and the 3D Studio MCP server (/api/mcp-3d).
//
// Every provider here exposes the same async surface: `imageTo3d` and/or
// `textToGeometry` returning either a poll handle ({ kind, taskId }) or a
// synchronous completion ({ taskId: null, resultGlbUrl }), plus `status` for the
// pollable ones. Keyed by the `byok` name a backend declares in forge-tiers, so
// both surfaces dispatch by registry lookup instead of a hardcoded ternary.
//
// Replicate BYOK is intentionally NOT here: it speaks the reconstruction
// `submit`/`status` interface (multi-view fusion, platform-shaped jobs), so it
// rides the image-intermediate reconstruction path with the caller's token.

import { createMeshyProvider } from './meshy.js';
import { createTripoProvider } from './tripo.js';
import { createRodinProvider } from './rodin.js';
import { createStabilityProvider } from './stability.js';
import { guardProvider } from '../_lib/forge-byok-guard.js';

// Every factory is wrapped so nothing a provider throws or returns can carry the
// caller's key: a provider may echo a rejected key in its error text, and an
// HTTP client may put the Authorization header in a network error. Both reach
// logs, the ops alert sink and API responses otherwise. Construction errors
// (a missing key) pass through unchanged.
function guarded(factory) {
	return (apiKey) => guardProvider(factory(apiKey), apiKey);
}

export const BYOK_PROVIDER_FACTORIES = Object.freeze({
	meshy: guarded(createMeshyProvider),
	tripo: guarded(createTripoProvider),
	rodin: guarded(createRodinProvider),
	stability: guarded(createStabilityProvider),
});

// True when `backendId` is a BYOK geometry-style backend dispatched through this
// registry (so callers can branch without reaching into BACKENDS internals).
export function isByokGeometryBackend(backend) {
	return Boolean(backend?.byok && BYOK_PROVIDER_FACTORIES[backend.byok]);
}
