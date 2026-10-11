# App Review risk for three.ws on iOS

Written before submission, from Apple's published App Review Guidelines. Every
claim here is about a rule, not a prediction; where a rule is ambiguous that is
said plainly. Re-read it before changing anything in `capacitor.config.ts`, the
entitlements, or the crypto surfaces, because those are the three places where a
small change flips a version-1 approval into a rejection.

The short version: **the code is not the long pole. The account type and the
crypto surfaces are.**

## 1. Guideline 3.1.5(b) and 3.1.1: crypto. The real gate.

Apple's rules for cryptocurrency, in the order they bite:

**Wallets are organization-only.** Apps may facilitate virtual currency storage
"provided they are offered by developers enrolled as an organization." three.ws
gives every agent a wallet and every user a way to hold and move value, so an
**Individual** Apple Developer account cannot ship it. Enrolling as an
organization requires a legal entity and a D-U-N-S number, and the D-U-N-S
lookup or request is the step that most often takes a week or more. **Start this
before anything else; nothing downstream can be compressed to make up for it.**

**Exchange functionality is licensing-gated.** Apps may facilitate
cryptocurrency transactions "on an approved exchange, provided they are offered
only in countries or regions where the app has appropriate licensing and
permissions." three.ws's swap, trade and pump.fun launch surfaces are the
exposure here. Submitting version 1 with in-app token launching and trading
invites a rejection that asks for licensing documentation we do not have.

**Unlocking features with crypto is prohibited.** Anything on the platform where
paying in $THREE, USDC or an x402 call unlocks app functionality collides with
3.1.1: digital content and features consumed in the app must use in-app
purchase. Reading data, viewing holdings and viewing an agent's on-chain history
are fine. Buying a generation credit with USDC inside the app is not.

**What that implies for version 1.** Ship the creation and spatial product, and
route the value-moving surfaces to Safari rather than removing them:

| Ships in the app | Opens in Safari |
|---|---|
| `/create`, the forge, avatar and model generation | Trading, swaps, bridges |
| `/ar`, `/ar/studio`, `/irl`, the viewer, Quick Look | Coin launching |
| Agent profiles, `/marketplace` browsing, `/community`, `/feed` | Buying credits, paid generations, skills and assets |
| Talk mode, animation, rigging, exports, free trials | Subscriptions and the Pro plan |
| Wallet and portfolio views, deposits, withdrawals, claims | x402 payment flows, tips, donations |

**How the app does it: a signed-in hop to real Safari.** Implemented in
[`../src/native-bridge.js`](../src/native-bridge.js) (the client),
[`../../api/auth/handoff.js`](../../api/auth/handoff.js) (the server) and
`openInSafari` in
[`../native/App/App/ThreeWsAppPlugin.swift`](../native/App/App/ThreeWsAppPlugin.swift).

1. A value-moving step starts in the app: a link to a payment page, a Buy or
   Launch button, the agreements gate for a trade.
2. The app shows a sheet, "Continue in Safari", that says why. Nothing has
   been spent.
3. On **Open in Safari**, the app asks `POST /api/auth/handoff` for a code
   bound to the current session and the page the visitor was on. The code is
   single-use, lives 60 seconds, and only its SHA-256 is stored.
4. The app opens `https://three.ws/api/auth/handoff?code=...` in **Safari
   itself** (`UIApplication.shared.open`), not an in-app sheet. The exchange
   consumes the code in the same statement that checks it, sets a fresh
   session cookie in Safari's jar, and redirects to the original page.

Two details are load-bearing:

- **Real Safari, not `SFSafariViewController`.** Guideline 3.1.1 is about where
  the purchase happens. A Safari sheet presented over the app is still the app
  to a reviewer; leaving for Safari is the documented pattern.
- **The hop always goes through `/api/auth/handoff`, even signed out.** The
  apple-app-site-association claims every three.ws path except `/api/*`, so
  opening a plain `https://three.ws/launch` from the app would be routed
  straight back into the app by universal links. The code-less form of the URL
  is a plain redirect to the page, and the Swift side refuses any URL that is
  not that endpoint.

