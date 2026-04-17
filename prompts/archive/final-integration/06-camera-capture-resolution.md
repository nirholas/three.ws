# 06 — Camera Capture Module: Resolve or Retire

## Context

[src/camera-capture.js](../../src/camera-capture.js) (321 LOC) is a substantial, well-written module for in-browser camera preview + photo capture. It was shipped by sprint-100 prompt 04 to power the selfie-to-agent flow. But the selfie pipeline landed with **a different module** — [src/selfie-capture.js](../../src/selfie-capture.js) — and `camera-capture.js` now has zero import sites.

This orphan is a liability: 321 LOC of code that must be maintained, imports `./camera-capture.css`, and ships in the bundle (even if tree-shaken, tool-chain incidents can resurrect it). Worse, two capture modules existing side-by-side is confusing for future contributors.

Your job: resolve the duplication. Either **delete** `camera-capture.js` cleanly, or **consolidate** both modules into one canonical implementation used by the selfie pipeline.

## Goal

Pick one of these two paths and execute it fully:

### Path A — Delete (recommended if selfie-capture.js is sufficient)

1. Read both files. Confirm `src/selfie-capture.js` covers every user-visible feature of `src/camera-capture.js`. If not, do not choose this path; fall through to Path B.
2. Delete `src/camera-capture.js` and `src/camera-capture.css`.
3. `git grep -n "camera-capture"` → every hit should be in a comment, doc, or gone. Remove stale references.
4. Update any docs that reference camera-capture (check `docs/`, `specs/`, `.github/skills/`).

### Path B — Consolidate

1. Identify the richer/better module. Likely `camera-capture.js` (has a cleaner `CameraCapture` class, SSR guard, aspect config).
2. Move its API into `src/selfie-capture.js` under the existing public surface the selfie pipeline expects, or vice versa — pick whichever disrupts fewer callers.
3. Delete the retired file + its CSS.
4. Verify `src/selfie-pipeline.js` still works end-to-end.

Either path: **only one camera capture module must exist at the end.**

## Files you own

Edit / delete:
- `src/camera-capture.js`
- `src/camera-capture.css`
- `src/selfie-capture.js` (only if you choose Path B and need to merge APIs)
- Any doc that currently references `camera-capture` — surgical fixes only.

## Files read-only

- `src/selfie-capture.js` (Path A) — verify feature parity before deletion.
- `src/selfie-pipeline.js` — understand how captures get consumed.
- `public/create/**` — any pages that invoke the selfie flow.
- `src/avatar-creator.js` — adjacent capture surface, do not edit.

## Feature parity checklist (Path A decision gate)

Before deleting `camera-capture.js`, confirm `selfie-capture.js` supports ALL of:

- [ ] Preview video element mounted into a caller-supplied container.
- [ ] Photo capture returning a `Blob` with `{ width, height, mimeType }` metadata.
- [ ] Cancel/dispose that releases the media stream.
- [ ] SSR-safe import (no `navigator` access at module top level).
- [ ] Configurable aspect ratio.
- [ ] Graceful fallback when `getUserMedia` is unavailable (browser denies permission, iOS Safari quirks, etc.).
- [ ] CSS scoped to its own namespace; no global leakage.

If any box is unchecked, either close the gap in `selfie-capture.js` as part of Path A (keep the delete) or switch to Path B.

## Technical requirements

- Keep ESM, tabs, 4-wide, single quotes.
- Run Prettier.
- `git grep -n "camera-capture"` returns zero code references at the end (docs/CHANGELOG references are fine as historical notes).
- `npm run build` succeeds with one less module in the bundle (or identical bundle if Path B just swapped names).

## Deliverables checklist

- [ ] Decision documented at top of your report: Path A or Path B + why.
- [ ] Feature parity table checked off (Path A) or migration diff summarized (Path B).
- [ ] Exactly one camera capture module exists after you finish.
- [ ] Every import site still resolves.
- [ ] No dangling CSS.
- [ ] Prettier pass.

## Acceptance

- `git grep -n "from.*camera-capture" src/ public/` returns zero hits (Path A) or one canonical import site (Path B).
- `node --check` passes on every remaining capture-related JS file.
- `npm run build` succeeds.
- Manual smoke at the create/selfie page: camera permission prompt still appears; capture still produces a usable blob that flows into the rest of the pipeline.

## Report + archive

Post the report block from `00-README.md`. Include:
- Path taken (A or B).
- Feature parity gaps found (if any) and how you closed them.
- Files deleted.
- Bundle size delta from `npm run build` before/after.

Then:

```bash
git mv prompts/final-integration/06-camera-capture-resolution.md prompts/archive/final-integration/06-camera-capture-resolution.md
```

Commit: `chore(capture): retire duplicate camera module` (Path A) or `refactor(capture): consolidate selfie + camera capture` (Path B).
