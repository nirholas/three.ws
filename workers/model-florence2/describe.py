"""
Florence-2 describer: one image in, ``{ caption, detailed, tags, objects }`` out.

Model: Microsoft Florence-2 (MIT), loaded from the official transformers-native
conversion ``florence-community/Florence-2-large-ft`` so no remote code runs
(``trust_remote_code`` stays off). Three task prompts per image:

  <CAPTION>                short caption   -> alt-text fallback, search
  <MORE_DETAILED_CAPTION>  paragraph       -> meta description, alt text, search
  <OD>                     detection boxes -> objects[], strongest tag evidence

Runs on CUDA in bfloat16 when a GPU is present and float32 on CPU otherwise, so
the same image serves the L4 service and a CPU verification run.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import List, Optional

import torch
from PIL import Image

from tags import clean_caption, derive_tags

log = logging.getLogger("florence2.describe")

MODEL_ID = os.environ.get("FLORENCE2_MODEL", "florence-community/Florence-2-large-ft")
# The revision the image was built against; reported with every result so a
# stored description can be traced to the exact weights that produced it.
MODEL_REVISION = os.environ.get("FLORENCE2_REVISION", "26b734a54fdfbf9c398351eedfabb7f27fc470b7")
MAX_SIDE = 768
NUM_BEAMS = int(os.environ.get("FLORENCE2_BEAMS", "3"))

_lock = threading.Lock()
_state: dict = {}


def device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def load() -> None:
    """Load the processor, model and noun extractor once per process."""
    with _lock:
        if _state:
            return
        from transformers import AutoProcessor, Florence2ForConditionalGeneration
        import spacy

        dev = device()
        dtype = torch.bfloat16 if dev == "cuda" else torch.float32
        t0 = time.monotonic()
        processor = AutoProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
        model = Florence2ForConditionalGeneration.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION, dtype=dtype
        ).to(dev)
        model.eval()
        nlp = spacy.load("en_core_web_sm", disable=["ner", "parser"])
        _state.update(processor=processor, model=model, dtype=dtype, device=dev, nlp=nlp)
        log.info("loaded %s on %s in %.1fs", MODEL_ID, dev, time.monotonic() - t0)


def loaded() -> bool:
    return bool(_state)


def nouns(text: str) -> List[str]:
    """Lemmatized nouns and compound nouns (``camper van``) from a caption."""
    if not text:
        return []
    out: List[str] = []
    run: list = []

    def flush() -> None:
        # A run of adjacent nouns is one compound ("camper van"): every word
        # verbatim except the head, which is lemmatized. The head also counts
        # on its own so "van" matches a search for vans.
        if not run:
            return
        out.append(" ".join([t.text for t in run[:-1]] + [run[-1].lemma_]))
        if len(run) > 1:
            out.append(run[-1].lemma_)
        run.clear()

    for tok in _state["nlp"](text):
        if tok.pos_ in ("NOUN", "PROPN"):
            run.append(tok)
        else:
            flush()
    flush()
    return out


def _fit(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE))
    return img


def _run(task: str, img: Image.Image, max_new_tokens: int) -> object:
    processor = _state["processor"]
    model = _state["model"]
    inputs = processor(text=task, images=img, return_tensors="pt").to(_state["device"], _state["dtype"])
    with torch.inference_mode():
        ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=max_new_tokens,
            num_beams=NUM_BEAMS,
            do_sample=False,
        )
    text = processor.batch_decode(ids, skip_special_tokens=False)[0]
    parsed = processor.post_process_generation(text, task=task, image_size=img.size)
    return parsed.get(task) if isinstance(parsed, dict) else parsed


def describe(img: Image.Image) -> dict:
    """Describe one image. Thread-safe: generation is serialized per process."""
    load()
    img = _fit(img)
    t0 = time.monotonic()
    with _lock:
        caption = clean_caption(_run("<CAPTION>", img, 64), max_chars=200)
        detailed = clean_caption(_run("<MORE_DETAILED_CAPTION>", img, 256), max_chars=1000)
        od = _run("<OD>", img, 256) or {}
    labels = [str(label) for label in (od.get("labels") or []) if isinstance(label, str)]
    boxes = od.get("bboxes") or []
    w, h = img.size
    objects = []
    for label, box in zip(labels, boxes):
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            continue
        x1, y1, x2, y2 = (float(v) for v in box)
        objects.append({
            "label": clean_caption(label, max_chars=48).lower(),
            # Normalized 0..1 so the box survives any later resize of the poster.
            "box": [round(x1 / w, 4), round(y1 / h, 4), round(x2 / w, 4), round(y2 / h, 4)],
        })
    tags = derive_tags(caption=caption, detailed=detailed, object_labels=labels, nouns=nouns)
    return {
        "caption": caption,
        "detailed": detailed,
        "tags": tags,
        "objects": objects[:24],
        "model": MODEL_ID,
        "model_version": MODEL_REVISION,
        "device": _state["device"],
        "latency_ms": int((time.monotonic() - t0) * 1000),
    }


def resolved_revision() -> Optional[str]:
    """The commit sha of the weights in the local Hugging Face cache, if known."""
    try:
        from huggingface_hub import scan_cache_dir

        for repo in scan_cache_dir().repos:
            if repo.repo_id == MODEL_ID:
                for rev in repo.revisions:
                    return rev.commit_hash
    except Exception:  # noqa: BLE001 - informational only
        return None
    return None
