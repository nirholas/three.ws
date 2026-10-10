#!/bin/sh
# three.ws CLI installer: https://three.ws/cli/install
#
# Checks your OS and Node.js, then installs or runs the three-ws CLI and prints
# what to do next. Read it first, verify it, then run it:
#   curl -fsSLO https://three.ws/cli/install.sh
#   curl -fsSLO https://three.ws/cli/install.sh.sha256
#   curl -fsSLO https://three.ws/cli/install.sh.sig
#   (checksum and signature steps: https://three.ws/docs/cli#verify-before-you-run)
#   sh install.sh
#
# What it does NOT do: use sudo, edit shell profiles, read or write credentials,
# or install Node.js for you. It is safe to run again; a second run changes nothing.
#
# Usage: sh install.sh [--global] [--no-run] [-- <three-ws arguments>]
#   --global   install the CLI with `npm install -g` instead of running it through npx
#   --no-run   only check and install, then print the next steps
#   anything after `--` is passed to three-ws, e.g. `-- --cursor`
# Environment: THREE_WS_VERSION pins a version (default: latest). THREE_WS_PACKAGE
# replaces the whole npm spec (a private mirror, or a local tarball when testing).

set -eu

MIN_NODE_MAJOR=20
MIN_NODE_MINOR=12
PACKAGE="three-ws"
SPEC="${THREE_WS_PACKAGE:-$PACKAGE@${THREE_WS_VERSION:-latest}}"

say() { printf '%s\n' "$*"; }
fail() { printf 'three-ws install: %s\n' "$*" >&2; exit 1; }

check_os() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Linux) OS=linux ;;
    Darwin) OS=macos ;;
    MINGW*|MSYS*|CYGWIN*) fail "this script needs a POSIX shell. On Windows run it in WSL, or use PowerShell: npx three-ws setup" ;;
    *) fail "unsupported OS $(uname -s). Run \`npx three-ws setup\` directly if you have Node.js $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer." ;;
  esac
}

check_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install version $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer from https://nodejs.org (or with nvm / fnm / Homebrew), then run this again."
  NODE_VERSION="$(node -p 'process.versions.node')"
  major="${NODE_VERSION%%.*}"
  rest="${NODE_VERSION#*.}"
  minor="${rest%%.*}"
  if [ "$major" -lt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -lt "$MIN_NODE_MINOR" ]; }; then
    fail "Node.js $NODE_VERSION is too old; three-ws needs $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer. Update it from https://nodejs.org and run this again."
  fi
  command -v npm >/dev/null 2>&1 || fail "npm was not found next to Node.js. Reinstall Node.js from https://nodejs.org."
}

install_global() {
  want="${THREE_WS_VERSION:-latest}"
  [ -z "${THREE_WS_PACKAGE:-}" ] || want="custom"
  have="$(npm ls -g --depth=0 --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).dependencies["three-ws"].version)}catch{console.log("")}})')"
  if [ -n "$have" ] && { [ "$want" = "latest" ] || [ "$want" = "$have" ]; }; then
    latest="$(npm view "$PACKAGE" version 2>/dev/null || echo "$have")"
    if [ "$want" != "latest" ] || [ "$latest" = "$have" ]; then
      say "three-ws $have is already installed."
      return 0
    fi
  fi
  say "Installing $SPEC globally with npm..."
  npm install -g "$SPEC" >/dev/null || fail "npm install -g failed. If it is a permissions error, use a Node version manager (nvm, fnm) or run without --global."
  say "Installed three-ws $(three-ws version 2>/dev/null || echo "$want")."
}

run_cli() {
  if [ "$GLOBAL" = 1 ] && command -v three-ws >/dev/null 2>&1; then
    three-ws "$@" </dev/null
  else
    npx --yes "$SPEC" "$@" </dev/null
  fi
}

next_steps() {
  say ""
  say "Next steps"
  say "  npx three-ws --claude      Claude Code (MCP servers and the three.ws skill)"
  say "  npx three-ws --cursor      Cursor        (also --codex, --vscode, --windsurf)"
  say "  npx three-ws setup         pick clients and servers interactively"
  say "  npx three-ws doctor        diagnose a setup that is not working"
  say "Docs: https://three.ws/docs/cli"
}

main() {
  GLOBAL=0
  RUN=1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --global) GLOBAL=1 ;;
      --no-run) RUN=0 ;;
      --help|-h) sed -n '2,23p' "$0" 2>/dev/null || say "See https://three.ws/docs/cli"; return 0 ;;
      --) shift; break ;;
      *) fail "unknown option $1 (pass three-ws arguments after --)" ;;
    esac
    shift
  done

  check_os
  check_node
  say "OS: $OS, Node.js $NODE_VERSION: ok"

  if [ "$GLOBAL" = 1 ]; then install_global; fi

  if [ "$#" -gt 0 ] && [ "$RUN" = 1 ]; then
    run_cli "$@"
    return $?
  fi
  next_steps
}

# Everything above only defines functions. Nothing runs until the whole file has
# arrived, so a download cut off halfway can never execute half a script.
main "$@"
