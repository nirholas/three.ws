#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# gitpretty.sh — Squash all commits and recommit
# each file with a unique emoji + filename message.
# ──────────────────────────────────────────────
# Usage:  bash gitpretty.sh
# ──────────────────────────────────────────────

# Config — change these if needed
AUTHOR_NAME="nirholas"
AUTHOR_EMAIL="nirholas@users.noreply.github.com"
BRANCH="main"
REMOTE="origin"

echo "🔧 Setting git identity..."
git config user.name "$AUTHOR_NAME"
git config user.email "$AUTHOR_EMAIL"

echo "🗑️  Creating orphan branch (wipes all commit history)..."
git checkout --orphan gitpretty-temp

echo "🧹 Unstaging everything..."
git rm -r --cached . > /dev/null 2>&1 || true

# ──────────────────────────────────────────────
# Ordered list: file → emoji → commit message
# Each file gets its own commit so GitHub shows
# the unique emoji + message per folder/file.
# ──────────────────────────────────────────────
declare -a FILES=(
  ".github/FUNDING.yml"
  ".gitignore"
  ".prettierrc.json"
  "cors.json"
  "index.html"
  "LICENSE"
  "package.json"
  "README.md"
  "style.css"
  "vercel.json"
  "yarn.lock"
  "public/favicon.ico"
  "public/avatars/cz.glb"
  "src/app.js"
  "src/environments.js"
  "src/validator.js"
  "src/viewer.js"
  "src/components/footer.jsx"
  "src/components/validator-report.jsx"
  "src/components/validator-table.jsx"
  "src/components/validator-toggle.jsx"
)

declare -a EMOJIS=(
  "💛"   # FUNDING.yml
  "🙈"   # .gitignore
  "💅"   # .prettierrc.json
  "🌐"   # cors.json
  "🏠"   # index.html
  "📜"   # LICENSE
  "📦"   # package.json
  "📖"   # README.md
  "🎨"   # style.css
  "🚀"   # vercel.json
  "🔒"   # yarn.lock
  "⭐"   # favicon.ico
  "💎"   # cz.glb
  "⚡"   # app.js
  "🌍"   # environments.js
  "✅"   # validator.js
  "👁️"   # viewer.js
  "🦶"   # footer.jsx
  "📋"   # validator-report.jsx
  "📊"   # validator-table.jsx
  "🔀"   # validator-toggle.jsx
)

echo ""
echo "📝 Committing each file with a unique emoji..."
echo ""

for i in "${!FILES[@]}"; do
  FILE="${FILES[$i]}"
  EMOJI="${EMOJIS[$i]}"
  BASENAME=$(basename "$FILE")
  MSG="${EMOJI} ${BASENAME}"

  if [[ -f "$FILE" ]]; then
    git add "$FILE"
    git commit -m "$MSG" --author="$AUTHOR_NAME <$AUTHOR_EMAIL>" --quiet
    echo "  $MSG"
  else
    echo "  ⚠️  Skipping (not found): $FILE"
  fi
done

echo ""
echo "🔄 Replacing $BRANCH with pretty history..."
git branch -D "$BRANCH" 2>/dev/null || true
git branch -m "$BRANCH"

echo ""
echo "✨ Done! Your local history is now pretty."
echo ""
echo "To push (this REWRITES remote history):"
echo "  git push --force-with-lease $REMOTE $BRANCH"
echo ""
echo "Or if that fails (e.g. new orphan branch):"
echo "  git push --force $REMOTE $BRANCH"
