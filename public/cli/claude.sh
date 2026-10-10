#!/bin/sh
# three.ws for Claude Code: https://three.ws/cli/claude
#
# Wires the three.ws MCP servers and the three.ws skill into Claude Code, then
# offers to launch it. Read it first, verify it, then run it:
#   curl -fsSLO https://three.ws/cli/claude.sh
#   curl -fsSLO https://three.ws/cli/claude.sh.sha256
#   curl -fsSLO https://three.ws/cli/claude.sh.sig
#   (checksum and signature steps: https://three.ws/docs/cli#verify-before-you-run)
#   sh claude.sh
#
# What it does: runs `npx three-ws --claude`, which signs you in through your
# browser (add --device over SSH), adds the servers to ~/.claude.json through the
# local proxy (no key or token is written into that file), and installs the skill
# to ~/.claude/skills/three-ws/SKILL.md. It does not use sudo, edit shell profiles
# or install anything globally. Running it again changes nothing.
#
# Usage: sh claude.sh [--launch | --no-launch] [--project] [--device] [--key]
#   --launch      start `claude "launch my agent"` when setup succeeds, without asking
#   --no-launch   never offer to launch
#   --project     write ./.mcp.json and ./.claude/skills instead of the user-level files
#   --device      sign in by approving a code in any browser (works over SSH)
#   --key         sign in with an API key from THREE_WS_API_KEY
# Environment: THREE_WS_VERSION pins a version of the CLI (default: latest).
# THREE_WS_PACKAGE replaces the whole npm spec (a private mirror, or a tarball when testing).

set -eu

MIN_NODE_MAJOR=20
MIN_NODE_MINOR=12
PROMPT_TEXT="launch my agent"

say() { printf '%s\n' "$*"; }
fail() { printf 'three-ws claude: %s\n' "$*" >&2; exit 1; }

check_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer from https://nodejs.org, then run this again."
  v="$(node -p 'process.versions.node')"
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  if [ "$major" -lt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -lt "$MIN_NODE_MINOR" ]; }; then
    fail "Node.js $v is too old; three-ws needs $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer."
  fi
  command -v npx >/dev/null 2>&1 || fail "npx was not found next to Node.js. Reinstall Node.js from https://nodejs.org."
}

check_claude() {
  command -v claude >/dev/null 2>&1 || fail "Claude Code is not installed. Install it first (https://docs.claude.com/en/docs/claude-code), then run this again."
}

ask_launch() {
  # stdin is the script itself under `curl | sh`, so ask on the terminal. No
  # terminal (CI, a pipe): never launch an interactive program by surprise.
  [ -r /dev/tty ] && [ -w /dev/tty ] || return 1
  printf 'Start Claude Code now with: claude "%s"? [y/N] ' "$PROMPT_TEXT" >/dev/tty
  read -r reply </dev/tty || return 1
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

main() {
  LAUNCH=ask
  PASS=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --launch) LAUNCH=yes ;;
      --no-launch) LAUNCH=no ;;
      --project|--device|--key) PASS="$PASS $1" ;;
      --help|-h) sed -n '2,25p' "$0" 2>/dev/null || say "See https://three.ws/docs/cli"; return 0 ;;
      *) fail "unknown option $1" ;;
    esac
    shift
  done

  check_node
  check_claude

  # shellcheck disable=SC2086
  npx --yes "${THREE_WS_PACKAGE:-three-ws@${THREE_WS_VERSION:-latest}}" --claude $PASS </dev/null || fail "setup did not finish. Run \`npx three-ws doctor\` to see what is wrong."

  say ""
  say "Claude Code is wired to three.ws. Restart it to load the tools."
  say "  Start with:  claude \"$PROMPT_TEXT\""
  say "  Check later: npx three-ws doctor"

  case "$LAUNCH" in
    yes) exec claude "$PROMPT_TEXT" ;;
    ask) if ask_launch; then exec claude "$PROMPT_TEXT"; fi ;;
  esac
}

# Nothing runs until the whole file has arrived (see install.sh).
main "$@"
