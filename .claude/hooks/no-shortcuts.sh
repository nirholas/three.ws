#!/usr/bin/env bash
# PreToolUse hook: blocks Write/Edit that introduce mocks, fakes, TODOs, stubs,
# debug noise, or hardcoded secrets/dev URLs.
# Exits 2 with stderr message to block the tool call.

set -euo pipefail

input="$(cat)"

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$tool_name" in
  Write|Edit|MultiEdit) ;;
  *) exit 0 ;;
esac

# Skip the hook script itself, CLAUDE.md, memory files, docs, tests, configs.
case "$file_path" in
  */.claude/hooks/*) exit 0 ;;
  */.claude/agents/*) exit 0 ;;
  */CLAUDE.md) exit 0 ;;
  */memory/*) exit 0 ;;
  *.md) exit 0 ;;
  */tests/*|*/test/*|*.test.*|*.spec.*) exit 0 ;;
  */node_modules/*) exit 0 ;;
  */dist/*|*/dist-lib/*) exit 0 ;;
  */vitest.config.*|*/vite.config.*) exit 0 ;;
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

check() {
  local pattern="$1" label="$2"
  if printf '%s' "$content" | grep -Eqi "$pattern"; then
    violations+=("$label")
  fi
}

# Lazy / placeholder patterns
check '(^|[^A-Za-z0-9_])TODO([^A-Za-z0-9_]|$)'                    'TODO comment'
check '(^|[^A-Za-z0-9_])FIXME([^A-Za-z0-9_]|$)'                   'FIXME comment'
check '(^|[^A-Za-z0-9_])XXX([^A-Za-z0-9_]|$)'                     'XXX comment'
check '(^|[^A-Za-z0-9_])HACK([^A-Za-z0-9_]|$)'                    'HACK comment'
check 'not[[:space:]]*implemented'                                'not-implemented stub'
check 'throw[[:space:]]+new[[:space:]]+Error\([^)]*implement'     'throw not-implemented'
check '(mockData|fakeData|dummyData|sampleData|placeholderData)'  'mock/fake/dummy/sample/placeholder data identifier'
check 'lorem[[:space:]]*ipsum'                                    'lorem ipsum'
check 'implement[[:space:]]+(this|me|later)'                      '"implement this/me/later" comment'
check 'wire[[:space:]]+(this|it|up)[[:space:]]+later'             '"wire up later" comment'
check 'in[[:space:]]+(a[[:space:]]+)?real[[:space:]]+implementation' '"in real implementation" comment'
check 'for[[:space:]]+now[[:space:]]*[,:]'                        '"for now" shortcut comment'
check 'placeholder[[:space:]]+(for|until|response|value)'         '"placeholder for/until" comment'
check 'simulat(e|ed|ing)[[:space:]]+(api|response|fetch|loading|delay|network)' 'simulated API/response/loading'

# Debug noise that should not ship
check '(^|[^A-Za-z0-9_])debugger([^A-Za-z0-9_]|$)'                'debugger statement'
check 'console\.(log|debug|info)\([^)]*("|`)(DEBUG|TODO|TEST|XXX|HERE|wtf)' 'debug console.* call'

# Hardcoded secrets / dev URLs in source
check 'sk_test_[A-Za-z0-9]+'                                      'hardcoded Stripe test key'
check 'sk_live_[A-Za-z0-9]+'                                      'hardcoded Stripe live key'
check 'AKIA[0-9A-Z]{16}'                                          'hardcoded AWS access key id'
check 'AIza[0-9A-Za-z_-]{20,}'                                    'hardcoded Google API key'
check '(http|ws)s?://localhost(:[0-9]+)?'                         'hardcoded localhost URL (use env/config)'
check '(http|ws)s?://127\.0\.0\.1(:[0-9]+)?'                      'hardcoded 127.0.0.1 URL (use env/config)'

if [ ${#violations[@]} -gt 0 ]; then
  printf 'Blocked by no-shortcuts hook (%s):\n' "$file_path" >&2
  for v in "${violations[@]}"; do
    printf '  - %s\n' "$v" >&2
  done
  printf 'Per CLAUDE.md: ship real, complete code. Implement it for real.\n' >&2
  exit 2
fi

exit 0
