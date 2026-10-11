#!/bin/sh
# Xcode Cloud runs this right after it clones the repo, before it resolves
# Swift packages or builds. Xcode Cloud finds it because ci_scripts/ sits next
# to App.xcodeproj.
#
# The clone alone cannot build: CapApp-SPM resolves every Capacitor plugin from
# ios/node_modules, and cap sync writes the gitignored capacitor.config.json,
# config.xml and shell bundle the app target copies. Xcode Cloud images ship
# Homebrew but not Node, so Node comes first.
#
# Xcode Cloud assigns its own rising build number to every archive, so this
# does not touch CURRENT_PROJECT_VERSION. CarPlay stays off unless the workflow
# sets the environment variable THREEWS_CARPLAY=1, which only makes sense once
# Apple has granted the entitlement. A target-level build setting outranks an
# environment variable, so the switch is made in this clone's project file.
set -eu

export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_AUTO_UPDATE=1
brew install node

cd "$CI_PRIMARY_REPOSITORY_PATH"
node scripts/check-ios-app.mjs

if [ "${THREEWS_CARPLAY:-0}" = "1" ]; then
	sed -i '' 's#THREEWS_APP_ENTITLEMENTS = App/App.entitlements;#THREEWS_APP_ENTITLEMENTS = App/App-CarPlay.entitlements;#' \
		ios/native/App/App.xcodeproj/project.pbxproj
	echo "CarPlay entitlement on for this build"
fi

cd ios
npm ci --no-audit --no-fund
npx cap sync ios
test -f native/App/App/capacitor.config.json
