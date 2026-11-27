// The NVIDIA FLUX model the Forge reference-image rung is pinned to, shared by
// the rung (api/_mcp3d/text-to-image.js), its health check
// (api/_lib/ai-image-lanes.js) and its hourly production probe
// (api/_lib/nvidia-lanes.js), so a re-pin moves all three together.
//
// FLUX.2 klein 4B, not FLUX.1. Measured with the production key:
//   2026-11-26: flux.1-dev and flux.1-schnell accepted the request and never
//     answered (70s and 90s probes hung to the client timeout). klein answered
//     200 in 6.5s warm and 14s cold.
//   2026-11-27: flux.1-dev sent no response headers in 150s and no answer even
//     to an invalid body in 20s, so no container was picking up its requests.
//     The route still exists (a GET answers 405, a retired id answers 404), so
//     this is a dead function on NVIDIA's side, not a renamed model or a bad
//     request. klein answered 200 in 16.8s to 20.9s.
// The genai gateway gives no pollable 202 for FLUX: a short NVCF-POLL-SECONDS
// header turns a slow answer into `504 nvcf-status: errored`, so the call is
// sync and none is sent.
//
// klein is the 4-step distilled model: it 422s on steps > 4 and cfg_scale > 1,
// and rejects `mode` and `seed` (extra_forbidden), so neither is sent.

export const NIM_FLUX_MODEL = 'black-forest-labs/flux.2-klein-4b';
export const NIM_FLUX_URL = `https://ai.api.nvidia.com/v1/genai/${NIM_FLUX_MODEL}`;
export const NIM_FLUX_STEPS = 4;
export const NIM_FLUX_CFG_SCALE = 1;

// The rung's own cap: well past klein's cold start, so a hang hands the rest of
// the request's time to the rungs behind it.
export const NIM_FLUX_TIMEOUT_MS = 30_000;

/** The exact JSON body the endpoint accepts. */
export function nimFluxBody(prompt, width, height) {
	return { prompt, width, height, steps: NIM_FLUX_STEPS, cfg_scale: NIM_FLUX_CFG_SCALE };
}
