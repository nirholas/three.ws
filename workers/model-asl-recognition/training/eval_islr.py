"""Evaluate an exported sign model on the held-out signer-disjoint test split.

    python eval_islr.py --data data/ --model out/sign_model.tflite --labels out/sign_labels.json

Runs the TFLite file itself (the artifact that ships), not the Keras checkpoint,
and exits non-zero when top-1 is below --bar (default 0.80, the acceptance bar
for turning the word-level mode on in the UI). Prints top-1, top-5, the 20 worst
classes and the 20 most common confusions.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import numpy as np
import tensorflow as tf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from signs import load_labels, top_k  # noqa: E402


def main() -> int:
    from ai_edge_litert.interpreter import Interpreter

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--bar", type=float, default=0.80)
    args = ap.parse_args()

    labels = load_labels(args.labels)
    runner = Interpreter(model_path=args.model).get_signature_runner()
    in_name = list(runner.get_input_details().keys())[0]
    spec = {
        "frames": tf.io.VarLenFeature(tf.float32),
        "n_frames": tf.io.FixedLenFeature([], tf.int64),
        "label": tf.io.FixedLenFeature([], tf.int64),
    }
    total = top1 = top5 = 0
    per_class = collections.defaultdict(lambda: [0, 0])
    confusions = collections.Counter()
    for rec in tf.data.TFRecordDataset(str(Path(args.data) / "test.tfrecord")):
        ex = tf.io.parse_single_example(rec, spec)
        n = int(ex["n_frames"])
        x = tf.sparse.to_dense(ex["frames"]).numpy().reshape(n, 390).astype(np.float32)
        out = runner(**{in_name: x})
        logits = np.asarray(next(iter(out.values()))).reshape(-1)
        guess = top_k(logits, labels, 5)
        truth = labels[int(ex["label"])]
        names = [g["sign"] for g in guess]
        total += 1
        per_class[truth][1] += 1
        if names[0] == truth:
            top1 += 1
            per_class[truth][0] += 1
        else:
            confusions[(truth, names[0])] += 1
        top5 += truth in names
    if not total:
        print("test split is empty", file=sys.stderr)
        return 2
    report = {
        "examples": total,
        "top1": round(top1 / total, 4),
        "top5": round(top5 / total, 4),
        "worst_classes": sorted(
            ({"sign": s, "accuracy": round(c / max(t, 1), 3), "n": t} for s, (c, t) in per_class.items()),
            key=lambda r: r["accuracy"],
        )[:20],
        "top_confusions": [{"truth": a, "predicted": b, "count": c} for (a, b), c in confusions.most_common(20)],
        "bar": args.bar,
    }
    print(json.dumps(report, indent=1))
    return 0 if report["top1"] >= args.bar else 1


if __name__ == "__main__":
    sys.exit(main())
