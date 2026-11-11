# Manual accessibility walkthroughs

Evidence behind the manual rows of the [Accessibility Conformance Report](acr.md). Run on 2026-11-11 against version 1.5.2 on a local dev server (`http://localhost:3112`, API proxied to production so every page renders real data). The automated half is in [reports/axe-latest.md](reports/axe-latest.md).

## Scope

The 18 page types in the ACR: `/`, `/start`, `/agi`, `/discover`, `/sign-language`, `/everything`, `/prompts`, `/create`, `/genesis`, `/create-agent`, `/create/prompt`, `/image-to-3d`, `/login`, `/microsoft/activate`, `/microsoft/teams-tab`, `/forge`, an agent profile (`/agents/{id}`) and the agent embed (`/agent/{id}/embed`).

## Tools

| Check | Tool |
| --- | --- |
| Keyboard order, focus visibility, traps, focus hidden under sticky bars, reflow, text spacing, forced colours | [scripts/a11y-manual-probe.mjs](../../scripts/a11y-manual-probe.mjs) (Playwright, Chromium 145). Output: [reports/manual-probe.json](reports/manual-probe.json). Every flagged item was then checked by eye on a screenshot. |
| Screen reader | Orca 46.1 (GNOME, AT-SPI) with Chromium 145.0.7632.6 on Linux, under Xvfb with the Openbox window manager. Orca's speech was captured from its debug log, so the transcripts below are exactly what Orca would have spoken. |
| Zoom | Chromium at 200% and 400% (CSS viewports of 640px and 320px from a 1280px window). |
| Forced colours | Chromium `forced-colors: active` emulation, the same mode Windows High Contrast triggers. |

Run the probe again with `node scripts/a11y-manual-probe.mjs` (dev server on port 3112), or a subset with `--only /login,/forge`.

## Keyboard-only walkthrough

Every page was walked with Tab and Shift+Tab for up to 60 stops.

| Result on the final run | Pages |
| --- | --- |
| No keyboard trap | All 18 |
| Skip link present and working | Every page with site navigation. `/` and `/start` are full-screen experiences with their own first stop ("Straight to the desktop"); the Teams tab and the embed have no site navigation to skip. |
| Focus never hidden under a sticky bar (2.4.11) | All 18 |
| No focusable element that is invisible | All 18 |
| Visible focus indicator | All 18. The probe reports four inputs (`/discover`, `/everything`, `/prompts`, `/create-agent`) where the ring is drawn on the input's wrapper rather than on the input itself; each was confirmed visible by screenshot in both themes. |

### What the walkthrough found and how it was fixed

| Finding | WCAG | Fix |
| --- | --- | --- |
| Collapsed nav menus kept their links in the Tab order, so focus disappeared into an invisible menu | 2.4.7 | `93069ace8` |
| Sign-in email and password fields had no 3:1 boundary and lost their focus ring under forced colours | 1.4.11, 2.4.7 | `0eda12d7e` |
| On `/prompts`, Shift+Tab scrolled focused filter buttons under the sticky toolbar | 2.4.11 | `92e53ed78`, with an e2e test |
| On `/agi` the injected skip link pointed at an id that did not exist | 2.4.1 | `5ee25d4a8`, with an e2e test |
| The home desktop had no main landmark | 1.3.1, 2.4.1 | `50d680f37`, with an e2e test |
| The prompt search, Genesis fields and create-agent inputs showed focus only as a faint glow | 2.4.7 | `e53d1b099` |
| The footer newsletter field's border was 1.3:1 against the footer | 1.4.11 | `1aa344dfa` |
| The avatar profile's Pause button and the Teams tab's not-yet-ready agent stage took focus while invisible | 2.4.7 | `7c0fa395c`, with an e2e test for the Pause button |
| The sign-language spell field showed focus only as a faint glow | 2.4.7 | `77bc5f09d` |
| The shared list search (`/discover` and other list pages) and the `/everything` search showed focus only as a 1px border change | 2.4.7 | `9443373b5` |