**What leaves the app**, decided in one place each:

| Where | Rule |
|---|---|
| Links to a payment page | `HANDOFF_EXACT` and `HANDOFF_SUBTREES` in `native-bridge.js`: `/launch` and everything under it, `/launcher`, `/launchpad`, `/three-launchpad`, `/launch-studio`, `/pay`, `/payments`, `/credits`, `/vault`, `/vaults`, `/autopilot`, `/markets/robinhood/desk`. Opening one directly (a deep link, a push) shows the sheet with **Go back**. |
| The agreements gate (`ensureRiskAck`) | Every context hands off except the wallet custody steps that guideline 3.1.5(b) allows an organization app to offer: `withdraw`, `deposit`, `claim`, `fund-agent`, `master-send`, plus the agreements page itself. Trading, launching, swaps, x402 payments, onramp, donations (guideline 3.2.2) and any context added later hand off by default. |
| Purchases that skip the gate | `leaveAppForPayment()` in [`../../src/shared/native-handoff.js`](../../src/shared/native-handoff.js), called first thing by skill, asset, time-pass and subscription purchases, credit deposits, forge pay-per-use, agent tips, coin buys in the game, x402 payments, and the Pro upgrade on `/pricing` and `/x-pricing`. |

Deliberately NOT handed off: `/wallet` and `/agent-wallet` (wallet storage and
viewing are allowed from an organization account, and they are the two
most-used surfaces), `/launches` (a directory that only shows launches), and
`/pay/simulator` (a dry run that spends nothing). Free actions, such as a skill
trial, stay in the app.

To add a surface: a new payment page goes in `HANDOFF_EXACT`; a new paid flow
calls `leaveAppForPayment()` before it does anything else; a new risk-ack
context hands off automatically unless it is added to `IN_APP_CONTEXTS`, which
should only ever hold custody steps. `tests/ios-safari-handoff.test.js` and
`tests/auth-handoff.test.js` pin both halves.

**Residual risks, stated plainly.**

- **Linking out to buy a subscription.** Since the 2025 US court ruling, apps on
  the **US storefront** may link to an external purchase without the External
  Purchase Link Entitlement. Outside the US the rules are per-region and
  stricter. Release version 1 on the US storefront first and add regions after
  reading the current rules for each.
- **Token-gated features.** `ensureFeatureAccess` in `src/three/access.js`
  (unlocking features by holding $THREE) has no callers today. If it is ever
  wired to a surface inside the app, it is a 3.1.1 problem: unlocking app
  features with crypto is prohibited. Route it through `requireSafari` or keep
  it web-only.

## 2. Guideline 4.2: minimum functionality.

A WebView pointed at a website is rejected as "a bookmark." The mitigation is
that the app does things the website cannot, and that they are visible in the
first minute of use. What is already in place:

- Camera, microphone, photo library, location and motion, each behind a real
  system permission prompt with a real usage string.
- The native share sheet, replacing a Web Share API that does not exist in
  WKWebView.
- Universal links: a shared `/viewer` or `/irl/s/` link opens the app.
- Wallet deep links back into the app via `threews://`.
- A designed offline screen that recovers on its own.
- Haptics.

Beyond those, the app now carries the native features that move 4.2 from
defensible to comfortable, each one something the website cannot do:

1. **A Share Extension** (`ws.three.app.share`). Share a photo from Photos or a
   GLB from Files and it lands in avatar creation or the library.
2. **A WidgetKit widget** (`ws.three.app.glance`). Your agent on the home
   screen in three sizes, refreshed from the API.
3. **Push notifications**, from the app delegate through the device endpoint
   to the notification fan-out, with the icon badge kept in sync. They go live
   the moment the APNs key in `SUBMISSION.md` step 3b is set.
4. **Home screen quick actions** that land on live pages.

