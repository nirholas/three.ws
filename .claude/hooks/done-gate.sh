#!/usr/bin/env bash
# Stop hook. Three checks before allowing the agent to stop:
#   1) No lazy patterns in modified/untracked source files.
#   2) `npm run build` passes (compile-level proof of correctness).
#   3) The completionist subagent has been run since the last source-file change
#      (proof the agent actually audited its work).
#
# Any failure exits 2 with a short reason so the agent retries and fixes.

set -euo pipefail

REPO=/workspaces/3D-Agent
cd "$REPO"

LOG_DIR="$REPO/.claude/state"
mkdir -p "$LOG_DIR"
MARKER="$LOG_DIR/completionist.lastrun"
LAST_BUILD="$LOG_DIR/build.last"

fail() {
  printf '\nStop blocked by done-gate. %s\n' "$1" >&2
  exit 2
}

# Determine whether there is in-flight work at all. If not, allow stop.
changed=$(git ls-files --modified --others --exclude-standard 2>/dev/null \
  | grep -Ev '(^|/)(node_modules|dist|dist-lib|public|\.claude/state)(/|$)' \
  | grep -Ev '\.(lock|log|map)$' \
  || true)

if [ -z "$changed" ]; then
  exit 0
fi

# --- 1. Lazy-pattern scan on ADDED lines only --------------------------------
# We only care about laziness the agent introduced, not pre-existing tech debt.
# Parse `git diff` for added lines (prefixed with `+`, not `+++`), and grep
# those for the lazy patterns. Untracked files are wholly added.
LAZY_RE='(^|[^A-Za-z0-9_])(TODO|FIXME|HACK)([^A-Za-z0-9_]|$)|not[[:space:]]*implemented|throw[[:space:]]+new[[:space:]]+Error\([^)]*implement|(mockData|fakeData|dummyData|sampleData|placeholderData)|lorem[[:space:]]*ipsum|implement[[:space:]]+(this|me|later)|wire[[:space:]]+(this|it|up)[[:space:]]+later|in[[:space:]]+(a[[:space:]]+)?real[[:space:]]+implementation|(^|[^A-Za-z0-9_])debugger([^A-Za-z0-9_]|$)'

violations=()

# Tracked-file additions (vs HEAD). Header-aware: track current file from +++ b/<path>.
while IFS= read -r line; do
  case "$line" in
    '+++ b/'*) cur_file=${line#+++ b/} ;;
    '+++ /dev/null') cur_file='' ;;
    '+'*)
      add=${line#+}
      case "$add" in '++') continue ;; esac
      # Skip diff headers that look like '+++'
      [ -z "$cur_file" ] && continue
      # Skip exempt paths/extensions
      case "$cur_file" in
        .claude/*|*/.claude/*) continue ;;
        memory/*|*/memory/*) continue ;;
        node_modules/*|*/node_modules/*) continue ;;
        dist/*|*/dist/*|dist-lib/*|*/dist-lib/*|public/*|*/public/*) continue ;;
        tests/*|*/tests/*|test/*|*/test/*|*.test.*|*.spec.*) continue ;;
        specs/*|*/specs/*|docs/*|*/docs/*) continue ;;
        *.md|*.json|*.lock|*.svg|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.glb|*.gltf|*.wasm|*.ico|*.woff|*.woff2|*.ttf|*.map) continue ;;
      esac
      if printf '%s' "$add" | grep -Eqi "$LAZY_RE"; then
        violations+=("$cur_file: + $add")
      fi
      ;;
  esac
done < <(git diff --no-color HEAD 2>/dev/null || true)

# Untracked files: every line is "added".
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  case "$f" in
    .claude/*|*/.claude/*) continue ;;
    memory/*|*/memory/*) continue ;;
    node_modules/*|*/node_modules/*) continue ;;
    dist/*|*/dist/*|dist-lib/*|*/dist-lib/*|public/*|*/public/*) continue ;;
    tests/*|*/tests/*|test/*|*/test/*|*.test.*|*.spec.*) continue ;;
    specs/*|*/specs/*|docs/*|*/docs/*) continue ;;
    *.md|*.json|*.lock|*.svg|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.glb|*.gltf|*.wasm|*.ico|*.woff|*.woff2|*.ttf|*.map) continue ;;
  esac
  while IFS= read -r line; do
    violations+=("$f: $line")
  done < <(grep -nEi "$LAZY_RE" "$f" 2>/dev/null || true)
done < <(git ls-files --others --exclude-standard 2>/dev/null)

if [ ${#violations[@]} -gt 0 ]; then
  {
    printf 'Lazy patterns introduced in this work:\n'
    for v in "${violations[@]}"; do printf '  %s\n' "$v"; done
    printf '\nFix these (real implementations, no stubs), then stop.\n'
  } >&2
  exit 2
fi

# --- 2. Completionist freshness ----------------------------------------------
# The completionist agent must have been invoked AFTER the most recent change to
# any tracked source file in this batch. Implementer agents drop the marker by
# touching the file as part of their wrap-up.
newest_change=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
  [ "$ts" -gt "$newest_change" ] && newest_change=$ts
done <<< "$changed"

marker_ts=0
[ -f "$MARKER" ] && marker_ts=$(stat -c %Y "$MARKER" 2>/dev/null || echo 0)

if [ "$marker_ts" -lt "$newest_change" ]; then
  fail "Completionist audit not run since last source change.
Run the \`completionist\` subagent against the current diff, fix every punch-list item, then \`touch .claude/state/completionist.lastrun\` to record completion."
fi

# --- 3. Build must pass -------------------------------------------------------
# Skip if package.json hasn't changed AND no JS/TS/CSS/HTML in changed source.
needs_build=0
if printf '%s\n' "$changed" | grep -Eq '\.(js|mjs|cjs|ts|tsx|jsx|css|html|json)$'; then
  needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
  # Clear stale dist so Vite's emptyOutDir doesn't hit ENOTEMPTY on sub-dirs
  # that were populated by other scripts (e.g. build:animations, build:rider).
  node -e "
    const fs = require('fs');
    const path = require('path');
    const dist = path.join(process.cwd(), 'dist');
    try { fs.rmSync(dist, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(dist, { recursive: true });
  " 2>/dev/null || true

  if ! out=$(timeout 240s npm run build --silent 2>&1); then
    {
      printf 'Build failed (npm run build):\n'
      printf '%s\n' "$out" | tail -40
      printf '\nFix the build, then stop.\n'
    } >&2
    printf '%s\n' "$out" > "$LAST_BUILD" || true
    exit 2
  fi
  date -u +%FT%TZ > "$LAST_BUILD"
fi

exit 0
