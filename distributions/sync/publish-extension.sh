#!/usr/bin/env bash
# Publish a generated directory to its own GitHub repository, root-level.
#
# Used for the Gemini CLI extension: Gemini installs extensions from a repo
# whose root holds gemini-extension.json, and its gallery crawls tagged repos.
# The directory in three.ws is the source of truth; this mirrors it, commits
# only when something changed, and tags v<version> from the manifest.
#
# Usage: distributions/sync/publish-extension.sh <source-dir> <repo-url> <manifest-file>
#   PUSH=1 pushes (needs GITHUB_TOKEN); anything else is a dry run.

set -euo pipefail
export GIT_TERMINAL_PROMPT=0

SRC="$(cd "$1" && pwd)"
REPO_URL="$2"
MANIFEST="$3"
PUSH="${PUSH:-0}"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
NAME="$(basename "$REPO_URL" .git)"

log() { printf '[publish:%s] %s\n' "$NAME" "$*"; }
die() { printf '[publish:%s] error: %s\n' "$NAME" "$*" >&2; exit 1; }

[ -f "$SRC/$MANIFEST" ] || die "$SRC/$MANIFEST not found"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SRC/$MANIFEST")"
THREE_WS_SHA="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"

REPO="$WORK_DIR/$NAME"
rm -rf "$REPO"
if git ls-remote --exit-code --heads "$REPO_URL" main >/dev/null 2>&1; then
	git clone -q --depth 1 --no-single-branch "$REPO_URL" "$REPO"
	git -C "$REPO" fetch -q --tags
else
	log "repository has no main branch yet: starting it"
	git init -q -b main "$REPO"
	git -C "$REPO" remote add origin "$REPO_URL"
fi
cd "$REPO"
git config user.name "three.ws distribution bot"
git config user.email "support@three.ws"

find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$SRC/." .
git add -A
if git diff --cached --quiet; then
	log "no changes"
else
	git commit -q -m "Release $VERSION from three.ws@$THREE_WS_SHA"
	log "committed $VERSION"
fi

tag="v$VERSION"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
	[ "$(git rev-list -n1 "$tag")" = "$(git rev-parse HEAD)" ] \
		|| die "content changed but $tag already exists: bump the version in data/agent-frameworks.json"
else
	git tag -a "$tag" -m "$NAME $VERSION"
	log "tagged $tag"
fi

if [ "$PUSH" = "1" ]; then
	[ -n "${GITHUB_TOKEN:-}" ] || die "PUSH=1 needs GITHUB_TOKEN"
	push_url="$(printf '%s' "$REPO_URL" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
	git push -q "$push_url" main:main
	git push -q "$push_url" "$tag"
	log "pushed main and $tag"
else
	log "dry run: not pushing. Result in $REPO"
fi
