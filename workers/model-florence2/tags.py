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
    the this that these those some line lines opening
    one two three four five six seven eight nine ten dozen
    """.split()
)

# Bare colours describe a part of the picture, not what it is ("red car" stays,
# "red" alone does not).
COLOUR_WORDS = frozenset(
    """
    red orange yellow green blue purple violet pink brown gold golden silver
    beige cyan magenta teal turquoise navy maroon tan cream ivory bronze copper
    indigo lavender
    """.split()
)

# Body parts Florence-2 names on nearly every character poster. Alone they say
# nothing about which model this is. A prominent part still comes through as a
# detection label ("human hand").
BODY_PARTS = frozenset(
    """
    eye eyes hair hand hands arm arms head face nose mouth ear ears leg legs foot
    feet finger fingers thumb waist shoulder shoulders neck skin nail nails chest
    body lip lips eyebrow eyebrows tooth teeth knee knees elbow wrist
    """.split()
) | frozenset(["human face", "human head", "human body", "human nose", "human eye",
               "human mouth", "human ear", "human leg", "human arm", "human hair"])

# A phrase whose head (last) word is one of these describes the picture: "violet
# color", "3d rendering", "silver top", "gray background".
GENERIC_HEADS = frozenset(
    """
    image picture photo photograph render rendering illustration drawing view
    background foreground backdrop scene shot color colour shade shape style
    design detail details object objects item thing things part parts piece
    pieces texture pattern appearance look lighting shadow reflection area space
    frame angle perspective position top bottom side front back surface
    """.split()
)

# Text burned into a poster (a generator's watermark) is never a tag.
TEXT_WORDS = frozenset("watermark logo ai text caption signature copyright".split())

# Nouns that only exist in the plural: the lemmatizer cuts them ("sunglasses"
# -> "sunglass"), so the last word is put back.
PLURAL_ONLY = {
    "sunglass": "sunglasses",
    "eyeglass": "eyeglasses",
    "glasse": "glasses",
    "goggle": "goggles",
    "trouser": "trousers",
    "jean": "jeans",
    "pant": "pants",
    "scissor": "scissors",
    "plier": "pliers",
    "binocular": "binoculars",
    "headphone": "headphones",
    "earphone": "earphones",
    "leave": "leaf",
}

_WS = re.compile(r"\s+")
_DISALLOWED = re.compile(r"[^a-z0-9 \-]")
_ARTICLES = re.compile(r"^(a|an|the|this|that|these|those|some)\s+")


def normalize_tag(raw: object) -> str:
    """One canonical tag, or "" when the input cannot be a tag.

    Lowercase, accents folded to ASCII, punctuation other than inner hyphens
    dropped, whitespace collapsed, a leading article removed, at most
    ``MAX_TAG_WORDS`` words and ``MAX_TAG_CHARS`` characters, a plural-only
    noun restored, and never a purely numeric string, a generic picture noun, a
    bare colour or body part, a phrase headed by a picture word, or watermark
    text.
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
    words[-1] = PLURAL_ONLY.get(words[-1], words[-1])
    if len(words) > 1 and words[-1] in GENERIC_HEADS:
        return ""
    if any(w in TEXT_WORDS for w in words):
        return ""
    tag = " ".join(words)
    if len(tag) > MAX_TAG_CHARS or len(tag) < 2:
        return ""
    if tag.replace(" ", "").replace("-", "").isdigit():
        return ""
    if tag in GENERIC_NOUNS or tag in COLOUR_WORDS or tag in BODY_PARTS:
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
