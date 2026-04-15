#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────────────────
# quick-fetch-anims.sh
# Downloads Mixamo animation GLBs from public GitHub repos and CDNs.
# Run: bash scripts/quick-fetch-anims.sh
# ─────────────────────────────────────────────────────────────────────────────

ANIM_DIR="public/animations"
mkdir -p "$ANIM_DIR"

echo "🎬 Downloading Mixamo animation GLBs..."
echo ""

# ── Try known public sources with Mixamo GLB animations ──

# Source 1: KhronosGroup glTF-Sample-Assets (has animated models)
# Source 2: Public Mixamo GLB collections on GitHub

# First, find repos with actual GLB animation files
echo "🔍 Searching for public Mixamo GLB repos..."

# Try to find and clone repos with ready-made GLBs
REPOS=(
    "https://github.com/n-peugnet/lichtmern"
    "https://github.com/simondevyoutube/ThreeJS_Tutorial_ThirdPersonCamera"
)

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

for repo in "${REPOS[@]}"; do
    NAME=$(basename "$repo")
    echo "   Checking $NAME..."
    git clone --depth 1 "$repo" "$TMPDIR/$NAME" 2>/dev/null || continue

    while IFS= read -r -d '' glb; do
        BASENAME=$(basename "$glb" .glb | tr '[:upper:]' '[:lower:]' | tr ' @' '-_')

        # Only copy if it looks like a standalone animation (small-ish file, < 5MB = likely no skin)
        SIZE=$(stat -f%z "$glb" 2>/dev/null || stat --printf="%s" "$glb" 2>/dev/null || echo 0)
        if [ "$SIZE" -lt 5000000 ] && [ "$SIZE" -gt 1000 ]; then
            echo "   ✅ Found: $BASENAME.glb ($(( SIZE / 1024 ))KB)"
            cp "$glb" "$ANIM_DIR/$BASENAME.glb"
        fi
    done < <(find "$TMPDIR/$NAME" -iname "*.glb" -print0 2>/dev/null)
done

# ── Try direct downloads from raw GitHub URLs ──
echo ""
echo "🌐 Trying direct downloads..."

# Mixamo default character with animations from three.js examples
DIRECT_URLS=(
    "https://threejs.org/examples/models/gltf/Xbot.glb xbot"
)

for entry in "${DIRECT_URLS[@]}"; do
    url=$(echo "$entry" | cut -d' ' -f1)
    name=$(echo "$entry" | cut -d' ' -f2)
    echo "   Downloading $name..."
    curl -sL -o "$ANIM_DIR/$name.glb" "$url" 2>/dev/null && {
        SIZE=$(stat -f%z "$ANIM_DIR/$name.glb" 2>/dev/null || stat --printf="%s" "$ANIM_DIR/$name.glb" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 1000 ]; then
            echo "   ✅ $name.glb ($(( SIZE / 1024 ))KB)"
        else
            echo "   ⚠️  Download too small, removing"
            rm -f "$ANIM_DIR/$name.glb"
        fi
    } || echo "   ⚠️  Failed"
done

# ── Count results ──
echo ""
COUNT=$(ls "$ANIM_DIR"/*.glb 2>/dev/null | wc -l || echo 0)
echo "═══════════════════════════════════════════════════════════"
echo "📂 $COUNT animation file(s) in $ANIM_DIR/"
ls -lh "$ANIM_DIR"/*.glb 2>/dev/null || echo "   (none)"
echo "═══════════════════════════════════════════════════════════"

if [ "$COUNT" -eq 0 ]; then
    echo ""
    echo "No pre-made GLBs found. Downloading from Mixamo directly..."
    echo ""
    echo "The fastest way to get animations:"
    echo ""
    echo "  1. Go to https://www.mixamo.com (sign in free with Adobe account)"
    echo "  2. In the Characters tab, pick 'Y Bot' or your own model"
    echo "  3. In the Animations tab, search & download these as FBX (.fbx):"
    echo "     - Breathing Idle    → rename to idle.fbx"
    echo "     - Walking           → rename to walking.fbx"
    echo "     - Running           → rename to running.fbx"
    echo "     - Waving            → rename to waving.fbx"
    echo "     - Hip Hop Dancing   → rename to dancing.fbx"
    echo "     - Sitting            → rename to sitting.fbx"
    echo "     - Jump              → rename to jumping.fbx"
    echo "  4. Convert all at once:"
    echo "     npm install -g fbx2gltf"
    echo "     cd public/animations"
    echo "     for f in *.fbx; do fbx2gltf -i \"\$f\" -o \"\${f%.fbx}.glb\"; rm \"\$f\"; done"
    echo "  5. Update manifest:"
    echo "     bash scripts/fetch-animations.sh"
fi
