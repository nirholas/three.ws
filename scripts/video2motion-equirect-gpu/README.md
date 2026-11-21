# video2motion equirect GPU proof

Throwaway harness that measures the `projection: "equirect"` path of
[workers/model-video2motion](../../workers/model-video2motion) on a real Cloud Run
L4 GPU job, using real 360 footage from
`gs://three-ws-capture-fixtures/insta360/derived/c3-equirect-clips/`.

```
scripts/video2motion-equirect-gpu/measure.sh build     # Cloud Build, push a proof-YYYYMMDD image
scripts/video2motion-equirect-gpu/measure.sh run       # create the job, execute, print the table
scripts/video2motion-equirect-gpu/measure.sh cleanup   # delete the job, image and repository
```

- `Dockerfile` layers `local_equirect.py` and `run.py` over the worker image.
- `cloudbuild.yaml` builds the worker image, then the proof layer.
- `run.py` is the job entrypoint. Task N processes the Nth clip in `MATRIX` and
  writes `reframe.mp4`, `video.mp4`, `clip.json`, `subject_track.json`,
  `stats.json`, `gpu.txt` and `exit.json` to
  `/results/video2motion-equirect/<RUN_ID>/<clip>/` (gcsfuse, bucket
  `three-ws-pano-captures`).
- `measure.sh` defaults to `europe-west4` (us-central1 L4 quota is taken); override
  with `REGION`, `MATRIX`, `SECONDS_PER_CLIP`.

Run `cleanup` after every measurement. Measured results live in
`prompts/finish/_context/insta360-PROGRESS.md`.
