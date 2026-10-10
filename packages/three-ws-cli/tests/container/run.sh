#!/bin/sh
# Clean-container check for every client config path: for each client, a fresh
# node container (no config, no credentials) runs the real hosted installer
# through `curl | sh` against a local stand-in platform, then asserts the client
# config exists, holds no secret, survives a second run unchanged, and passes
# `three-ws doctor`. Needs docker. Usage: sh run.sh   (from anywhere)

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE/../.."
PORT="${PORT:-8799}"
WORK="$(mktemp -d)"
KEY="sk_live_container_test_key_0000000000"
IMAGE="${IMAGE:-node:22}"

(cd "$PKG" && npm pack --silent --pack-destination "$WORK" >/dev/null)
TARBALL="$(ls "$WORK"/three-ws-*.tgz)"
node "$HERE/platform-stub.mjs" "$PORT" >/dev/null &
STUB=$!
trap 'kill $STUB 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 1

CASES="claude:.claude.json cursor:.cursor/mcp.json windsurf:.codeium/windsurf/mcp_config.json codex:.codex/config.toml vscode:.config/Code/User/mcp.json gemini:.gemini/settings.json"
FAILED=0
for c in $CASES; do
  flag="${c%%:*}"; rel="${c#*:}"
  printf '== --%s ==\n' "$flag"
  if docker run --rm --network host -v "$WORK:/pkg:ro" -e THREE_WS_API_KEY="$KEY" -e THREE_WS_PACKAGE=file:/pkg/"$(basename "$TARBALL")" \
    -e THREE_WS_NO_BROWSER=1 "$IMAGE" sh -ec '
      O=http://127.0.0.1:'"$PORT"'
      cd "$HOME"
      run() { curl -fsSL "$O/cli/install.sh" | sh -s -- -- --'"$flag"' --key --origin "$O" >/tmp/out 2>&1 || { cat /tmp/out; exit 1; }; }
      run
      test -f "'"$rel"'" || { echo "missing '"$rel"'"; exit 1; }
      if grep -r "'"$KEY"'" "'"$rel"'" >/dev/null; then echo "secret written to client config"; exit 1; fi
      cp "'"$rel"'" /tmp/first
      run
      cmp /tmp/first "'"$rel"'" || { echo "second run changed the file"; exit 1; }
      npx --yes "$THREE_WS_PACKAGE" doctor --origin "$O" </dev/null
      stat -c %a ~/.config/three-ws/credentials.json | grep -qx 600
    '; then echo "ok --$flag"; else echo "FAIL --$flag"; FAILED=1; fi
done
exit $FAILED
