#!/usr/bin/env bash
# Keep nirholas/three-ws-agent in sync with Hermes Agent upstream.
#
# The distribution's main branch is upstream main plus the three.ws overlay
# (distributions/hermes/overlay/). Each run merges the latest upstream into it,
# refreshes the overlay, proves upstream files are byte-identical, installs the
# result, exercises the plugin, and only then pushes. Every run is a merge on
# top of the previous distribution commit, so `hermes update` (git pull
# --ff-only) always fast-forwards for people who installed it.
#
# Usage: distributions/sync/sync-hermes.sh
#
# Environment:
#   THREE_WS_DIR     three.ws checkout holding the overlay (default: this repo)
#   FORK_URL         distribution repo (default https://github.com/nirholas/three-ws-agent.git)
#   UPSTREAM_URL     upstream repo (default https://github.com/NousResearch/hermes-agent.git)
#   UPSTREAM_BRANCH  upstream branch (default main)
#   WORK_DIR         scratch directory (default: a fresh temp dir)
#   VERIFY_INSTALL   1 (default) installs Hermes from the merged tree and tests the plugin
#   PUSH             1 pushes the result; anything else is a dry run
#   GITHUB_TOKEN     token with contents:write on the fork, needed when PUSH=1

set -euo pipefail
export GIT_TERMINAL_PROMPT=0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THREE_WS_DIR="${THREE_WS_DIR:-$(cd "$HERE/../.." && pwd)}"
OVERLAY="$THREE_WS_DIR/distributions/hermes/overlay"
FORK_URL="${FORK_URL:-https://github.com/nirholas/three-ws-agent.git}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/NousResearch/hermes-agent.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
VERIFY_INSTALL="${VERIFY_INSTALL:-1}"
PUSH="${PUSH:-0}"
# Paths the overlay owns. Everything else in the distribution must equal upstream.
OWNED=(plugins/three-ws .github/README.md THREE-WS-NOTICE.md)

log() { printf '[sync-hermes] %s\n' "$*"; }
die() { printf '[sync-hermes] error: %s\n' "$*" >&2; exit 1; }

[ -d "$OVERLAY/plugins/three-ws" ] || die "overlay not found at $OVERLAY (run npm run build:distributions)"
THREE_WS_SHA="$(git -C "$THREE_WS_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

REPO="$WORK_DIR/three-ws-agent"
rm -rf "$REPO"
git init -q -b main "$REPO"
cd "$REPO"
git config user.name "three.ws distribution bot"
git config user.email "support@three.ws"
git remote add upstream "$UPSTREAM_URL"
git remote add origin "$FORK_URL"

log "fetching upstream $UPSTREAM_URL ($UPSTREAM_BRANCH)"
git fetch -q --filter=blob:none upstream "$UPSTREAM_BRANCH"
UPSTREAM_SHA="$(git rev-parse --short "upstream/$UPSTREAM_BRANCH")"

if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
	log "fetching distribution $FORK_URL"
	git fetch -q --filter=blob:none origin main
	git checkout -q -B main origin/main
	if git merge-base --is-ancestor "upstream/$UPSTREAM_BRANCH" HEAD; then
		log "upstream $UPSTREAM_SHA already merged"
	else
		log "merging upstream $UPSTREAM_SHA"
		git merge -q --no-edit -m "Merge Hermes Agent upstream $UPSTREAM_SHA" "upstream/$UPSTREAM_BRANCH" \
			|| die "merge conflict with upstream $UPSTREAM_SHA; the overlay must only own ${OWNED[*]}"
	fi
else
	log "distribution has no main branch yet: starting from upstream $UPSTREAM_SHA"
	git checkout -q -B main "upstream/$UPSTREAM_BRANCH"
fi

log "applying the three.ws overlay from three.ws@$THREE_WS_SHA"
for path in "${OWNED[@]}"; do
	rm -rf "$path"
	if [ -e "$OVERLAY/$path" ]; then
		mkdir -p "$(dirname "$path")"
		cp -a "$OVERLAY/$path" "$path"
	fi
done
find plugins/three-ws -name '__pycache__' -type d -prune -exec rm -rf {} +
git add -A -- "${OWNED[@]}"
if git diff --cached --quiet; then
	log "overlay unchanged"
else
	git commit -q -m "three.ws overlay from three.ws@$THREE_WS_SHA"
	log "committed overlay"
fi

log "verifying upstream files are unchanged"
excludes=()
for path in "${OWNED[@]}"; do excludes+=(":(exclude)$path"); done
if ! git diff --quiet "upstream/$UPSTREAM_BRANCH" HEAD -- . "${excludes[@]}"; then
	git diff --stat "upstream/$UPSTREAM_BRANCH" HEAD -- . "${excludes[@]}" >&2
	die "files outside the overlay differ from upstream"
fi

log "compiling the plugin"
python3 -m py_compile plugins/three-ws/*.py

if [ "$VERIFY_INSTALL" = "1" ]; then
	command -v uv >/dev/null 2>&1 || python3 -m pip install -q uv
	UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
	log "installing Hermes from the merged tree"
	"$UV" venv -q --python 3.12 "$WORK_DIR/venv"
	VIRTUAL_ENV="$WORK_DIR/venv" "$UV" pip install -q -e ".[mcp]"
	HERMES="$WORK_DIR/venv/bin/hermes"
	export HERMES_HOME="$WORK_DIR/hermes-home"
	mkdir -p "$HERMES_HOME"
	log "plugin doctor"
	"$HERMES" plugins doctor plugins/three-ws --ci
	log "enabling the plugin and running setup against production"
	"$HERMES" plugins enable three-ws
	"$HERMES" three-ws setup --no-login </dev/null | tee "$WORK_DIR/setup.log"
	grep -q "three-ws-studio: Tools discovered" "$WORK_DIR/setup.log" \
		|| die "setup did not reach the free three.ws server"
	[ -f "$HERMES_HOME/skins/three-ws.yaml" ] || die "skin was not installed"
	ls "$HERMES_HOME"/skills/three-ws/*/SKILL.md >/dev/null || die "skills were not installed"
	log "install verified"
fi

if [ "$PUSH" = "1" ]; then
	[ -n "${GITHUB_TOKEN:-}" ] || die "PUSH=1 needs GITHUB_TOKEN"
	push_url="$(printf '%s' "$FORK_URL" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
	log "pushing main to $FORK_URL"
	git push -q "$push_url" main:main
	log "pushed $(git rev-parse --short HEAD) (upstream $UPSTREAM_SHA, three.ws@$THREE_WS_SHA)"
else
	log "dry run: not pushing. Result is $(git rev-parse --short HEAD) in $REPO"
fi
