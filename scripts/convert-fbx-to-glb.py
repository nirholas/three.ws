#!/usr/bin/env python3
"""
Convert FBX animation files to GLB for use by the AnimationManager.

Usage:
    python3 scripts/convert-fbx-to-glb.py /path/to/animations/*.fbx
    python3 scripts/convert-fbx-to-glb.py /tmp/mixamo-tutorial/models/*.fbx

Outputs go to public/animations/<name>.glb

Requires: pip install trimesh[easy]
"""

import sys
import os
import re

def sanitize(name):
    """Lowercase, replace non-alphanumerics with hyphens, collapse multiples."""
    name = os.path.splitext(os.path.basename(name))[0]
    name = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return name

def convert_fbx(fbx_path, out_dir):
    try:
        import trimesh
    except ImportError:
        print("ERROR: trimesh not installed. Run: pip install trimesh[easy]")
        sys.exit(1)

    name = sanitize(fbx_path)
    out_path = os.path.join(out_dir, f"{name}.glb")

    print(f"  {os.path.basename(fbx_path)} -> {out_path} ... ", end="", flush=True)
    try:
        scene = trimesh.load(fbx_path)
        scene.export(out_path, file_type="glb")
        size_kb = os.path.getsize(out_path) / 1024
        print(f"OK ({size_kb:.0f} KB)")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "animations")
    os.makedirs(out_dir, exist_ok=True)

    fbx_files = [f for f in sys.argv[1:] if f.lower().endswith('.fbx')]
    if not fbx_files:
        print("No .fbx files provided.")
        sys.exit(1)

    print(f"Converting {len(fbx_files)} FBX file(s) to GLB...\n")
    ok = 0
    for f in fbx_files:
        if convert_fbx(f, out_dir):
            ok += 1

    print(f"\nDone: {ok}/{len(fbx_files)} converted to {out_dir}")

if __name__ == "__main__":
    main()
