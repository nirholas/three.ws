# App pages

`/apps` is the hub for every way to run three.ws, with one page per platform. They are static pages sharing one stylesheet and one script.

| Path | Page | Status it states |
|---|---|---|
| `/apps` | [pages/apps.html](../pages/apps.html) | Hub of the five cards below |
| `/apps/web` | [pages/apps-web.html](../pages/apps-web.html) | The web desktop at `/`, live |
| `/apps/android` | [pages/apps-android.html](../pages/apps-android.html) | APK from the `v1.0.0` GitHub release; Play listing pending |
| `/apps/seeker` | [pages/apps-seeker.html](../pages/apps-seeker.html) | Live on the Solana dApp Store |
| `/apps/ios` | [pages/apps-ios.html](../pages/apps-ios.html) | Native build pending Apple enrollment; Safari and AR Quick Look work today |
| `/apps/desktop` | [pages/apps-desktop.html](../pages/apps-desktop.html) | Windows and Linux builds from the release feed |

Code: [src/apps.js](../src/apps.js), [src/apps.css](../src/apps.css). `/apps/desktop` reads `/releases/desktop/release.json` (published by `apps/desktop/cloudbuild.yaml`), offers the visitor's OS build, lists every file with its SHA-256, and takes minimum-OS lines from the feed. A missing feed shows run-from-source; a failed one shows a retry.

## Keeping them true

Each page states a real status. When a store listing goes live (Google Play, the App Store) or a build ships (macOS), update the status pill and the primary button on that page and the card on `/apps`, and add a changelog entry. Source docs: [seeker-app.md](seeker-app.md), [ios-app.md](ios-app.md), [desktop.md](desktop.md).
