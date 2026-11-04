# Publishing to Microsoft Edge Add-ons

Both extensions are Manifest V3 and run on Edge unchanged. Edge Add-ons accepts the same package format as the Chrome Web Store.

## Build the packages

```bash
npm run package:edge
```

This runs [`scripts/package-edge-addons.mjs`](../scripts/package-edge-addons.mjs), which:

1. Regenerates the Walk Avatar icons and runs the production esbuild bundle (minified, no source maps).
2. Stages the Checkout Companion runtime files (it has no bundler; Markdown docs are left out of the package).
3. Checks each `manifest.json` against what Edge rejects: `manifest_version` is 3, no `update_url` (Edge hosts updates itself), no pinned `key`, name, version and description present, and the 16, 48 and 128 pixel icons exist.
4. Writes the zips, with `manifest.json` at the zip root:

| Zip | Source |
| --- | --- |
| `dist/edge/three-ws-walk-avatar-<version>.zip` | [`walk-avatar/`](walk-avatar/README.md), version stamped from `package.json` |
| `dist/edge/three-ws-checkout-companion-<version>.zip` | [`checkout-companion/`](checkout-companion/README.md), version from its own manifest |

`dist/` is git-ignored. Rebuild before every submission and bump the version first: Edge rejects a zip whose version is not higher than the published one.

## Edge compatibility review

Reviewed 2026-11-04. Nothing needed changing.

- Neither manifest sets `update_url`, `key`, `externally_connectable`, `oauth2`, `sidePanel`, `identity` or any other Chrome-only field.
- `minimum_chrome_version` is accepted by Edge (it is Chromium) and keeps Chromium 109 as the floor, which matches current Edge.
- Permissions used: Walk Avatar `storage`, `activeTab`, `scripting`, `tabs` and host access to `<all_urls>`; Checkout Companion `storage` and host access to `https://three.ws/*` plus a content script on `http://*/*` and `https://*/*`. All are supported on Edge. Justifications are in each extension's `PERMISSIONS.md`.
- The Chrome Web Store has its own listing, assets and review. This file only covers Edge.

## Submit in Partner Center (owner steps)

1. Sign in at <https://partner.microsoft.com/dashboard/microsoftedge/overview> with the same Microsoft account as the Marketplace publisher profile. First time only: register as an Edge extension developer (free) and accept the Microsoft Edge Add-ons Developer Agreement.
2. Select **Create new extension** and upload the zip. Repeat for the second extension.
3. **Availability:** public, all markets, visibility "Public" (or "Hidden" first to test the listing).
4. **Properties:** category Productivity for both. Privacy policy URL:
   - Walk Avatar: `https://three.ws/extension/privacy`
   - Checkout Companion: `https://github.com/nirholas/three.ws/blob/main/extensions/checkout-companion/PRIVACY.md` (no hosted page exists yet; publishing one at a three.ws URL is the better final answer).
   - Website URL: `https://three.ws`. Support contact: `https://three.ws/support` or `support@three.ws`.
5. **Store listings (English):** paste the copy from [`marketing/growth/submissions/programs/microsoft-edge-and-store.md`](../marketing/growth/submissions/programs/microsoft-edge-and-store.md). Upload the store icon (300 x 300 PNG is requested by Edge; the 128 pixel icon is the minimum accepted) and screenshots (1280 x 800 or 640 x 400, up to 6).
   - Walk Avatar: five ready screenshots in [`walk-avatar/store-assets/`](walk-avatar/store-assets) (1280 x 800), plus `promo-tile-440x280.png` for the small promotional tile.
   - Checkout Companion: no screenshots exist yet. Capture them from the real extension on a real checkout page before submitting (Edge requires at least one).
6. **Notes for certification:** paste the per-permission justifications from `PERMISSIONS.md`. State that Walk Avatar injects only on a tab where the user toggles it on, and that Checkout Companion reads nothing on a page that fails its local checkout check and never reads form fields. Provide a test account if a reviewer needs to sign in to see "My Avatars" (the Featured avatars load without sign-in).
7. **Publish.** Certification usually takes a few business days. Fix any rejection reason and resubmit with a higher version.

## After approval

Add the Edge Add-ons URLs to [`data/listings.json`](../data/listings.json) and the listings docs, and update [`docs/microsoft.md`](../docs/microsoft.md).
