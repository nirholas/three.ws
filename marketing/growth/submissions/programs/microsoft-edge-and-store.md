# Microsoft Edge Add-ons and Microsoft Store: listing copy

Programs: Microsoft Edge Add-ons (Partner Center, Microsoft Edge, Store listings) for the two extensions, and the Microsoft Store (Partner Center, Apps and games) for three.ws itself as an installable Windows app.
Edge build and submission steps: [`extensions/EDGE.md`](../../../../extensions/EDGE.md). Store packaging steps: the [Microsoft Store (Windows app)](#microsoft-store-windows-app) section below. This file holds only the listing text and the steps that produce what the listing uploads.
Drafted: 2026-11-04. Nothing here has been submitted. Partner Center is behind sign-in, so the field limits below are the ones Microsoft publishes for Edge listings and were **not re-verified in the form**: a description needs at least 250 characters, and search terms allow up to 7 terms, 30 characters each, 21 words in total. If a field rejects the text, trim it rather than reword the claims.

## Rules applied to both listings

- **Name** comes from each `manifest.json` and is not typed in the listing: `three.ws Walk Avatar` and `three.ws Checkout Companion`.
- **Claims** are limited to what the extension code and its README describe. Each listing ends with a "Grounding" line naming the files that back it.
- **Wording:** no Microsoft partner tier or co-sell claim (see `docs/microsoft.md`, "Saying it correctly"). The $THREE token and the Solana agent economy are left out of Edge listing copy, the same rule as the other Microsoft submissions.
- **Privacy and support URLs** are in `extensions/EDGE.md` step 4.

---

## three.ws Walk Avatar

**Category:** Productivity

**Description**

```
Walk your three.ws 3D avatar on any website you visit.

Pick an avatar, turn it on for the tab you are reading, and it appears in the corner of the page as a living 3D companion. It can read the page aloud with a voice you choose, and it comes back by itself after a full page load on tabs where you enabled it.

What you can do:
- Choose from featured public avatars with no account, or sign in to three.ws to use your own avatars from "My Avatars".
- Turn it on per tab. Nothing is added to a page until you toggle it on for that tab.
- Drag the avatar anywhere on the page, mute its narration, or hide it on one page without turning the extension off.
- Set position, size, walking speed, theme and narration voice, and keep per-site allow and block lists, from the options page.

The avatar renders in a frame served from three.ws. The extension stores only its settings on your device, never collects the content of pages you visit, and does not sell or share data with third parties. Privacy policy: https://three.ws/extension/privacy
```

**Short description** (from the manifest, shown in search results)

```
Walk your three.ws avatar on any site and have it read pages aloud: a living 3D browsing companion.
```

**Search terms** (7)

```
3D avatar
browsing companion
read aloud
text to speech
virtual pet
animated character
page narration
```

**Assets:** five 1280 x 800 screenshots and the 440 x 280 promotional tile in [`extensions/walk-avatar/store-assets/`](../../../../extensions/walk-avatar/store-assets). Upload a 300 x 300 store logo (the 128 pixel icon in `extensions/walk-avatar/icons/` is the accepted minimum).

Grounding: `extensions/walk-avatar/manifest.json`, `extensions/walk-avatar/README.md` (Usage), `extensions/walk-avatar/PRIVACY.md`, `extensions/walk-avatar/PERMISSIONS.md`.

---

## three.ws Checkout Companion

**Category:** Productivity

**Description**

```
Your agent reads the checkout before you pay.

Checkout surprises are rarely hidden. They are just unread: a fee added on the last step, a free trial that turns into an annual charge, a cancellation window buried in a terms block. Checkout Companion reads the payment page for you and tells you in plain language what you are agreeing to.

On a page that looks like a checkout, and only there, it shows a small panel with:
- The total against the price you were shown, and the difference if they disagree.
- Money the page did not itemise, when the line items add up to less than the total.
- Whether the charge repeats: auto-renewal, trials that convert, introductory rates that change on renewal.
- The conditions: cancellation notice periods, non-refundable terms and pre-selected add-ons.

If something is worth stopping for, the panel opens itself and can say one line out loud. On an ordinary checkout it stays a single collapsed line.

It reads nothing on pages that fail its local checkout check, and it never reads form fields such as card numbers or addresses. Sign in at three.ws in the same browser, or paste a companion token from three.ws/companion into the options page.
```

**Short description** (from the manifest, shown in search results)

```
Your agent reads the checkout before you pay: what it really costs, whether it repeats, and what the fine print commits you to.
```

**Search terms** (7)

```
checkout
hidden fees
subscription trap
auto renewal
free trial
fine print
shopping assistant
```

**Assets:** no screenshots exist yet. Capture at least one from the real extension on a real checkout page before submitting (see `extensions/EDGE.md` step 5). Upload a 300 x 300 store logo (the 128 pixel icon in `extensions/checkout-companion/icons/` is the accepted minimum).

Grounding: `extensions/checkout-companion/manifest.json`, `extensions/checkout-companion/README.md` (What it does, Install), `extensions/checkout-companion/PRIVACY.md`, `extensions/checkout-companion/PERMISSIONS.md`.

---

## Microsoft Store (Windows app)

three.ws itself, packaged from the live web app manifest as an MSIX the Store installs like any Windows app. The installed app is the production site in its own window (title bar overlay, Start menu and taskbar entries), so it updates with every deploy and needs no store resubmission for web changes.

What the manifest already gives the Windows app, all served from `vite.config.js` (the VitePWA `manifest` block) at `https://three.ws/manifest.webmanifest`:

- Three jump-list shortcuts: Create Avatar, Marketplace, My Agents.
- A share target, so photos and GLB files shared from Windows land in the create flow.
- The **Agent glance** widget for the Windows 11 widgets board (`/api/glance/template` and `public/glance-sw.js`).
- A stable `id` (`/?source=pwa`) and the `window-controls-overlay` display mode.

### Steps

1. **Check the manifest** (no owner value needed). It fetches the live manifest and every icon, screenshot, shortcut and widget URL it names, then compares each PNG with its declared size:

   ```bash
   npm run package:microsoft-store -- --check
   ```

   On 2026-11-04 this caught production declaring 1280 x 800 for five screenshots that are 1440 x 900 (and one 1400 x 900). Installers drop screenshots whose size does not match. The source already declares the right sizes, so the check passes once the current `vite.config.js` is deployed.
2. **Reserve the name** (owner): Partner Center, Apps and games, New product, MSIX or PWA app, reserve `three.ws`.
3. **Copy the product identity** (owner): on the reserved app, Product management, Product identity. Note `Package/Identity/Name`, `Package/Identity/Publisher` (starts with `CN=`) and `Package/Properties/PublisherDisplayName`.
4. **Build the package**. The script repeats the checks, applies PWABuilder's package id, publisher and version rules, then calls PWABuilder's Windows packaging service. The service returns the Store upload bundle:
   - a `.msixbundle` for Windows 10 1903 and later
   - a classic `.appxbundle` for older builds
   - the two are versioned one apart, as the Store requires

   ```bash
   MS_STORE_PACKAGE_ID='<Package/Identity/Name>' \
   MS_STORE_PUBLISHER_CN='<Package/Identity/Publisher>' \
   MS_STORE_PUBLISHER_DISPLAY_NAME='<PublisherDisplayName>' \
   MS_STORE_APP_NAME='three.ws' \
   npm run package:microsoft-store
   ```

   The output goes to `dist/microsoft/three-ws-store/three-ws-store-<version>.zip`. `MS_STORE_VERSION` defaults to `1.0.1`; raise it for each later package.
5. **Submit** (owner): Packages (upload both bundles from the zip), Properties, Age ratings (the IARC questionnaire; three.ws has user-generated content and user-to-user chat), Store listings (the copy below), then Submit to the Store.

### Store listing

**Category:** Productivity. **Subcategory:** none. **Privacy policy:** https://three.ws/legal/privacy. **Support:** https://three.ws/support.

**Description**

```
three.ws gives your AI a body.

Create an AI agent with a 3D avatar, a voice and a persona, then talk to it, share it, or put it on any website. Turn a text prompt, a photo or a sketch into a textured 3D model you can view, place in augmented reality or download as GLB.

What you can do:
- Create a 3D avatar from a photo, from a text prompt, from scratch, or from a model file you already have.
- Generate standalone 3D models from text or images, with a choice of generation engines.
- Build an agent: give the avatar a persona, knowledge and skills, then chat with it in the browser.
- Browse the marketplace for agents, skills and avatars made by other creators.
- Embed any agent on your own site with one web component.

Made for Windows:
- Jump straight to Create, Marketplace or My Agents from the Start menu or taskbar.
- Share photos or GLB files to three.ws from any Windows app.
- Pin the Agent glance widget to the Windows 11 widgets board to see what your agent did today.

Creating models and agents is free and needs only a three.ws account, made with email or Google.
```

**Short description**

```
Create AI agents with a 3D body, voice and persona, and turn text or photos into 3D models.
```

**Product features** (up to 20, 200 characters each)

```
Create a 3D avatar from a photo, a text prompt or from scratch
Generate textured 3D models (GLB) from text, photos or a sketch
Give an agent a persona, knowledge and skills, then chat with it
Browse agents, skills and avatars in the marketplace
Embed an agent on any website with one web component
Agent glance widget for the Windows 11 widgets board
Share photos and GLB files to three.ws from any app
```

**Search terms** (7)

```
3D avatar
AI agent
text to 3D
3D model generator
GLB viewer
AI character
avatar creator
```

**What's new in this version**

```
First release of three.ws for Windows.
```

**Assets:**

- Screenshots: the five 1440 x 900 desktop captures in `public/screenshots/` (`landing`, `create`, `discover`, `studio`, `features`), which clear the 1366 x 768 minimum.
- Store logo: upload a 300 x 300 logo rendered from `public/pwa-512x512.png`. The tile images inside the package are generated from the same icon.

**Wording:** the same rules as the Edge listings above. There is no partner tier or co-sell claim. $THREE and the Solana agent economy stay out of the copy, because the Store's crypto content policy reviews them separately, and the app's core use does not depend on them.

Grounding: `vite.config.js` (VitePWA `manifest`), `data/pages.json` (`/create`, `/forge`, `/marketplace`, `/my-agents`), `public/glance-sw.js`, `api/glance/template.js`, `scripts/package-microsoft-store-pwa.mjs`.
