"""Unit tests for tags.py (pure; runs in the image build gate and locally)."""

from tags import clean_caption, dedupe, derive_tags, normalize_tag


def test_normalize_lowercases_and_folds_accents():
    assert normalize_tag("  Café Table ") == "cafe table"


def test_normalize_strips_articles_punctuation_and_underscores():
    assert normalize_tag("The brass_lantern!") == "brass lantern"
    assert normalize_tag("a sci-fi helmet") == "sci-fi helmet"


def test_normalize_rejects_generic_numeric_long_and_non_strings():
    assert normalize_tag("background") == ""
    assert normalize_tag("Image") == ""
    assert normalize_tag("1234") == ""
    assert normalize_tag("x") == ""
    assert normalize_tag("one two three four") == ""
    assert normalize_tag("a" * 40) == ""
    assert normalize_tag(None) == ""
    assert normalize_tag(42) == ""


def test_dedupe_merges_plural_and_caps():
    assert dedupe(["Sword", "swords", "SWORD", "shield"]) == ["sword", "shield"]
    assert dedupe([f"tag{i}x" for i in range(30)], limit=5) == ["tag0x", "tag1x", "tag2x", "tag3x", "tag4x"]


def test_derive_ranks_labels_then_caption_then_detailed_frequency():
    def nouns(text):
        return [w for w in text.lower().replace(".", "").split() if w in {"lantern", "handle", "glass", "brass", "table"}]

    tags = derive_tags(
        caption="A brass lantern.",
        detailed="The lantern has a glass panel and a handle. The handle is brass. Glass glass.",
        object_labels=["lamp", "lamp", "handle", "background"],
        nouns=nouns,
    )
    assert tags == ["lamp", "handle", "brass", "lantern", "glass"]


def test_clean_caption_strips_task_tokens_and_caps():
    assert clean_caption("</s><s>A red  car.<pad>") == "A red car."
    long = "word " * 400
    out = clean_caption(long, max_chars=100)
    assert len(out) <= 101 and out.endswith(".")


if __name__ == "__main__":
    import sys

    failures = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc!r}")
    print("tags tests:", "FAILED" if failures else "OK")
    sys.exit(1 if failures else 0)
