"""Build-time patches for the pinned UniRig checkout.

make_armature in src/inference/merge.py indexes the per-vertex influence
ranking with `range(group_per_vertex)`, and merge() hard-codes
group_per_vertex=4. UniRig can predict a skeleton with fewer than 4 joints
(small or simple meshes), so `skin` has fewer than 4 columns and the lookup
raises "IndexError: index 3 is out of bounds for axis 1 with size 3". merge.sh
backgrounds python and exits 0, so the failure surfaced only as "reported
success but wrote no output file".

A vertex can never be influenced by more joints than the skeleton has, so the
correct behaviour is to cap the influence count at the joint count. Output for
skeletons of 4 or more joints is byte-for-byte what upstream produces.

Usage (Dockerfile): python3 unirig_patches.py /app/unirig/src/inference/merge.py
The patch fails loudly when upstream moves the anchor line, so a pin bump that
invalidates it breaks the image build instead of production rigging.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_ANCHOR = re.compile(r"^(?P<indent>[ \t]*)argsorted = np\.argsort\(-skin, axis=1\)[ \t]*$", re.M)
_PATCH_LINE = "group_per_vertex = min(group_per_vertex, skin.shape[1])"


class PatchError(RuntimeError):
    """The upstream source no longer contains the line the patch anchors on."""


def patch_merge_source(source: str) -> str:
    """Return `source` with the influence count capped at the joint count."""
    if _PATCH_LINE in source:
        return source
    match = _ANCHOR.search(source)
    if match is None:
        raise PatchError("merge.py no longer contains `argsorted = np.argsort(-skin, axis=1)`; re-check the pinned UniRig commit")
    indent = match.group("indent")
    comment = f"{indent}# three.ws: a skeleton with fewer than group_per_vertex joints has fewer skin columns.\n"
    return source[: match.start()] + comment + f"{indent}{_PATCH_LINE}\n" + source[match.start():]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: unirig_patches.py <path/to/merge.py>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    path.write_text(patch_merge_source(path.read_text()))
    print(f"patched {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
