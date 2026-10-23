Remaining owner steps for the desktop agent runtime: the local runtime, keychain keystore, tray, native payload-hash approvals, mascot states, headless smoke test (`npm run smoke:runtime` in apps/desktop) and the Linux installers (`npm run dist:linux`, AppImage + deb in apps/desktop/dist) have shipped.

1. Provide the Apple Developer ID certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`) and notarization key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), then run `npm run release:mac` in apps/desktop.
2. Provide a Windows code-signing certificate and run `npm run dist:win` on a Windows runner or with wine.
3. Re-run `npm run smoke:runtime` from a network the pump.fun public feed answers (it returns 403 to some hosts, including this build machine), so the paper buy and open position checks run instead of printing SKIP.
