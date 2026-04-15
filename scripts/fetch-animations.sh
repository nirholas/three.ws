#!/usr/bin/env bash
set -euo pipefail
# ─────────────────────────────────────────────────────────────────────────────
# fetch-animations.sh
# Downloads Mixamo-compatible animation GLBs into public/animations/
# Run from the project root:  bash scripts/fetch-animations.sh
# ─────────────────────────────────────────────────────────────────────────────

ANIM_DIR="public/animations"
mkdir -p "$ANIM_DIR"

echo "🎬 Fetching Mixamo animation GLBs..."
echo ""

# ── Step 1: Clone the brunoimbrizi tutorial repo (has FBX animation files) ──
TMPDIR=$(mktemp -d)
echo "📦 Cloning brunoimbrizi/tutorial-threejs-mixamo..."
git clone --depth 1 https://github.com/brunoimbrizi/tutorial-threejs-mixamo.git "$TMPDIR/mixamo" 2>/dev/null || {
    echo "⚠️  Clone failed. Trying alternative sources..."
}

# ── Step 2: Find all FBX / GLB files ──
echo ""
echo "🔍 Scanning for animation files..."
FOUND_FBX=()
FOUND_GLB=()

if [ -d "$TMPDIR/mixamo" ]; then
    while IFS= read -r -d '' f; do
        FOUND_FBX+=("$f")
    done < <(find "$TMPDIR/mixamo" -iname "*.fbx" -print0 2>/dev/null)

    while IFS= read -r -d '' f; do
        FOUND_GLB+=("$f")
    done < <(find "$TMPDIR/mixamo" -iname "*.glb" -print0 2>/dev/null)
fi

echo "   Found ${#FOUND_FBX[@]} FBX files, ${#FOUND_GLB[@]} GLB files"

# ── Step 3: Copy any GLBs directly ──
for glb in "${FOUND_GLB[@]}"; do
    name=$(basename "$glb" .glb | tr '[:upper:]' '[:lower:]' | tr ' @' '-_')
    echo "   ✅ Copying $name.glb"
    cp "$glb" "$ANIM_DIR/$name.glb"
done

# ── Step 4: Convert FBX to GLB ──
if [ ${#FOUND_FBX[@]} -gt 0 ]; then
    echo ""
    echo "🔄 Converting FBX files to GLB..."

    # Try fbx2gltf first
    if command -v fbx2gltf &>/dev/null; then
        CONVERTER="fbx2gltf"
    elif npx fbx2gltf --help &>/dev/null 2>&1; then
        CONVERTER="npx fbx2gltf"
    else
        echo "   Installing fbx2gltf..."
        npm install -g fbx2gltf 2>/dev/null || pip install trimesh[easy] 2>/dev/null || true

        if command -v fbx2gltf &>/dev/null; then
            CONVERTER="fbx2gltf"
        else
            CONVERTER=""
        fi
    fi

    if [ -n "$CONVERTER" ]; then
        for fbx in "${FOUND_FBX[@]}"; do
            name=$(basename "$fbx" .fbx | tr '[:upper:]' '[:lower:]' | tr ' @' '-_')
            echo "   Converting: $name"
            $CONVERTER -i "$fbx" -o "$ANIM_DIR/$name.glb" 2>/dev/null || echo "   ⚠️  Failed: $name"
        done
    else
        echo "   ⚠️  No FBX converter available. Install with: npm install -g fbx2gltf"
        echo "   Or download animations as GLB directly from mixamo.com"
    fi
fi

# ── Step 5: Try alternative public GLB sources ──
echo ""
echo "🌐 Checking alternative public animation sources..."

# Known public Mixamo GLB repos / CDNs
SOURCES=(
    "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb"
)

# Search for more repos with Mixamo GLBs
SEARCH_RESULTS=$(curl -sL "https://api.github.com/search/repositories?q=mixamo+glb+animation&sort=stars&per_page=5" 2>/dev/null)
if [ -n "$SEARCH_RESULTS" ]; then
    echo "   Top repos with Mixamo GLB animations:"
    echo "$SEARCH_RESULTS" | python3 -c "
import sys,json
try:
    for r in json.load(sys.stdin).get('items',[])[:5]:
        print(f\"   ⭐ {r['stargazers_count']:>4}  {r['full_name']}  —  {r.get('description','')[:60]}\")
except:
    pass
" 2>/dev/null || true
fi

# ── Step 6: Update manifest based on what we actually downloaded ──
echo ""
echo "📝 Updating manifest.json..."

MANIFEST="["
FIRST=true
for glb in "$ANIM_DIR"/*.glb; do
    [ -f "$glb" ] || continue
    name=$(basename "$glb" .glb)
    label=$(echo "$name" | sed 's/-/ /g; s/_/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')

    # Pick an icon
    case "$name" in
        *idle*|*breathing*|*standing*) icon="🧍" ;;
        *walk*)    icon="🚶" ;;
        *run*)     icon="🏃" ;;
        *wave*)    icon="👋" ;;
        *danc*)    icon="💃" ;;
        *sit*)     icon="🪑" ;;
        *jump*)    icon="🦘" ;;
        *talk*)    icon="🗣️" ;;
        *clap*)    icon="👏" ;;
        *punch*)   icon="👊" ;;
        *kick*)    icon="🦵" ;;
        *)         icon="▶" ;;
    esac

    # Determine loop
    case "$name" in
        *wave*|*jump*|*punch*|*kick*|*clap*) loop="false" ;;
        *) loop="true" ;;
    esac

    if [ "$FIRST" = true ]; then FIRST=false; else MANIFEST+=","; fi
    MANIFEST+="
	{
		\"name\": \"$name\",
		\"url\": \"/animations/$name.glb\",
		\"label\": \"$label\",
		\"icon\": \"$icon\",
		\"loop\": $loop
	}"
done
MANIFEST+="
]
"

echo "$MANIFEST" > "$ANIM_DIR/manifest.json"

# ── Step 7: Cleanup ──
rm -rf "$TMPDIR"

# ── Report ──
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📂 Animation files in $ANIM_DIR:"
ls -lh "$ANIM_DIR"/*.glb 2>/dev/null || echo "   (none yet)"
echo ""
echo "📋 manifest.json:"
cat "$ANIM_DIR/manifest.json"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""

COUNT=$(ls "$ANIM_DIR"/*.glb 2>/dev/null | wc -l)
if [ "$COUNT" -gt 0 ]; then
    echo "✅ Done! $COUNT animation(s) ready. Run 'npm run dev' to test."
else
    echo "⚠️  No GLB files downloaded automatically."
    echo ""
    echo "👉 Manual download from Mixamo (takes 5 min):"
    echo "   1. Go to https://www.mixamo.com/ and sign in (free)"
    echo "   2. Click 'Animations' tab"
    echo "   3. Search for: Idle, Walking, Running, Waving, Dancing, Sitting, Jumping"
    echo "   4. For each animation:"
    echo "      - Click 'Download'"
    echo "      - Format: FBX Binary (.fbx)"
    echo "      - Skin: 'Without Skin'"
    echo "      - Click 'Download'"
    echo "   5. Convert FBX to GLB:"
    echo "      npm install -g fbx2gltf"
    echo "      for f in *.fbx; do fbx2gltf -i \"\$f\" -o \"public/animations/\$(basename \"\$f\" .fbx | tr '[:upper:]' '[:lower:]').glb\"; done"
    echo "   6. Run this script again to update manifest.json"
    echo "      bash scripts/fetch-animations.sh"
fi
