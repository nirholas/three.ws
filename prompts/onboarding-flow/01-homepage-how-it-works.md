# Task 01: Rewrite homepage "How It Works"

## Context

[index.html:110-129](../../index.html#L110-L129) currently shows a 3-step flow ("Drop your model → Animate & configure → Embed anywhere") that doesn't reflect how users actually get through the product. The real flow has a sign-in step, a persona/configure step, and on-chain is optional. See [00-README.md](./00-README.md) for the overall plan.

## Goal

Replace the 3-step "How It Works" section with **4 steps** that accurately describe the path from landing to embed. Keep the existing visual rhythm and `scroll-reveal` class pattern. Keep the section dark/light alternation.

## The 4 steps (exact copy)

**Step 01 — Sign in**
Connect your wallet or sign in with email. Your avatars, animations, and on-chain identities are saved to your account.

**Step 02 — Create your avatar**
Edit a default avatar in our web editor, or drop in your own GLB. Need a model? Try [Avaturn](https://avaturn.me) or [Mixamo](https://mixamo.com). *(Selfie-to-avatar — coming soon.)*

**Step 03 — Customize**
Name your agent, pick animations, add voice, and connect a brain. Save once, use everywhere.

**Step 04 — Embed anywhere**
Generate a widget — one iframe, any site. Works in Notion, Ghost, WordPress, and more. *Optionally claim an on-chain identity via ERC-8004.*

## Deliverable

1. Edit [index.html](../../index.html) section `#how-it-works` ([index.html:109-129](../../index.html#L109-L129)). Replace the 3 `.step` divs with 4 new ones containing the copy above.
2. Tweak the hero "Open viewer" ghost CTA copy ([index.html:66](../../index.html#L66)) to better signal the sandbox:
   - Current: `Open viewer`
   - New: `Try the viewer →` with `title="No sign-in needed — drop a GLB and play"` attribute
3. Update the `<meta name="description">` ([index.html:9](../../index.html#L9)) only if the old copy is now stale — otherwise leave it.
4. Verify the `.scroll-reveal` delays still stagger correctly (the JS at [index.html:246-266](../../index.html#L246-L266) picks up all `.scroll-reveal` siblings and assigns delays — no JS changes needed).

## Constraints

- **Do not** add new CSS classes. Reuse `.step`, `.step-num`, `.scroll-reveal`.
- **Do not** touch any section other than `#how-it-works` and the hero CTA copy.
- **Do not** add images, icons, or emoji to the steps.
- **Do not** create a new file — edit [index.html](../../index.html) in place.
- Prettier: tabs, 4-wide, single quotes. Run `npx prettier --write index.html` before reporting done.

## Verification

- [ ] `npm run build` passes
- [ ] Open `localhost:3000/`, the "How It Works" section shows 4 steps with the exact copy above
- [ ] The 4 steps animate in on scroll with staggered delay (0s, 0.1s, 0.2s, 0.3s)
- [ ] Hero "Try the viewer" CTA still links to `/app`
- [ ] `npx prettier --check index.html` passes

## Reporting

- Confirm the diff is *only* to the `#how-it-works` section and the hero ghost CTA.
- Screenshot or describe the rendered section.
- Any scroll-reveal delay weirdness (there shouldn't be any).
