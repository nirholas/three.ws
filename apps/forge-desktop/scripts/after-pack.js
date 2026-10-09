// @ts-check
// Ad-hoc signature for the macOS bundle.
//
// Without an Apple Developer ID the app can be neither Developer ID signed nor
// notarized. On Apple Silicon, though, a binary with NO signature at all
// refuses to launch (it is not just a Gatekeeper warning). An ad-hoc signature
// (`--sign -`) is free and lifts that block.
//
// This hook runs AFTER packaging and BEFORE the DMG is made, so the signature
// is embedded in the distributed app. Because `identity: null` turns off
// electron-builder's own signing, nothing overwrites it afterwards.
//
// The user still meets Gatekeeper on first launch ("unidentified developer"):
// right click > Open, or run `xattr -cr` on the app.

const path = require('path')
const { execFileSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  // Apple deprecates --deep for real signing, but it remains the standard way
  // to ad-hoc sign nested binaries recursively (Electron Framework, helpers).
  // A failure here must fail the build: an unsigned arm64 DMG does not launch,
  // and it is better to learn that at build time than on a user's machine.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })

  // Confirm the signature is in place and the app is judged valid.
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], {
    stdio: 'inherit'
  })

  console.log(`[after-pack] Ad-hoc signature applied: ${appPath}`)
}
