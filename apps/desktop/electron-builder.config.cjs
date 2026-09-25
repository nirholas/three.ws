// electron-builder configuration for three.ws Desktop.
//
// Targets: macOS universal .dmg and .zip, Windows NSIS installer and portable
// .exe, Linux .AppImage and .deb. Artifacts land in dist/ and are published to
// the release bucket behind the three.ws CDN by apps/desktop/cloudbuild.yaml
// (Linux and Windows) and apps/desktop/scripts/release-mac.sh (macOS, which
// needs a Mac to build a universal binary and to notarize).
//
// Signing is read from the environment the release scripts fill from Secret
// Manager. With no certificate present the build is still complete and
// installable, just unsigned:
//   - macOS: ad-hoc signed (identity "-"), so Apple Silicon runs it after
//     "Open Anyway" in System Settings > Privacy & Security.
//   - Windows: unsigned, so SmartScreen asks for "More info" > "Run anyway".
// docs/ops/desktop-release.md lists the certificates and the secret names.

const FEED_URL = process.env.THREE_WS_RELEASE_FEED || 'https://three.ws/releases/desktop';

const macSigned = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const macNotarize = macSigned && Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER);

/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: 'ws.three.desktop',
	productName: 'three.ws Desktop',
	copyright: 'Copyright three.ws',
	artifactName: 'three.ws-Desktop-${version}-${os}-${arch}.${ext}',
	directories: { output: 'dist', buildResources: 'build' },
	files: ['src/**/*', 'assets/**/*', 'package.json', '!**/*.test.js'],
	asar: true,
	// The generic provider is a static directory of files. electron-builder
	// writes latest.yml / latest-mac.yml / latest-linux.yml next to the
	// artifacts and bakes this URL into the app as app-update.yml, which is
	// what src/main/updater.js reads.
	publish: [{ provider: 'generic', url: FEED_URL, channel: 'latest' }],
	mac: {
		category: 'public.app-category.productivity',
		icon: 'build/icon.png',
		target: [
			{ target: 'dmg', arch: ['universal'] },
			{ target: 'zip', arch: ['universal'] },
		],
		minimumSystemVersion: '11.0',
		hardenedRuntime: true,
		gatekeeperAssess: false,
		entitlements: 'build/entitlements.mac.plist',
		entitlementsInherit: 'build/entitlements.mac.plist',
		// null lets electron-builder use the Developer ID from CSC_LINK; "-" is
		// an ad-hoc signature, the least a universal binary needs to launch.
		identity: macSigned ? undefined : '-',
		notarize: macNotarize,
		extendInfo: {
			LSUIElement: false,
			NSHumanReadableCopyright: 'three.ws',
		},
	},
	dmg: {
		sign: false,
		writeUpdateInfo: false,
		title: 'three.ws Desktop ${version}',
	},
	win: {
		icon: 'build/icon.png',
		target: [
			{ target: 'nsis', arch: ['x64'] },
			{ target: 'portable', arch: ['x64'] },
		],
		publisherName: 'three.ws',
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
		createDesktopShortcut: true,
		createStartMenuShortcut: true,
		shortcutName: 'three.ws Desktop',
		artifactName: 'three.ws-Desktop-${version}-win-${arch}-setup.${ext}',
		differentialPackage: true,
	},
	portable: {
		artifactName: 'three.ws-Desktop-${version}-win-${arch}-portable.${ext}',
	},
	linux: {
		icon: 'build/icon.png',
		category: 'Utility',
		target: [
			{ target: 'AppImage', arch: ['x64'] },
			{ target: 'deb', arch: ['x64'] },
		],
		maintainer: 'three.ws <support@three.ws>',
		vendor: 'three.ws',
		synopsis: 'Operate your three.ws agents from the desktop',
		description: 'Sign in, chat with your agents, follow runs step by step, approve what they want to spend, and wire three.ws into every coding client on the machine.',
		executableName: 'three-ws-desktop',
		desktop: { StartupWMClass: 'three.ws Desktop' },
	},
	deb: {
		packageName: 'three-ws-desktop',
		depends: ['libnotify4', 'libxtst6', 'libnss3', 'libsecret-1-0'],
	},
};
