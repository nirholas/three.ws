# Forge texture A/B: SDXL worker vs UltraTex

Status 2026-11-04: **the A/B has not been run, and no quality numbers exist.** The comparison is blocked by a license finding and by the absence of a GPU run, so this page records the finding and how to produce the numbers. Nothing here is estimated.

## License finding (the blocker)

| Component | License | Commercial use |
|---|---|---|
| UltraTex code | MIT | yes |
| UltraTex LoRA and decoder weights (ModelScope `Yibo-Zhang/UltraTex`) | MIT | yes |
| FLUX.1-dev base (target of one released LoRA) | `flux-1-dev-non-commercial-license` | no |
| FLUX.2-Klein-base-9B base (target of the other) | `flux-non-commercial-license` | no |
| FLUX.2-klein-base-4B | Apache-2.0 | yes, but no UltraTex LoRA exists for it (the 9B LoRA does not fit) |

An MIT adapter on a non-commercial base is still non-commercial in use. Adoption therefore stops at an adapter that is off by default ([workers/texture-ultratex](../../workers/texture-ultratex/README.md)).

## Unblock options (owner)

1. Obtain a Black Forest Labs commercial license for the base, then set `ULTRATEX_BASE_MODEL_LICENSE_ACK=commercial-license-held` on the worker.
2. Train an UltraTex LoRA on the Apache-2.0 FLUX.2-klein-base-4B using the pre-approved GCP credits; the 4B base then removes the license gate.

## How to produce the numbers

```
node scripts/forge-texture-ab.mjs --manifest meshes.json \
  --sdxl-url $GCP_TEXTURE_URL --ultratex-url $GCP_TEXTURE_ULTRATEX_URL --key $KEY \
  --scorer "python3 score.py {glb} {prompt} {out_dir}" --write-doc
```

Use 20 reference meshes in `meshes.json`. The scorer renders 4 views per result GLB, saves them, and prints `{clip, consistency, views}`; `--write-doc` then overwrites this page with the measured tables. Without a scorer the harness records only completion and latency and says so.

## Other constraints from the research

Triton 3.1.0, Python 3.12, CUDA 12.4, PyTorch 2.5.1. UltraTex's scripts are batch and dataset-driven, so `ULTRATEX_INFER_CMD` must wrap them for single-mesh use.
