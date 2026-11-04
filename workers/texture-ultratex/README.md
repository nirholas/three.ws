# texture-ultratex

UltraTex multiview texturing behind the same HTTP contract as [workers/texture](../texture/), so the router can swap workers by URL. **Off by default.**

## Why it is gated

UltraTex's code and its LoRA/decoder weights (ModelScope `Yibo-Zhang/UltraTex`) are MIT. Every released LoRA targets a FLUX base model whose license forbids commercial use: FLUX.1-dev (`flux-1-dev-non-commercial-license`) and FLUX.2-Klein-base-9B (`flux-non-commercial-license`). The Apache-2.0 FLUX.2-klein-base-4B has no UltraTex LoRA. Serving paid traffic through this worker without a Black Forest Labs commercial license would be a license breach, so every route except `/health` answers `503 license_gate_closed` until `ULTRATEX_BASE_MODEL_LICENSE_ACK=commercial-license-held` is set. Findings and the unblock options are in [docs/research/forge-texture-ab.md](../../docs/research/forge-texture-ab.md).

## Contract

| Route | Behavior |
|---|---|
| `POST /texture` | Bearer auth. Body `{mesh, prompt, negative_prompt?, num_views 4-8, texture_size 512/1024/2048, material_class?}` identical to workers/texture. `202 {task_id, status}`. `503` while the gate is closed. |
| `GET /tasks/{id}` | Bearer auth. `{status: queued/running/done/failed, result_url, bytes, elapsed_ms, error}`. |
| `GET /health` | Public. `{ok, service, license_gate_open, license_gate_env, runtime_configured}`. |

`/retexture_region` is not implemented here; region edits stay on workers/texture.

## Runtime

The image pins Python 3.12, PyTorch 2.5.1, Triton 3.1.0, CUDA 12.4 (the versions the upstream kernels need). UltraTex's inference scripts are dataset-driven (G-buffer views on a 7Rx4R canvas), not mesh-in/GLB-out, so the operator stages the UltraTex checkout and base weights and points `ULTRATEX_INFER_CMD` at an argv template with `{mesh} {prompt} {negative_prompt} {num_views} {texture_size} {out_dir}`; it must write `{out_dir}/textured.glb` (`ultratex_runner.py`). The GPU run has not been performed: no GPU and no license-clean path were available.

## Routing

`textureModeFor()` in `api/_lib/forge-tiers.js` selects mode `retex_ultratex` only when `FORGE_TEXTURE_ULTRATEX=1` and `GCP_TEXTURE_ULTRATEX_URL` is set (optionally limited by `FORGE_TEXTURE_ULTRATEX_TIERS`, default `high`). Otherwise behavior is unchanged.

## Build and test

```
python3 -m unittest test_contract                      # no GPU needed
gcloud builds submit --config workers/texture-ultratex/cloudbuild.yaml .   # owner-approved deploys only
```

`worker_security.py` and `tracing.py` are vendored byte-identical (`npm run check:vendored`).
