#!/usr/bin/env bash
# Opens the pull request that lists three.ws in Docker's MCP Catalog.
# Owner action: it forks docker/mcp-registry to the signed-in gh account and opens a public PR.
# Needs gh (signed in), git, Go 1.24+ and npx. Steps and context: SUBMITTING.md.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
branch="add-three-ws"
work="${XDG_CACHE_HOME:-$HOME/.cache}/three-ws/docker-mcp-registry-fork"

echo "1/5 checking the live /mcp challenge and Docker's validator"
node "$repo_root/scripts/check-integrations.mjs" docker-mcp-catalog

user="$(gh api user --jq .login)"
echo "2/5 forking docker/mcp-registry to $user"
gh repo fork docker/mcp-registry --clone=false >/dev/null 2>&1 || true
rm -rf "$work"
gh repo clone "$user/mcp-registry" "$work" -- --depth 1 -q
cd "$work"
git remote add upstream https://github.com/docker/mcp-registry.git 2>/dev/null || true
git fetch -q --depth 1 upstream main
git checkout -q -B "$branch" upstream/main

echo "3/5 adding servers/three-ws and running Docker's validator"
rm -rf servers/three-ws
cp -R "$here/servers/three-ws" servers/three-ws
go run ./cmd/validate --name three-ws
go run ./cmd/build --tools three-ws

git add servers/three-ws
git commit -q -m "Add three-ws remote server"
git --no-pager show --stat HEAD

read -r -p "4/5 push $branch to $user/mcp-registry and open the PR against docker/mcp-registry? [y/N] " answer
[[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "stopped before pushing; the branch is in $work"; exit 0; }
git push -q origin "$branch"

echo "5/5 opening the pull request"
gh pr create --repo docker/mcp-registry --head "$user:$branch" --base main \
	--title "Add three-ws remote server" --body-file "$here/PR_BODY.md"
