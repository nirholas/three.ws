#!/usr/bin/env bash
# Build the three.ws Blender extension, install it into a throwaway Blender profile
# and run the in-Blender tests against real files:
#
#   blender_import_test.py  headless (-b): real splat PLYs and a real GLB imported,
#                           object counts and bounding boxes checked, offline mode
#                           refuses every network call.
#   blender_timer_test.py   windowed under Xvfb: the full Send flow against a local
#                           server speaking the capture contract, proving the UI
#                           keeps ticking while the upload and polling run.
#
# Usage: integrations/blender/tests/run_blender_tests.sh
# Env:   BLENDER=/path/to/blender  (default: blender on PATH, then the 4.2 LTS
#        download cached in ~/.cache/blender, fetched and SHA-checked if missing)
#        THREEWS_FIXTURES=dir      (default ~/.cache/three-ws-fixtures)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$HERE/../three_ws" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DIST="$HERE/../dist"
FIX="${THREEWS_FIXTURES:-$HOME/.cache/three-ws-fixtures}"
CACHE="$HOME/.cache/blender"
BL_VERSION="4.2.23"
BL_TAR="blender-${BL_VERSION}-linux-x64.tar.xz"
BL_URL="https://download.blender.org/release/Blender4.2/${BL_TAR}"
BL_SHA_URL="https://download.blender.org/release/Blender4.2/blender-${BL_VERSION}.sha256"

say() { printf '\n== %s\n' "$*"; }

fetch() { # url dest sha256
  local url="$1" dest="$2" sha="$3"
  if [[ -f "$dest" ]] && echo "$sha  $dest" | sha256sum -c --status; then return; fi
  mkdir -p "$(dirname "$dest")"
  curl -sSfL --retry 3 -o "$dest.part" "$url"
  echo "$sha  $dest.part" | sha256sum -c --status || { echo "SHA-256 mismatch for $url" >&2; rm -f "$dest.part"; exit 1; }
  mv "$dest.part" "$dest"
}

find_blender() {
  if [[ -n "${BLENDER:-}" ]]; then echo "$BLENDER"; return; fi
  if command -v blender >/dev/null 2>&1; then command -v blender; return; fi
  local bin="$CACHE/blender-${BL_VERSION}-linux-x64/blender"
  if [[ ! -x "$bin" ]]; then
    mkdir -p "$CACHE"
    local sha
    sha="$(curl -sSfL "$BL_SHA_URL" | awk -v f="$BL_TAR" '$2 == f {print $1}')"
    [[ -n "$sha" ]] || { echo "No published SHA-256 for $BL_TAR" >&2; exit 1; }
    fetch "$BL_URL" "$CACHE/$BL_TAR" "$sha"
    tar -xJf "$CACHE/$BL_TAR" -C "$CACHE"
  fi
  echo "$bin"
}

BLENDER_BIN="$(find_blender)"
"$BLENDER_BIN" --version | head -1

say "Fixtures (real files, SHA-256 pinned, cached outside the repo)"
# 3D Gaussian Splatting PLYs from the public huggingface.co/datasets/dylanebert/3dgs set.
fetch "https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/luigi/luigi.ply" \
  "$FIX/3dgs/luigi.ply" 6971debf967bac924a4c8bd4457b354db66326792d1a300fd996c7eefede04aa
fetch "https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/point_cloud/iteration_7000/point_cloud.ply" \
  "$FIX/3dgs/bonsai-7000.ply" d910c613ffc2410a2e6331757940f5b2f20342ebf7e5203e803e484f75dce4b3
GLB="$REPO/public/objects/kenney-graveyard/glb/pumpkin-tall-carved.glb"   # Kenney, CC0
PANO_JPG="$REPO/third_party/image-blaster/app/public/hdri.jpg"           # 2048x1024 equirect, MIT
MOVIE="$FIX/equirect-2to1.mp4"
if [[ ! -s "$MOVIE" ]]; then
  # A real H.264 2:1 equirect clip: the panorama panned a full turn over three seconds.
  ffmpeg -loglevel error -y -loop 1 -i "$PANO_JPG" -t 3 -r 24 \
    -vf "scale=1024:512,scroll=horizontal=0.0139,format=yuv420p" -c:v libx264 -preset veryfast "$MOVIE"
fi
for f in "$GLB" "$PANO_JPG" "$MOVIE"; do [[ -s "$f" ]] || { echo "missing fixture $f" >&2; exit 1; }; done

say "Validate and build"
"$BLENDER_BIN" --factory-startup --command extension validate "$EXT_DIR"
mkdir -p "$DIST"
"$BLENDER_BIN" --factory-startup --command extension build --source-dir "$EXT_DIR" --output-dir "$DIST"
VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$EXT_DIR/blender_manifest.toml")"
ZIP="$DIST/three_ws-${VERSION}.zip"
"$BLENDER_BIN" --factory-startup --command extension validate "$ZIP"
sha256sum "$ZIP"

PROFILE="$(mktemp -d -t threews-blender-XXXXXX)"
trap 'rm -rf "$PROFILE"' EXIT
export BLENDER_USER_RESOURCES="$PROFILE"
say "Install into a throwaway profile ($PROFILE)"
"$BLENDER_BIN" --factory-startup --command extension install-file --repo user_default --enable "$ZIP"

say "Headless import test"
"$BLENDER_BIN" -b --offline-mode --python-exit-code 1 --python "$HERE/blender_import_test.py" -- \
  --luigi "$FIX/3dgs/luigi.ply" --bonsai "$FIX/3dgs/bonsai-7000.ply" --glb "$GLB" --movie "$MOVIE"

say "Windowed timer test under Xvfb"
RESULT="$PROFILE/timer-result.json"
xvfb-run -a -s "-screen 0 1600x1000x24" \
  "$BLENDER_BIN" --online-mode --python-exit-code 1 --python "$HERE/blender_timer_test.py" -- \
  --tests-dir "$HERE" --video "$MOVIE" --photo "$PANO_JPG" --ply "$FIX/3dgs/luigi.ply" --glb "$GLB" \
  --result "$RESULT" --screenshot "$DIST/panel-${VERSION}.png"
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(json.dumps(r, indent=2)); sys.exit(0 if r["ok"] else 1)' "$RESULT"

say "All Blender tests passed for three_ws ${VERSION}"
