"""
Tag derivation for Florence-2 describe results.

Florence-2 returns free text (captions) and object-detection labels. Search and
the model page want a short, stable vocabulary instead: lowercase singular
nouns such as ``lantern``, ``camper van`` or ``sword``. This module turns the
raw model output into that list. It is pure (no model, no I/O) so the build
gate and the unit tests exercise exactly the code the service runs.

Order of evidence, strongest first:
  1. object-detection labels, ranked by how many boxes carry them
  2. nouns from the short caption
  3. nouns from the detailed caption, ranked by frequency

The caption nouns come from a noun extractor passed in by the caller (spaCy in
the service, a stub in the tests), so the ranking and normalization rules here
stay testable without a language model.

The API server re-normalizes every tag it stores (api/_lib/creation-tags.js);
the two rule sets are kept in step on purpose: the worker never returns a tag
the server would reject.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Callable, Iterable, List, Sequence

MAX_TAGS = 12
MAX_TAG_CHARS = 32
MAX_TAG_WORDS = 3

# Nouns that describe the picture rather than the thing in it. A render of a
# lantern on a grey backdrop is about the lantern, never the "background".
GENERIC_NOUNS = frozenset(
    """
    image picture photo photograph render rendering illustration drawing view
    background foreground backdrop scene shot close closeup close-up top bottom
    side front back left right middle center centre corner edge surface
    color colour shade shape style design detail details object objects item
    thing things part parts piece pieces model models 3d figure figurine
    texture pattern appearance look lighting light shadow shadows reflection
    white black grey gray area space frame angle perspective position
    the this that these those some
    """.split()
)

_WS = re.compile(r"\s+")
_DISALLOWED = re.compile(r"[^a-z0-9 \-]")
_ARTICLES = re.compile(r"^(a|an|the|this|that|these|those|some)\s+")


def normalize_tag(raw: object) -> str:
    """One canonical tag, or "" when the input cannot be a tag.

    Lowercase, accents folded to ASCII, punctuation other than inner hyphens
    dropped, whitespace collapsed, a leading article removed, at most
    ``MAX_TAG_WORDS`` words and ``MAX_TAG_CHARS`` characters, and never a
    purely numeric string or a generic picture noun.
    """
    if not isinstance(raw, str):
        return ""
    text = unicodedata.normalize("NFKD", raw)
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = _DISALLOWED.sub(" ", text.replace("_", " "))
    text = _WS.sub(" ", text).strip(" -")
    text = _ARTICLES.sub("", text)
    if not text:
        return ""
    words = [w.strip("-") for w in text.split(" ") if w.strip("-")]
    if not words or len(words) > MAX_TAG_WORDS:
        return ""
    tag = " ".join(words)
    if len(tag) > MAX_TAG_CHARS or len(tag) < 2:
        return ""
    if tag.replace(" ", "").replace("-", "").isdigit():
        return ""
    if tag in GENERIC_NOUNS:
        return ""
    return tag


def dedupe(tags: Iterable[str], limit: int = MAX_TAGS) -> List[str]:
    """Normalize, drop empties, keep first occurrence, cap at ``limit``.

    A plural whose singular is already present (``swords`` after ``sword``) is
    treated as the same tag, which catches the cases a lemmatizer misses on
    detection labels.
    """
    out: List[str] = []
    seen = set()
    for raw in tags:
        tag = normalize_tag(raw)
        if not tag:
            continue
        singular = tag[:-1] if tag.endswith("s") and not tag.endswith("ss") else tag
        if tag in seen or singular in seen:
            continue
        seen.add(tag)
        seen.add(singular)
        out.append(tag)
        if len(out) >= limit:
            break
    return out


def derive_tags(
    *,
    caption: str,
    detailed: str,
    object_labels: Sequence[str],
    nouns: Callable[[str], List[str]],
    limit: int = MAX_TAGS,
) -> List[str]:
    """Rank and normalize the tag list for one image."""
    label_counts = Counter(normalize_tag(label) for label in object_labels)
    label_counts.pop("", None)
    ranked_labels = [label for label, _ in sorted(label_counts.items(), key=lambda kv: (-kv[1], kv[0]))]

    caption_nouns = nouns(caption or "")
    detailed_counts = Counter(normalize_tag(n) for n in nouns(detailed or ""))
    detailed_counts.pop("", None)
    ranked_detailed = [n for n, _ in sorted(detailed_counts.items(), key=lambda kv: (-kv[1], kv[0]))]

    return dedupe([*ranked_labels, *caption_nouns, *ranked_detailed], limit=limit)


def clean_caption(text: object, max_chars: int = 1000) -> str:
    """Trim a Florence-2 caption: strip task tokens, collapse whitespace, cap length."""
    if not isinstance(text, str):
        return ""
    text = re.sub(r"</?s>|<pad>|<[A-Z_]+>", " ", text)
    text = _WS.sub(" ", text).strip()
    if len(text) > max_chars:
        cut = text[:max_chars]
        space = cut.rfind(" ")
        text = (cut[:space] if space > max_chars * 0.6 else cut).rstrip(" ,;:") + "."
    return text
