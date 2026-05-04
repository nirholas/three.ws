#!/usr/bin/env bash
# Statusline: shows enforcement state at a glance.
set -euo pipefail

input="$(cat)"
model=$(printf '%s' "$input" | jq -r '.model.display_name // .model.id // "claude"')
cwd=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // ""')

cd "${cwd:-/workspaces/3D-Agent}" 2>/dev/null || true

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "-")
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

marker=/workspaces/3D-Agent/.claude/state/completionist.lastrun
if [ -f "$marker" ]; then
  newest=0
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    ts=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$ts" -gt "$newest" ] && newest=$ts
  done < <(git ls-files --modified --others --exclude-standard 2>/dev/null)
  mts=$(stat -c %Y "$marker" 2>/dev/null || echo 0)
  if [ "$mts" -ge "$newest" ]; then
    audit="audit:OK"
  else
    audit="audit:STALE"
  fi
else
  audit="audit:none"
fi

build_log=/workspaces/3D-Agent/.claude/state/build.last
if [ -f "$build_log" ]; then
  bts=$(date -d "$(cat "$build_log" 2>/dev/null)" +%s 2>/dev/null || echo 0)
  if [ "$bts" -gt 0 ]; then
    build="build:OK"
  else
    build="build:?"
  fi
else
  build="build:?"
fi

printf '%s | %s%s | ship-mode | %s | %s' \
  "$model" \
  "$branch" \
  "$([ "$dirty" -gt 0 ] && printf ' *%s' "$dirty")" \
  "$audit" \
  "$build"
