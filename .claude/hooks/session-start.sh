#!/usr/bin/env bash
# SessionStart hook: prints the operating contract so every new session sees it.
set -euo pipefail

cat <<'EOF'
=== 3D-Agent operating contract (loaded) ===
1. Execute, never interview. No clarifying questions for execution tasks.
2. No mocks, no fake data, no TODOs, no stubs, no commented-out code, no placeholder fallback arrays.
3. Real APIs only. Implement features end-to-end, including loading/empty/error states.
4. Definition of done: code wired, dev server exercised, no console errors, tests pass.
5. Before Stop on any feature task: invoke the `completionist` subagent and clear its punch list.
6. Communication: short. State what you did, what's next. No trailing recaps, no emojis.

Hooks active: no-shortcuts (PreToolUse) | done-gate (Stop) | session-start | user-prompt-submit
Subagents available: completionist | implementer | browser-verifier
EOF