## Screen reader pass (Orca 46.1, Chromium 145)

Each page was loaded, focus was placed in the document, and Orca was driven from the keyboard with Tab, `h` (next heading), `d` (next landmark), `f` (next form field), `b` (next button) and `g` (next graphic). Excerpts below are Orca's own output, in order.

**`/login`.** Tab: "Skip to main content link." `d`: "banner", "navigation Primary", "main content". `f`: "Email address entry." Menus announce state: "Build collapsed push button."

**`/microsoft/activate`.** "Skip to content link.", "banner", "navigation Primary", "Build collapsed push button.", "main content", "Home link. / Pricing link. / Microsoft Marketplace.", `h`: "Activate a three.ws subscription heading level 1.", "How activation works heading level 2."

**`/forge`.** "main content", "Forge heading level 1.", "Fresh from the Forge heading level 2.", `f` in the footer: "Email address entry Enter your email required.", `b`: "Copy contract address.", "Getting started 0/3, 0 of 3 steps done. Open checklist. push button."

**`/microsoft/teams-tab`.** "search", "Search agents.", "region Selected agent", `g`: "Reeza, 3D avatar. A helpful, honest assistant. Focus and use the arrow keys to orbit, plus and minus to zoom. image.", "form Message the agent", "Push to talk push button.", "Send message push button.", `h`: "Reeza heading level 1.", "POPULAR AGENTS heading level 2."

**Agent profile.** `h`: "Risk Auditor 9 heading level 1.", "Similar agents heading level 2.", `g`: "Risk Auditor 9. Use mouse, touch or arrow keys to move. image.", "region WEARING".

**Agent embed.** The embed is one focusable 3D view: "Risk Auditor 9, 3D avatar. Tracks grant programs and surfaces opportunities for builders. Focus and use the arrow keys to orbit, plus and minus to zoom. image clickable." It has no heading on purpose: it renders inside other people's pages, which own the heading structure.

### Screen reader findings and related fixes

The first two rows were found during the Orca pass. The other three were found by the automated run and fixed before the Orca pass; the canvas names are audible in the transcripts above.

| Finding | WCAG | Fix |
| --- | --- | --- |
| Before anyone spoke, Orca announced "Agent is thinking statusbar" on the Teams tab and every embed, because the idle thought bubble was only faded out | 4.1.2 | `7c0fa395c`. The bubble now leaves the accessibility tree while idle and returns as a live status region while the agent works. E2E test added. |
| The embed had no landmark at all, so a screen reader user had no bypass route into it | 1.3.1, 2.4.1 | `487e916c1`, with an e2e test |
| Every 3D canvas was announced as an unnamed graphic | 1.1.1 | `61694fdec`. Each canvas now has a name, a description and the keyboard orbit instructions, as heard above. |
| Related agent cards announced the agent name twice | 1.3.1 | `3bf1a5bf9` |
| Agent creation steps were announced by number only | 1.3.1 | `ecb912859` |

## Zoom and reflow (1.4.4, 1.4.10)

At 200% (640px CSS viewport) and 400% (320px CSS viewport), no page scrolled horizontally and the probe found no clipped or overflowing content on any of the 18 pages. Wide data tables keep their own horizontal scroller, which 1.4.10 allows.

## Text spacing (1.4.12)

With line height 1.5, paragraph spacing 2em, letter spacing 0.12em and word spacing 0.16em injected, no text was clipped or overlapped on any page.

## Forced colours (1.4.11, 2.4.7)

Under `forced-colors: active`, every focus stop on every page still showed an indicator. No control relied on a box-shadow alone, which forced colours removes.

## Not covered

- Mobile screen readers (VoiceOver on iOS, TalkBack on Android) were not used in this pass. The 400px axe run and the 320px reflow check cover the layout, not the gestures.
- Windows screen readers (NVDA, JAWS) were not available on the evaluation machine. Orca uses the same ARIA semantics through AT-SPI, but announcements can differ in wording.
- Pages outside the 18 in scope, listed in the ACR notes.
