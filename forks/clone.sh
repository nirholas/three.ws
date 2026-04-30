#!/usr/bin/env bash
# Clone or update the three reference repos used as pattern sources.
# See README.md for what to lift from each.
set -euo pipefail

cd "$(dirname "$0")"

repos=(
	"https://github.com/met4citizen/TalkingHead.git talkinghead"
	"https://github.com/SerifeusStudio/threlte-mcp.git threlte-mcp"
	"https://github.com/tegnike/aituber-kit.git aituber-kit"
)

for entry in "${repos[@]}"; do
	read -r url dir <<<"$entry"
	if [[ -d "$dir/.git" ]]; then
		echo "→ pulling $dir"
		git -C "$dir" pull --ff-only
	else
		echo "→ cloning $dir"
		git clone --depth 1 "$url" "$dir"
	fi
done

echo "done. read forks/README.md for what to lift from each."
