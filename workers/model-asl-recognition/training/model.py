"""Word-level sign classifier: landmark sequence -> 250 sign logits.

Input is (frames, 390) in the served column layout with NaN for missing
landmarks. The model resamples to a fixed length, zero-fills NaN, normalises
around the nose and shoulder width, then runs a Conv1D stem and a small
Transformer encoder. Everything is inside the graph so the exported TFLite takes
the raw browser frames, mirroring the fingerspelling model's contract.
"""

from __future__ import annotations

import tensorflow as tf

FRAMES = 64
N_CLASSES = 250
DIM = 192


def resample(x: tf.Tensor, frames: int = FRAMES) -> tf.Tensor:
    """(T, C) -> (frames, C) by linear interpolation along time (NaN preserved as 0 later)."""
    t = tf.shape(x)[0]
    pos = tf.linspace(0.0, tf.cast(t - 1, tf.float32), frames)
    lo = tf.cast(tf.floor(pos), tf.int32)
    hi = tf.minimum(lo + 1, t - 1)
    w = (pos - tf.cast(lo, tf.float32))[:, None]
    return tf.gather(x, lo) * (1 - w) + tf.gather(x, hi) * w


def preprocess(x: tf.Tensor) -> tf.Tensor:
    """(T, 390) raw -> (FRAMES, 390 * 2) values plus a presence mask."""
    present = tf.cast(tf.math.is_finite(x), tf.float32)
    x = tf.where(tf.math.is_finite(x), x, tf.zeros_like(x))
    x = resample(x)
    present = resample(present)
    mean = tf.reduce_sum(x, axis=0, keepdims=True) / tf.maximum(tf.reduce_sum(tf.cast(present > 0.5, tf.float32), axis=0, keepdims=True), 1.0)
    x = (x - mean) * tf.cast(present > 0.5, tf.float32)
    scale = tf.maximum(tf.math.reduce_std(x), 1e-3)
    return tf.concat([x / scale, present], axis=-1)


def build(n_classes: int = N_CLASSES) -> tf.keras.Model:
    L = tf.keras.layers
    inp = L.Input(shape=(FRAMES, 390 * 2), name="features")
    h = L.Dense(DIM)(inp)
    h = L.Conv1D(DIM, 5, padding="same", activation="gelu")(h)
    h = L.LayerNormalization()(h)
    pos = tf.keras.layers.Embedding(FRAMES, DIM)(tf.range(FRAMES))
    h = h + pos
    for _ in range(3):
        a = L.MultiHeadAttention(num_heads=4, key_dim=DIM // 4, dropout=0.1)(h, h)
        h = L.LayerNormalization()(h + a)
        f = L.Dense(DIM * 2, activation="gelu")(h)
        f = L.Dense(DIM)(f)
        h = L.LayerNormalization()(h + L.Dropout(0.1)(f))
    h = L.GlobalAveragePooling1D()(h)
    h = L.Dropout(0.3)(h)
    return tf.keras.Model(inp, L.Dense(n_classes, name="logits")(h))


class Exportable(tf.Module):
    """Raw (T, 390) frames in, logits out: the contract the worker's runner expects."""

    def __init__(self, model: tf.keras.Model):
        super().__init__()
        self.model = model

    @tf.function(input_signature=[tf.TensorSpec([None, 390], tf.float32, name="inputs")])
    def serving(self, inputs):
        return {"outputs": self.model(preprocess(inputs)[None], training=False)[0]}


def export_tflite(model: tf.keras.Model, path: str) -> None:
    mod = Exportable(model)
    conv = tf.lite.TFLiteConverter.from_concrete_functions([mod.serving.get_concrete_function()], mod)
    conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS, tf.lite.OpsSet.SELECT_TF_OPS]
    with open(path, "wb") as f:
        f.write(conv.convert())
