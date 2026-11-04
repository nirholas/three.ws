"""Train the 250-sign classifier on prepare_popsign.py shards and export TFLite.

    python train_islr.py --data data/ --out out/ --epochs 60

Writes out/sign_model.tflite and copies data/labels.json to out/sign_labels.json,
the two files the worker loads from signs-weights/. Selection is by validation
top-1; the test split is only touched by eval_islr.py.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import tensorflow as tf

import model as sign_model


def dataset(path: Path, batch: int, training: bool) -> tf.data.Dataset:
    spec = {
        "frames": tf.io.VarLenFeature(tf.float32),
        "n_frames": tf.io.FixedLenFeature([], tf.int64),
        "label": tf.io.FixedLenFeature([], tf.int64),
    }

    def parse(rec):
        ex = tf.io.parse_single_example(rec, spec)
        x = tf.reshape(tf.sparse.to_dense(ex["frames"]), [tf.cast(ex["n_frames"], tf.int32), 390])
        return sign_model.preprocess(x), ex["label"]

    ds = tf.data.TFRecordDataset(str(path)).map(parse, num_parallel_calls=tf.data.AUTOTUNE)
    if training:
        ds = ds.shuffle(2048)
    return ds.batch(batch).prefetch(tf.data.AUTOTUNE)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=64)
    args = ap.parse_args()

    data, out = Path(args.data), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    n_classes = len(json.loads((data / "labels.json").read_text()))
    model = sign_model.build(n_classes)
    model.compile(
        optimizer=tf.keras.optimizers.AdamW(1e-3, weight_decay=1e-2),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True, label_smoothing=0.1),
        metrics=["accuracy", tf.keras.metrics.SparseTopKCategoricalAccuracy(5, name="top5")],
    )
    model.fit(
        dataset(data / "train.tfrecord", args.batch, True),
        validation_data=dataset(data / "val.tfrecord", args.batch, False),
        epochs=args.epochs,
        callbacks=[
            tf.keras.callbacks.ModelCheckpoint(str(out / "best.keras"), monitor="val_accuracy", save_best_only=True),
            tf.keras.callbacks.ReduceLROnPlateau(monitor="val_accuracy", factor=0.5, patience=4),
            tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=12, restore_best_weights=True),
        ],
    )
    sign_model.export_tflite(model, str(out / "sign_model.tflite"))
    shutil.copy(data / "labels.json", out / "sign_labels.json")
    print(f"wrote {out / 'sign_model.tflite'} and {out / 'sign_labels.json'}")


if __name__ == "__main__":
    main()
