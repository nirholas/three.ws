#!/usr/bin/env python3
"""
ARG Layer 2 — Section Reference Watermarks
==========================================
Appends [§XX] to the copyright line of every source file in xspace-agent.
XX = decimal ASCII code of the character assigned to that file position.

Files are sorted alphabetically by relative path. Reading all §-codes
in alphabetical order decodes the hidden message.

Usage:
  python3 scripts/apply-watermarks.py              # Preview (dry run)
  python3 scripts/apply-watermarks.py --count       # Just show file count
  python3 scripts/apply-watermarks.py --apply       # Apply all watermarks
  python3 scripts/apply-watermarks.py --verify      # Decode existing watermarks
  python3 scripts/apply-watermarks.py --strip       # Remove all watermarks
"""

import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─── Hidden message (must be exactly len(files) characters) ──────────
MESSAGE = (
    "THE ARCHITECT BUILDS IN SILENCE WHILE THE WORLD WATCHES THE SURFACE "
    "EVERY LINE OF CODE CARRIES A WHISPER FROM ITS CREATOR "
    "TO THOSE WITH EYES TO SEE THE TRUTH HIDES IN PLAIN SIGHT "
    "WHAT APPEARS ORDINARY CONCEALS THE EXTRAORDINARY "
    "THE PATH FORWARD IS WRITTEN IN THE MARGINS OF WHAT OTHERS OVERLOOK "
    "PATIENCE REVEALS WHAT HASTE CONCEALS "
    "IN EVERY SYSTEM EXISTS A FINGERPRINT OF ITS MAKER "
    "THE CODE SPEAKS TWO LANGUAGES ONE FOR THE MACHINE ONE FOR THE SEEKER "
    "THIS IS LAYER TWO FIND THE KEY FOR LAYER THREE"
)

# ─── Config ──────────────────────────────────────────────────────────
EXCLUDE_DIRS = {'node_modules', 'dist', '.git', 'agent-voice-chat', '.turbo'}
EXTENSIONS = {'.ts', '.js', '.mjs'}
COPYRIGHT_NEEDLE = '// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)'
WATERMARK_RE = re.compile(
    r'^(// Copyright 2026 nirholas \(https://github\.com/nirholas/xspace-agent\))(\s*\[§\d+\])?(.*)$'
)


def find_files():
    """Walk the repo and return sorted list of relative paths with the copyright header."""
    files = []
    for root, dirs, filenames in os.walk(REPO_ROOT):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDE_DIRS)
        for fname in sorted(filenames):
            ext = os.path.splitext(fname)[1]
            if ext not in EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            rel = os.path.relpath(fpath, REPO_ROOT)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    for i, line in enumerate(f):
                        if i >= 5:
                            break
                        if COPYRIGHT_NEEDLE in line:
                            files.append(rel)
                            break
            except (UnicodeDecodeError, IOError):
                continue
    files.sort()
    return files


def cmd_count():
    """Print file count and list."""
    files = find_files()
    print(f"Found {len(files)} files with copyright header.\n")
    for i, f in enumerate(files):
        print(f"  {i + 1:3d}. {f}")
    print(f"\nTotal: {len(files)}")
    print(f"Message length: {len(MESSAGE)}")
    if len(MESSAGE) != len(files):
        diff = len(files) - len(MESSAGE)
        print(f"\n⚠  MISMATCH: need to {'add' if diff > 0 else 'remove'} {abs(diff)} char(s) from MESSAGE")
    else:
        print("\n✓  Message length matches file count perfectly.")


def cmd_preview():
    """Show what would change without modifying anything."""
    files = find_files()
    if len(MESSAGE) != len(files):
        print(f"ERROR: Message length ({len(MESSAGE)}) != file count ({len(files)})")
        print("Run with --count to see the full file list, then adjust MESSAGE.")
        sys.exit(1)

    for i, (rel_path, char) in enumerate(zip(files, MESSAGE)):
        code = ord(char)
        print(f"  {i + 1:3d}. {rel_path}  →  [§{code}]  ('{char}')")

    print(f"\n{len(files)} files would be modified.")
    print(f"Message: {MESSAGE[:80]}...")
    print("\nRun with --apply to make changes.")


def cmd_apply():
    """Apply watermarks to all files."""
    files = find_files()
    if len(MESSAGE) != len(files):
        print(f"ERROR: Message length ({len(MESSAGE)}) != file count ({len(files)})")
        print("Run with --count to see the full file list, then adjust MESSAGE.")
        sys.exit(1)

    modified = 0
    already_ok = 0
    errors = []

    for i, (rel_path, char) in enumerate(zip(files, MESSAGE)):
        code = ord(char)
        new_suffix = f' [§{code}]'
        fpath = os.path.join(REPO_ROOT, rel_path)

        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except (UnicodeDecodeError, IOError) as e:
            errors.append((rel_path, str(e)))
            continue

        changed = False
        for j, line in enumerate(lines):
            m = WATERMARK_RE.match(line.rstrip('\n'))
            if m:
                desired = m.group(1) + new_suffix + '\n'
                if lines[j] != desired:
                    lines[j] = desired
                    changed = True
                else:
                    already_ok += 1
                break

        if changed:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.writelines(lines)
            modified += 1

    print(f"Done.  Modified: {modified}  Already correct: {already_ok}  Errors: {len(errors)}")
    if errors:
        for path, err in errors:
            print(f"  ERROR: {path} — {err}")


def cmd_verify():
    """Read existing watermarks and decode the hidden message."""
    files = find_files()
    decoded = []
    missing = []

    for rel_path in files:
        fpath = os.path.join(REPO_ROOT, rel_path)
        found = False
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                for i, line in enumerate(f):
                    if i >= 5:
                        break
                    m = re.search(r'\[§(\d+)\]', line)
                    if m:
                        decoded.append(chr(int(m.group(1))))
                        found = True
                        break
        except (UnicodeDecodeError, IOError):
            pass
        if not found:
            decoded.append('?')
            missing.append(rel_path)

    message = ''.join(decoded)
    print(f"Decoded ({len(decoded)} chars):\n{message}\n")
    if missing:
        print(f"{len(missing)} files missing watermarks:")
        for p in missing:
            print(f"  - {p}")


def cmd_strip():
    """Remove all [§XX] watermarks from copyright lines."""
    files = find_files()
    stripped = 0

    for rel_path in files:
        fpath = os.path.join(REPO_ROOT, rel_path)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except (UnicodeDecodeError, IOError):
            continue

        changed = False
        for j, line in enumerate(lines):
            m = WATERMARK_RE.match(line.rstrip('\n'))
            if m and m.group(2):  # has watermark
                lines[j] = m.group(1) + '\n'
                changed = True
                break

        if changed:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.writelines(lines)
            stripped += 1

    print(f"Stripped watermarks from {stripped} files.")


if __name__ == '__main__':
    if '--count' in sys.argv:
        cmd_count()
    elif '--verify' in sys.argv:
        cmd_verify()
    elif '--apply' in sys.argv:
        cmd_apply()
    elif '--strip' in sys.argv:
        cmd_strip()
    else:
        cmd_preview()


