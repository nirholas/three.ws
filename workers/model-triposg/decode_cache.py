"""Reuse the VAE decoder's latent self-attention across geometry queries.

Upstream's flash geometry extraction (triposg/inference_utils.py,
flash_extract_geometry) calls `vae.decode(latents, points)` once per chunk of
query points: tens of calls at the coarse dense level and hundreds more on the
near-surface octree levels. Each call enters TripoSGDecoder.forward with
`kv_cache=None`, so each one re-runs the decoder's 16 self-attention blocks
over the same 2048 latent tokens before the single cross-attention block that
actually answers the query. The result of those 16 blocks depends only on the
latents, never on the points.

This installs a small memo on the decoder: when a call arrives without a
kv_cache and its latent input equals (torch.equal, elementwise) one already
seen at the same shape, the cached block output is passed back in as kv_cache.
Equality is checked on content, not identity, so a recycled CUDA address can
never return another request's cache. The computation reused is the exact one
upstream would have repeated, on the same shape, so outputs are unchanged.
"""

from __future__ import annotations

from collections import OrderedDict

import torch

MAX_ENTRIES = 4


class DecoderKVStats:
    def __init__(self):
        self.hits = 0
        self.misses = 0

    def snapshot(self) -> dict:
        return {"hits": self.hits, "misses": self.misses}


def install_decoder_kv_cache(decoder) -> DecoderKVStats:
    original = decoder.forward
    memo: "OrderedDict[tuple, tuple[torch.Tensor, torch.Tensor]]" = OrderedDict()
    stats = DecoderKVStats()

    def forward(sample, queries, kv_cache=None):
        if kv_cache is not None or decoder.training:
            return original(sample, queries, kv_cache)
        key = (tuple(sample.shape), sample.dtype, sample.device)
        hit = memo.get(key)
        if hit is not None and torch.equal(hit[0], sample):
            memo.move_to_end(key)
            stats.hits += 1
            return original(sample, queries, hit[1])
        logits, kv = original(sample, queries, None)
        memo[key] = (sample.detach(), kv.detach())
        memo.move_to_end(key)
        while len(memo) > MAX_ENTRIES:
            memo.popitem(last=False)
        stats.misses += 1
        return logits, kv

    decoder.forward = forward
    return stats
