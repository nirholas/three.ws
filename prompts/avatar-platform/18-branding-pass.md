# Task: Global branding pass — scrub vendor names, apply project identity

## Context

Repo: `/workspaces/3D`. After task 01's initial rename, further vendor-branded identifiers may have leaked back in through vendored code (tasks 03, 09, 12, 13). This task is the hygiene pass that catches what task 01 missed and applies consistent project branding.

The project identity is TBD at the start of this task — confirm with the user before changing copy. Defaults assumed: **SperaxOS** (already in the agent panel header).

## Goal

1. No vendor names (Avaturn, CharacterStudio, TalkingHead, Kalidokit, MediaPipe, NextFace, Whisper, Piper, Kokoro, WebLLM) appear in user-visible copy, headers, buttons, or metadata.
2. Attribution stays in `NOTICES.md` files and an accessible credits page — which is fine per MIT/Apache licenses.
3. Favicon, manifest, OG image, page titles all reflect the project brand.
4. CSS class prefixes are consistent (no stray `avaturn-` / `talking-` / `kalido-` prefixes).

## Deliverable

1. **Copy audit** — grep user-facing strings for vendor names. Fix each:
   - `grep -ri "avaturn\|charactersudio\|talkinghead\|kalidokit\|mediapipe\|nextface\|whisper\|piper\|kokoro\|webllm" src/ public/ *.html` — triage each hit.
   - Code comments referencing libraries by name are fine. User-visible strings are not.
2. **CSS prefix scan** — every vendored or custom module should use one of: `agent-`, `editor-`, `capture-`, `mirror-`, `brand-`. No `avaturn-*`, no upstream-vendor prefixes.
3. **HTML metadata** — [index.html](../../index.html), [features.html](../../features.html), `m.html` (from task 06):
   - `<title>`.
   - `<meta name="description">`.
   - OG tags (title, description, image).
   - Favicon.
4. **PWA manifest** — [pwa-manifest.json / manifest.webmanifest](../../) references: name, short_name, description, theme_color, icons.
5. **Credits page** — new `credits.html` route. Lists every vendored dep (from NOTICE files), every asset author (from task 17's NOTICES), and every licensed package of note. Auto-generated ideally, but a hand-maintained version is acceptable.
6. **In-app "About"** — small "(i)" button in the editor/agent panel opens a modal linking to the credits page.
7. **Brand tokens** — extract the primary/accent/neutral colors into CSS variables at the top of [style.css](../../style.css) if not already. One source of truth for color.

## Audit checklist

- [ ] `grep -ri "avaturn" src/ public/ *.html style.css` → zero matches.
- [ ] `grep -ri "talkinghead\|kalidokit\|mediapipe\|nextface\|charactersudio"` in **user-visible strings only** → zero matches. Code imports/comments OK.
- [ ] Page title, favicon, OG image all consistent across `index.html`, `features.html`, `m.html`, `credits.html`.
- [ ] Credits page lists every vendored dep + asset author.
- [ ] "About" modal links to credits.
- [ ] No CSS class leaks a vendor name.
- [ ] Lighthouse SEO score ≥ 90 on the main page (title, description, favicon present).

## Constraints

- Do NOT rewrite any vendored code — just the wrappers / UI / copy around it.
- Do NOT remove NOTICE or license files — they are required by MIT/Apache.
- Do NOT claim authorship of vendored code. Attribution is required, just not in user-facing chrome.
- If the user hasn't confirmed a brand name, default to `SperaxOS` and flag for approval.

## Verification

1. Full grep pass → zero user-visible vendor leaks.
2. Open every route in incognito → correct title, favicon, OG preview (use a link-preview tool or Twitter card validator).
3. Credits page loads, lists expected attributions.
4. "About" modal works from both the agent panel and the editor panel.
5. Lighthouse SEO + accessibility audit clean.

## Scope boundaries — do NOT do these

- No new marketing copy beyond what's replaced.
- No logo redesign (assume the existing brand assets are correct; if none exist, use the placeholder and flag).
- No internationalization.
- No terms-of-service / privacy-policy authoring — separate legal task.

## Reporting

- List of strings changed (old → new) for reviewer's sanity check.
- Any vendor-named identifiers you left in code comments with justification.
- Screenshot of the credits page.
- Lighthouse SEO/a11y scores before and after.
- Any brand-token inconsistencies you found while auditing CSS.
