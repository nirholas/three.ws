---
slug: sign-asl-word-level-recognition
title: Webcam ASL recognition understands 250 everyday signs, not only fingerspelling
tier: P3
score: 32
area: sign
sources: workers/model-asl-recognition/README.md#Roadmap, workers/model-asl-recognition/README.md#The model (and why it is legally clean), docs/sign-language.md
---

## Why this matters

The live `model-asl-recognition` worker only reads fingerspelling, which is how deaf signers spell names and URLs, not how they talk. Most real signing is whole-word signs, so a user signing "hello" or "thank you" to the webcam gets nothing useful. The README roadmap names the clean-provenance route: retrain the Apache-2.0 Kaggle ISLR 1st-place architecture on the PopSign ASL v1.0 corpus (CC BY 4.0, 250 signs) and serve both models behind the same endpoint. Provenance is the product constraint here: datasets that are research-only (WLASL, How2Sign, ASL Citizen derivatives) must not be used.

## Current state (measured by the reviewer on 2026-11-03)

- `workers/model-asl-recognition/` is live on Cloud Run (`model-asl-recognition`), CPU only, LiteRT TFLite, `POST /transcribe` with 390-column landmark frames, `GET /schema`, bearer auth with the shared `avatar-reconstruction-key`, tests `test_decode.py` and `test_model_smoke.py`.
- Public proxy `api/asl-recognition.js` (GET schema, POST frames), browser extraction in `src/sign-input.js`, tested by `tests/sign-input.test.js`.
- No word-level model, training script or evaluation harness exists in the repo. The README Roadmap is a three-line note.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
curl -s https://model-asl-recognition-93741856042.us-central1.run.app/health
curl -s https://three.ws/api/asl-recognition | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['columns']), d.get('max_frames'))"
ls workers/model-asl-recognition
gcloud storage ls gs://three-ws-model-weights/ 2>&1 | grep -i -E 'asl|isl|popsign'
```

## Tasks

1. Provenance memo: add `workers/model-asl-recognition/PROVENANCE.md` recording the licence text and attribution requirements for the ISLR 1st-place code (verify the licence in the upstream repository, do not assume) and PopSign ASL v1.0 (CC BY 4.0), and the attribution string the UI must show.
2. Data pipeline `workers/model-asl-recognition/train/prepare_popsign.py`: download PopSign (public release) into a GCS bucket from a Cloud Build or Vertex AI job, run MediaPipe Holistic over the clips with the identical 390-column selection `GET /schema` serves, and write sharded TFRecords. Check the extracted landmark distribution against the schema in a test (`train/test_columns.py`).
3. Training job `train/train_islr.py` plus a Vertex AI custom job spec (one GPU, about one GPU-day, GCP credits pre-approved) that trains the Squeezeformer-style encoder with a 250-way classification head, holding out signers (not clips) for validation. Log metrics to GCS. Export TFLite.
4. Evaluation harness `train/eval_islr.py`: top-1 and top-5 on signer-disjoint held-out data, plus a confusion list; write results to `workers/model-asl-recognition/eval/` and publish the numbers in the README. Set a minimum bar (state your chosen bar, based on the published ISLR leaderboard behavior) below which the model is not wired in.
5. Serving: extend `main.py` with `POST /classify` (frames to top-k signs with confidence) and `GET /schema` including `modes`; keep `/transcribe` unchanged and backward compatible. Add tests for decode and a model smoke test using the real exported model file.
6. Proxy: extend `api/asl-recognition.js` with `mode: 'fingerspell' | 'sign'` (default unchanged); write `tests/api-asl-recognition.test.js` for validation, mode routing and breaker behavior.
7. UI: on `/sign-language` and the agent chat webcam button, add a mode switch (hover/focus states, confidence warning, empty and error states); show the dataset attribution.
8. Docs: README, `docs/sign-language.md`, `docs/api-reference.md`, changelog entry and `npm run build:pages`.
9. Deploy readiness only: Cloud Build config already exists; run a build-only verify and report the single owner command to roll the new revision.

## Definition of done

- [ ] `workers/model-asl-recognition/eval/` contains a results file with signer-disjoint top-1 and top-5, and the README states the bar and whether it is met.
- [ ] `python -m pytest workers/model-asl-recognition` passes, including the real-model smoke test.
- [ ] `npx vitest run tests/api-asl-recognition.test.js tests/sign-input.test.js` passes.
- [ ] `PROVENANCE.md` exists and contains the dataset and code licence statements and attribution string, and the UI renders that string.
- [ ] If the bar is not met, the mode switch is not shipped and the README says why, with the numbers.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Training GPU quota missing in a region | Try another region or Spot L4/T4 under the same project; training is small |
| PopSign hosting URL changed | Find the current official release (Kaggle or the authors' page) and record its licence; never substitute a research-only dataset |
| Accuracy below bar | Do not wire it in; report the numbers and what would raise them (more augmentation, longer training) |
