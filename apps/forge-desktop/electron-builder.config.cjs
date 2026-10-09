// electron-builder configuration for three.ws Forge.
//
// Targets: macOS arm64 .dmg and .zip, Windows NSIS installer, Linux .AppImage
// and .deb. Each build bundles a standalone CPython (resources/python-embed,
// fetched by scripts/download-python-embed.js for the target platform) that
// creates the local generation backend's virtualenv on first launch.
//
// Artifacts land in dist/ with the names apps/desktop/scripts/release-manifest.mjs
// classifies, and are published to the release bucket behind the three.ws CDN
// (https://three.ws/releases/forge/) by apps/forge-desktop/cloudbuild.yaml
// (Linux and Windows) and scripts/release-mac.sh (macOS). The runbook is
// docs/ops/forge-desktop-release.md.
//
// Signing follows three.ws Desktop: the Windows certificate and the Apple
// Developer ID come from Secret Manager when present. Without them the build is
// complete and installable, ad-hoc signed on macOS (scripts/after-pack.js) and
// unsigned on Windows.

const FEED_URL = process.env.THREE_WS_RELEASE_FEED || 'https://three.ws/releases/forge';

const macSigned = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const macNotarize = macSigned && Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER);

const pythonEmbed = [{ from: 'resources/python-embed', to: 'python-embed' }];

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'ws.three.forge',
  productName: 'three.ws Forge',
  copyright: 'Copyright three.ws. Based on Modly by Lightning Pixel (MIT).',
  artifactName: 'three.ws-Forge-${version}-${os}-${arch}.${ext}',
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/**/*', 'resources/icons/**/*'],
  extraResources: [
    {
      from: 'api',
      to: 'api',
      filter: ['**/*', '!.venv/**/*', '!venv/**/*', '!__pycache__/**/*', '!**/build/**/*', '!**/*.pyd', '!**/*.egg-info/**/*', '!**/test_*.py'],
    },
    { from: 'out/builtin-extensions', to: 'builtin-extensions' },
    { from: 'LICENSE', to: 'LICENSE' },
    { from: 'NOTICE', to: 'NOTICE' },
  ],
  // ad-hoc signs the macOS bundle when no Developer ID is configured
  afterPack: macSigned ? undefined : 'scripts/after-pack.js',
  // The generic provider is a static directory. electron-builder writes
  // latest.yml / latest-mac.yml / latest-linux.yml beside the artifacts and
  // bakes this URL into app-update.yml, which electron/main/updater.ts reads.
  publish: [{ provider: 'generic', url: FEED_URL, channel: 'latest' }],
  mac: {
    category: 'public.app-category.graphics-design',
    icon: 'resources/icons/icon.png',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    minimumSystemVersion: '12.0',
    identity: macSigned ? undefined : null,
    hardenedRuntime: macSigned,
    notarize: macNotarize,
    extraResources: pythonEmbed,
    extendInfo: { NSHumanReadableCopyright: 'three.ws. Based on Modly by Lightning Pixel (MIT).' },
  },
  dmg: {
    sign: false,
    writeUpdateInfo: false,
    title: 'three.ws Forge ${version}',
  },
  win: {
    icon: 'resources/icons/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
    publisherName: 'three.ws',
    extraResources: pythonEmbed,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'three.ws Forge',
    artifactName: 'three.ws-Forge-${version}-win-${arch}-setup.${ext}',
    differentialPackage: true,
  },
  linux: {
    icon: 'resources/icons/icon.png',
    category: 'Graphics',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    extraResources: pythonEmbed,
    executableName: 'three-ws-forge',
    maintainer: 'three.ws <support@three.ws>',
    vendor: 'three.ws',
    synopsis: 'Image-to-3D generation and mesh workflows on your machine or the three.ws cloud',
    description: 'Turn images and prompts into 3D models with local open-source generators or the three.ws Forge cloud, chain mesh processing in a node workflow editor, and publish the result to your three.ws account.',
    desktop: { StartupWMClass: 'three.ws Forge' },
  },
  deb: {
    packageName: 'three-ws-forge',
    depends: ['libnotify4', 'libxtst6', 'libnss3', 'libsecret-1-0'],
  },
};
