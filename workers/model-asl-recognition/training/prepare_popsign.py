"""Turn a PopSign ASL video manifest into landmark TFRecords for train_islr.py.

Input manifest CSV columns: video_path, sign, signer_id. Every video is run
through MediaPipe HolisticLandmarker and reduced to the 390-column layout the
worker serves (see columns.py), so training sees exactly what the browser sends.

Splits are signer-disjoint (a signer is hashed into train/val/test, never split
across them), which is the only split that measures generalisation to new
people. Writes labels.json ({sign: index}, the file the worker loads) alongside
the shards.

    python prepare_popsign.py --manifest manifest.csv --out data/ --holistic-model holistic_landmarker.task
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

import numpy as np

from columns import load_columns, parse_columns, result_to_row

SPLITS = ("train", "val", "test")
SPLIT_WEIGHTS = (0.8, 0.1, 0.1)


def split_for_signer(signer_id: str, seed: str = "three.ws-popsign") -> str:
    """Stable signer-level split: the same signer always lands in the same set."""
    h = int(hashlib.sha256(f"{seed}:{signer_id}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    acc = 0.0
    for name, w in zip(SPLITS, SPLIT_WEIGHTS):
        acc += w
        if h <= acc:
            return name
    return SPLITS[-1]


def build_labels(signs: list[str]) -> dict[str, int]:
    return {s: i for i, s in enumerate(sorted(set(signs)))}


def extract_video(path: str, landmarker, parsed) -> np.ndarray:
    import cv2
    import mediapipe as mp

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    rows, i = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect_for_video(image, int(i * 1000 / fps))
        rows.append(result_to_row(result, parsed))
        i += 1
    cap.release()
    return np.stack(rows) if rows else np.zeros((0, len(parsed)), dtype=np.float32)


def main() -> None:
    import tensorflow as tf
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--holistic-model", required=True)
    ap.add_argument("--min-frames", type=int, default=8)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(args.manifest, newline="", encoding="utf-8") as f:
        entries = list(csv.DictReader(f))
    labels = build_labels([e["sign"] for e in entries])
    (out / "labels.json").write_text(json.dumps(labels, indent=1), encoding="utf-8")

    parsed = parse_columns(load_columns())
    options = vision.HolisticLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.holistic_model),
        running_mode=vision.RunningMode.VIDEO,
    )
    writers = {s: tf.io.TFRecordWriter(str(out / f"{s}.tfrecord")) for s in SPLITS}
    counts = {s: 0 for s in SPLITS}
    skipped = 0
    for e in entries:
        with vision.HolisticLandmarker.create_from_options(options) as lm:
            seq = extract_video(e["video_path"], lm, parsed)
        if len(seq) < args.min_frames:
            skipped += 1
            continue
        split = split_for_signer(e["signer_id"])
        example = tf.train.Example(features=tf.train.Features(feature={
            "frames": tf.train.Feature(float_list=tf.train.FloatList(value=seq.reshape(-1))),
            "n_frames": tf.train.Feature(int64_list=tf.train.Int64List(value=[len(seq)])),
            "label": tf.train.Feature(int64_list=tf.train.Int64List(value=[labels[e["sign"]]])),
            "signer": tf.train.Feature(bytes_list=tf.train.BytesList(value=[e["signer_id"].encode()])),
        }))
        writers[split].write(example.SerializeToString())
        counts[split] += 1
    for w in writers.values():
        w.close()
    (out / "counts.json").write_text(json.dumps({"counts": counts, "skipped_short": skipped, "classes": len(labels)}, indent=1))
    print(json.dumps({"counts": counts, "skipped_short": skipped, "classes": len(labels)}))


if __name__ == "__main__":
    main()
