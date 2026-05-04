#!/usr/bin/env bash
# UserPromptSubmit hook: when the user asks for execution work, inject a
# terse reminder so the agent does not regress to interview-mode.
set -euo pipefail

input="$(cat)"
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty')

if [ -z "$prompt" ]; then
  exit 0
fi

# Trigger only on execution-shaped requests.
if printf '%s' "$prompt" | grep -Eqi '\b(build|implement|wire|ship|fix|add|create|make|finish|complete|hook up|integrate|deploy|migrate|refactor)\b'; then
  cat <<'EOF'
[contract reminder]
Execute. Do not ask clarifying questions — pick the highest-leverage path and ship.
No mocks, no fake data, no TODOs, no stubs. Real APIs only.
Before claiming done: run dev/build, verify wiring, invoke `completionist` subagent, clear punch list.
EOF
fi

exit 0
