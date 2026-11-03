#!/usr/bin/env bash
# Push the locally prepared fix/security-overrides branches and open one PR per repo.
# Owner-gated: pushes to public repos only when run with --yes by the owner.
#
# Usage: GH_TOKEN=... docs/github-benchmark/push_fixes.sh --yes [repo ...]
#   With no repo names, every clone under $CLONES that has a commit on the branch is pushed.
set -euo pipefail
CLONES="${CLONES:-/home/user/repo-fixes}"
BRANCH="fix/security-overrides"
OWNER="${OWNER:-nirholas}"
REPORT="$(cd "$(dirname "$0")" && pwd)/dependency-fixes.md"

if [[ "${1:-}" != "--yes" ]]; then
  echo "Refusing to push without --yes. Review $REPORT first." >&2
  exit 2
fi
shift
: "${GH_TOKEN:?set GH_TOKEN to a token with contents:write and pull_requests:write}"

repos=("$@")
if [[ ${#repos[@]} -eq 0 ]]; then
  for d in "$CLONES"/*/; do repos+=("$(basename "$d")"); done
fi

for name in "${repos[@]}"; do
  dir="$CLONES/$name"
  [[ -d "$dir/.git" ]] || { echo "skip $name: no clone"; continue; }
  cd "$dir"
  [[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]] || { echo "skip $name: not on $BRANCH"; continue; }
  base="$(git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null | sed 's#^origin/##' || true)"
  base="${base:-$(git remote show origin | sed -n 's/.*HEAD branch: //p')}"
  if [[ "$(git rev-list --count "origin/$base..HEAD" 2>/dev/null || echo 0)" == "0" ]]; then
    echo "skip $name: nothing committed"; continue
  fi
  git -c credential.helper= -c "http.extraheader=Authorization: Basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)" \
    push "https://github.com/$OWNER/$name.git" "HEAD:refs/heads/$BRANCH"
  body="$(git log -1 --format=%b)"
  GH_TOKEN="$GH_TOKEN" gh pr create --repo "$OWNER/$name" --base "$base" --head "$BRANCH" \
    --title "$(git log -1 --format=%s)" \
    --body "$body"$'\n\nPrepared with docs/github-benchmark/fix_deps.py (npm/pnpm/yarn overrides scoped to the vulnerable range, cargo update for Rust). Build and test results are in the commit message.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' \
    || echo "PR for $name not created (it may already exist)"
done
