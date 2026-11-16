#!/usr/bin/env bash
# Run the threews.forge omni.kit.test suite in a headless Kit.
#
# Usage: scripts/run_tests.sh [test filter]
#   KIT_PYTHON  python that has the omniverse-kit wheel installed (default: python3)
#   THREEWS_LIVE=1, THREEWS_API_KEY, THREEWS_LIVE_REPORT, THREEWS_CAPTURE_DIR: see tests/test_live.py, tests/test_ui.py
#   KIT_WINDOW=1  open a real window (GPU only) so the panel tests run instead of skipping
#
# Exit code is the Kit test runner's: non-zero on any failure.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
py="${KIT_PYTHON:-python3}"
out="${TEST_OUTPUT:-$here/.test-output}"
mkdir -p "$out"
export OMNI_KIT_ACCEPT_EULA=yes

window_args=(--no-window)
if [[ "${KIT_WINDOW:-0}" == "1" ]]; then
  window_args=(--enable omni.ui --enable omni.kit.menu.utils --enable omni.kit.viewport.utility --enable omni.renderer_capture)
fi

filter_args=()
if [[ $# -gt 0 ]]; then
  filter_args=(--/exts/omni.kit.test/runTestsFilter="$1")
fi

exec "$py" -m omni.kit_app \
  "${window_args[@]}" \
  --ext-folder "$here/exts" \
  --enable threews.forge \
  --enable omni.kit.test \
  --/app/file/ignoreUnsavedOnExit=true \
  --/app/asyncRendering=false \
  --/app/useFabricSceneDelegate=false \
  --/exts/omni.kit.test/runTestsAndQuit=true \
  --/exts/omni.kit.test/includeTests/0="threews.forge.*" \
  --/exts/omni.kit.test/testOutputPath="$out" \
  --/log/file="$out/kit.log" \
  --/log/outputStreamLevel=Warn \
  "${filter_args[@]}"
