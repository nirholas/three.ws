#!/usr/bin/env bash
# three-ws-agent installer: Hermes Agent with three.ws built in.
#
#   curl -fsSL https://three.ws/install/hermes.sh | bash
#
# three-ws-agent is a downstream distribution of Hermes Agent (Nous Research,
# MIT). Upstream code is unchanged; the distribution adds the three.ws plugin.
# This script clones the distribution, hands it to Hermes' own unmodified
# installer (which then updates from the distribution, so `hermes update`
# keeps tracking it), and finishes with `hermes three-ws setup`.
#
# Options (after `bash -s --`):
#   --convert        Switch an existing stock Hermes checkout to three-ws-agent.
#   --no-three-ws-setup  Install only; run `hermes three-ws setup` later.
#   Anything else is passed through to Hermes' installer (see its --help).
#
# Environment:
#   HERMES_HOME            Data directory (default ~/.hermes)
#   HERMES_INSTALL_DIR     Code directory (default $HERMES_HOME/hermes-agent)
#   THREE_WS_AGENT_REPO    Git URL of the distribution
#   THREE_WS_AGENT_BRANCH  Branch to install (default main)

set -euo pipefail

REPO="${THREE_WS_AGENT_REPO:-https://github.com/nirholas/three-ws-agent.git}"
BRANCH="${THREE_WS_AGENT_BRANCH:-main}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
INSTALL_DIR="${HERMES_INSTALL_DIR:-$HERMES_HOME/hermes-agent}"
CONVERT=false
RUN_SETUP=true
PASSTHROUGH=()

while [ $# -gt 0 ]; do
	case "$1" in
		--convert) CONVERT=true ;;
		--no-three-ws-setup) RUN_SETUP=false ;;
		--dir) INSTALL_DIR="$2"; shift ;;
		--branch) BRANCH="$2"; shift ;;
		*) PASSTHROUGH+=("$1") ;;
	esac
	shift
done

info() { printf '\033[1;37m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required. Install it with your package manager (for example: sudo apt install git, or xcode-select --install), then rerun."

normalize() { printf '%s' "$1" | sed -e 's#^git@github.com:#https://github.com/#' -e 's#\.git$##' -e 's#/$##'; }

if [ -d "$INSTALL_DIR/.git" ]; then
	origin="$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || true)"
	if [ "$(normalize "$origin")" != "$(normalize "$REPO")" ]; then
		if [ "$CONVERT" != true ]; then
			cat >&2 <<EOF
An existing Hermes install lives at $INSTALL_DIR (origin: ${origin:-none}).

Keep it and add three.ws as a plugin:
  hermes plugins install nirholas/three-ws-agent/plugins/three-ws && hermes plugins enable three-ws && hermes three-ws setup

Or switch that install to three-ws-agent (your config, memories and sessions are kept):
  curl -fsSL https://three.ws/install/hermes.sh | bash -s -- --convert
EOF
			exit 1
		fi
		info "Switching $INSTALL_DIR to three-ws-agent"
		git -C "$INSTALL_DIR" remote set-url origin "$REPO"
	fi
else
	info "Cloning three-ws-agent into $INSTALL_DIR"
	mkdir -p "$(dirname "$INSTALL_DIR")"
	git clone --depth 1 --single-branch --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
fi

info "Running the Hermes Agent installer from the distribution"
HERMES_HOME="$HERMES_HOME" bash "$INSTALL_DIR/scripts/install.sh" --dir "$INSTALL_DIR" --branch "$BRANCH" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}

HERMES_BIN="$INSTALL_DIR/venv/bin/hermes"
[ -x "$HERMES_BIN" ] || HERMES_BIN="$(command -v hermes || true)"
[ -n "$HERMES_BIN" ] || die "Hermes installed but its binary was not found. Open a new terminal and run: hermes plugins enable three-ws && hermes three-ws setup"

info "Enabling the three.ws plugin"
HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" plugins enable three-ws

if [ "$RUN_SETUP" = true ]; then
	info "Connecting three.ws"
	if (: </dev/tty) 2>/dev/null; then
		HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" three-ws setup </dev/tty
	else
		HERMES_HOME="$HERMES_HOME" "$HERMES_BIN" three-ws setup --no-login
	fi
fi

cat <<EOF

three-ws-agent is installed. Open a new terminal (so PATH picks up hermes), then:
  hermes                       start a chat
  hermes three-ws status       check the three.ws connection
  hermes update                pull the latest three-ws-agent (tracks Hermes upstream)
EOF
