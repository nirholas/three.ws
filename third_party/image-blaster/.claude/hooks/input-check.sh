#!/bin/bash
# Injects input/ staging area contents before every prompt.
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(dirname "$0")/../.."

FILES=$(ls input/ 2>/dev/null | grep -v '^$' | tr '\n' ' ')
[ -n "$FILES" ] && echo "Staged in input/: $FILES"
exit 0
