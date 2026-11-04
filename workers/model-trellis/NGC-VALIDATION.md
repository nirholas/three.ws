# TRELLIS image: NGC validation record

Status (2026-11-04): candidate build in progress; scan and GPU validation not yet recorded.

## Baseline (before-image)

`sha256:8ad474dafdda1abc6a021ca267e48eafae612adfd22ac5ca24bb379590dfc328`

- 31 layers, 12,295,189,514 bytes compressed.
- Trivy: 70 critical, 1437 high.

## Candidate

Two-stage `Dockerfile` (build tooling stays out of the runtime image). The gate
runs `test_scan_summary.py` and `test_tracing` at build time; the tracing copy
precedes `main.py` (the first candidate failed with `No module named 'tracing'`
until that order was fixed).

Image: `us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-trellis/server:ngc-candidate`
(Cloud Build `c4fb8f6d-5db6-471b-989b-b4b7f6d9fa2e`).

## Finish the record

```bash
# 1. vulnerability scan (summarised by scan_summary.py)
gcloud builds submit workers/model-trellis --project aerial-vehicle-466722-p5 \
  --region us-central1 --config workers/model-trellis/cloudbuild.scan.yaml \
  --substitutions _IMAGE=<image@digest> --async
# 2. GPU smoke on an A100 VM (creates and deletes its own VM)
scripts/ngc-validate-trellis.sh --image <image@digest> --accel a100
```

Paste the digest, size, layer count, scan totals and smoke result under
"Results" here, then compare against the baseline above.

## Owner steps

NGC Partner Legal Agreement, the NGC intake form, then
`scripts/ngc-stage-trellis.sh --yes-push` (pushes to NGC; not run in a build session).

## Results

Pending.
