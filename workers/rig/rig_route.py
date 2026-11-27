"""Which rigger a mesh goes to: the human one (Make-It-Animatable) or the
non-human one (workers/rig-nonhuman).

The silhouette test in mesh_classify.py (tall and left-right symmetric) is a
guess: a sword passes it, and a T-posed human fails it. The platform's rig
preflight (api/_lib/rig-preflight.js) reads what the model was made as from
the words it was made from and sends `subject` with the request, so when it is
present it decides. Without it, the silhouette decides, as before.

Kept free of numpy so the routing rule is testable anywhere:
`python3 test_rig_route.py`.
"""

from __future__ import annotations

from typing import Optional

HUMAN_ENGINE = "human"
NONHUMAN_ENGINE = "nonhuman"

# mesh_classify.HUMANOID; repeated here so this module needs no numpy.
_SILHOUETTE_HUMANOID = "humanoid"
_SUBJECTS = ("humanoid", "creature")


def normalize_subject(subject: Optional[str]) -> Optional[str]:
    """The subject when it is one the router knows, else None."""
    if not isinstance(subject, str):
        return None
    value = subject.strip().lower()
    return value if value in _SUBJECTS else None


def choose_engine(classification: str, subject: Optional[str], nonhuman_configured: bool) -> str:
    """HUMAN_ENGINE or NONHUMAN_ENGINE for one mesh.

    classification: mesh_classify.classify_mesh's answer for the mesh.
    subject: what the platform says the model is ("humanoid" | "creature"), or None.
    nonhuman_configured: whether RIG_NONHUMAN_URL is set; without it every
    mesh takes the human rigger, the behavior before the non-human worker.
    """
    if not nonhuman_configured:
        return HUMAN_ENGINE
    named = normalize_subject(subject)
    if named == "humanoid":
        return HUMAN_ENGINE
    if named == "creature":
        return NONHUMAN_ENGINE
    return HUMAN_ENGINE if classification == _SILHOUETTE_HUMANOID else NONHUMAN_ENGINE