`npm run check:ios-app` verifies every one of them is wired end to end. Point
the reviewer at the share sheet and the widget in the review notes
([`../publish/listing.md`](../publish/listing.md)); a reviewer who never sees
them judges the app as a WebView.

Edge-swipe back navigation, added in `MainViewController.swift`, is not a 4.2
credit on its own, but its absence is a reliable rejection *and* a reliable
one-star review: `WKWebView` ships with the gesture off and iOS has no back
button, so without it a visitor who follows one link has no way out of the app
except killing it.

## 3. Guideline 5.1.1: permissions and account deletion.

- Every usage string in `Info.plist` says what the data is for in the user's
  terms. Requesting a permission the app never uses is itself a rejection, so
  do not add usage strings speculatively.
- **Account deletion is reachable in-app.** `/settings`, Danger Zone tab,
  **Delete my account**, confirmed by typing the phrase (`DELETE /api/auth/me`).
  From the user's side it is final: every avatar, agent and widget is taken
  down, the handle is released, every session and refresh token is revoked,
  household access is removed, and no sign-in path (password, wallet, SSO)
  will open the account again. The user row itself is kept as a tombstone with
  its email, so a wallet or SSO sign-in answers `account_deleted` instead of
  quietly creating a fresh account for the same person. Guideline 5.1.1(v)
  allows keeping data for a stated reason. The privacy policy
  (`/legal/privacy`, section 5) promises deleted accounts are purged after 30
  days, and no job does that purge today (`api/cron/db-retention.js` does not
  touch `users`). Close that gap before submitting, either with a purge job or
  by rewording section 5 to describe the tombstone, because a policy that
  promises a deletion the system never performs is the finding to avoid.
  Reviewers test deletion by hand; walk it on the review build with a
  throwaway account.
- **Sign in with Apple (guideline 4.8).** The login page offers GitHub and X
  next to three.ws's own email sign-in. 4.8 asks an app that uses a third-party
  login to also offer one that limits collection to name and email, lets the
  user keep their email private, and does no ad tracking. three.ws's own email
  account is the equivalent we point to: it asks for an email and a password
  and nothing else, and three.ws does no ad tracking. If a reviewer reads email
  sign-in as not meeting the "keep your email private" part, the remedy is
  adding Sign in with Apple to `/login`, which needs a Services ID from the
  same Developer account and is a small, contained change.

## 4. Guideline 2.5.1 and 4.7: WebView posture.

`limitsNavigationsToAppBoundDomains` is `false` in `capacitor.config.ts`,
which is required because the app navigates to wallet and OAuth domains.
`server.allowNavigation` is restricted to three.ws hosts, so anything else goes
through the Safari sheet rather than the app's WebView. Keep it that way:
running third-party sign-in inside an embedded WebView is both a review problem
and a security one.

## 5. Service workers are off, and that is the current trade.

`limitsNavigationsToAppBoundDomains` is `false`, and `WKWebView` only runs
service workers for **app-bound domains**. So inside the app the site's service
worker never registers: no workbox precache, no offline page from
`public/offline.html`, no `share_target` interception. That is why the app
carries its own native offline screen (`shell/offline.html`, wired as
`server.errorPath`) rather than relying on the web one.

Flipping it is tempting and should not be done blind. Declaring
`WKAppBoundDomains` in `Info.plist` and setting the flag `true` would restore
service workers, and the app already keeps in-WebView navigation to three.ws
hosts with everything else going to the Safari sheet, so the restriction is
close to what the app does anyway. But the limit is ten domains, it cannot be
changed after install without an app update, and app-bound mode also constrains
the JavaScript-injection APIs that Capacitor's own bridge depends on. If it is
wrong, the app does not degrade: it does not work at all. Test it on a real
device before it ships, not after.

## 6. What is not a risk here.

- **AR.** ARKit Quick Look and WebXR usage are ordinary and uncontroversial.
- **User-generated 3D content.** Standard UGC moderation expectations apply
  (report, block, terms), and the platform already has moderation surfaces.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is `false` in
  `Info.plist`: HTTPS and platform crypto only, which is the exempt case.
