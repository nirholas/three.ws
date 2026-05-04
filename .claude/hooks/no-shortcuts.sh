#!/usr/bin/env bash
# PreToolUse hook: blocks Write/Edit that introduce mocks, fakes, TODOs, or stubs.
# Reads JSON event from stdin. Exits 2 with stderr message to block.

set -euo pipefail

input="$(cat)"

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$tool_name" in
  Write|Edit|MultiEdit) ;;
  *) exit 0 ;;
esac

# Skip the hook script itself, CLAUDE.md, memory files, docs, tests.
case "$file_path" in
  */.claude/hooks/*) exit 0 ;;
  */CLAUDE.md) exit 0 ;;
  */memory/*) exit 0 ;;
  *.md) exit 0 ;;
  */tests/*|*/test/*|*.test.*|*.spec.*) exit 0 ;;
  */node_modules/*) exit 0 ;;
esac

# Collect the candidate new content from any of the supported tool shapes.
content=$(printf '%s' "$input" | jq -r '
  [
    (.tool_input.content // empty),
    (.tool_input.new_string // empty),
    ((.tool_input.edits // []) | map(.new_string // "") | join("\n"))
  ] | join("\n")
')

if [ -z "$content" ]; then
  exit 0
fi

violations=()

# Lazy patterns. Word-boundary-ish matching to avoid false hits like "automock".
check() {
  local pattern="$1" label="$2"
  if printf '%s' "$content" | grep -Eqi "$pattern"; then
    violations+=("$label")
  fi
}

check '(^|[^A-Za-z0-9_])TODO([^A-Za-z0-9_]|$)'                    'TODO comment'
check '(^|[^A-Za-z0-9_])FIXME([^A-Za-z0-9_]|$)'                   'FIXME comment'
check '(^|[^A-Za-z0-9_])XXX([^A-Za-z0-9_]|$)'                     'XXX comment'
check 'not[[:space:]]*implemented'                                'not-implemented stub'
check 'throw[[:space:]]+new[[:space:]]+Error\([^)]*implement'     'throw not-implemented'
check '(mockData|fakeData|dummyData|sampleData|placeholderData)'  'mock/fake/dummy/sample/placeholder data identifier'
check 'lorem[[:space:]]*ipsum'                                    'lorem ipsum'
check 'implement[[:space:]]+(this|me|later)'                      '"implement this/me/later" comment'
check 'wire[[:space:]]+(this|it|up)[[:space:]]+later'             '"wire up later" comment'
check 'for[[:space:]]+now[[:space:]]*[,:]'                        '"for now" shortcut comment'

if [ ${#violations[@]} -gt 0 ]; then
  printf 'Blocked by no-shortcuts hook (%s):\n' "$file_path" >&2
  for v in "${violations[@]}"; do
    printf '  - %s\n' "$v" >&2
  done
  printf 'Per CLAUDE.md: no mocks, no fake data, no TODOs, no stubs. Implement it for real.\n' >&2
  exit 2
fi

exit 0
