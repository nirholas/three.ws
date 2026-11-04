# Microsoft Edge Add-ons: store listing copy

Program: Microsoft Edge Add-ons (Partner Center, Microsoft Edge, Store listings).
Build and submission steps: [`extensions/EDGE.md`](../../../../extensions/EDGE.md). This file holds only the text to paste in step 5 ("Store listings").
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
