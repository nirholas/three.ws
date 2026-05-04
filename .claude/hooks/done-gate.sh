#!/usr/bin/env bash
# Stop hook: scans recently changed working-tree files for lazy patterns.
# Exits 2 to block Stop until the agent cleans them up.

set -euo pipefail

cd /workspaces/3D-Agent

# Only consider tracked + modified + untracked source files.
files=$(git ls-files --modified --others --exclude-standard 2>/dev/null \
  | grep -Ev '(^|/)(node_modules|dist|dist-lib|public|\.claude|memory|tests?|specs?|docs?)(/|$)' \
  | grep -Ev '\.(md|json|lock|svg|png|jpg|jpeg|gif|webp|glb|gltf|wasm|ico|woff2?|ttf|map)$' \
  || true)

if [ -z "$files" ]; then
  exit 0
fi

violations=()
while IFS= read -r f; do
  [ -f "$f" ] || continue
  while IFS= read -r line; do
    violations+=("$f: $line")
  done < <(grep -nEi \
    -e '(^|[^A-Za-z0-9_])TODO([^A-Za-z0-9_]|$)' \
    -e '(^|[^A-Za-z0-9_])FIXME([^A-Za-z0-9_]|$)' \
    -e 'not[[:space:]]*implemented' \
    -e 'throw[[:space:]]+new[[:space:]]+Error\([^)]*implement' \
    -e '(mockData|fakeData|dummyData|sampleData|placeholderData)' \
    -e 'lorem[[:space:]]*ipsum' \
    -e 'implement[[:space:]]+(this|me|later)' \
    -e 'wire[[:space:]]+(this|it|up)[[:space:]]+later' \
    "$f" 2>/dev/null || true)
done <<< "$files"

if [ ${#violations[@]} -gt 0 ]; then
  printf 'Stop blocked by done-gate hook. Lazy patterns remain in changed files:\n' >&2
  for v in "${violations[@]}"; do
    printf '  %s\n' "$v" >&2
  done
  printf '\nPer CLAUDE.md, finish the feature: implement real logic, remove TODOs/mocks, then stop.\n' >&2
  exit 2
fi

exit 0
