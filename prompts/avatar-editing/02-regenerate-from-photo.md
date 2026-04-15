# Task 02 — Regenerate avatar from a new photo

## Why this exists

Selfies age. Haircuts change. Users want to refresh their avatar without losing their agent identity, slug, followers, or action history. This task lets an owner retake their selfie and replace the model while keeping the agent id stable.

## Files you own

- Edit: `public/agent/index.html` (owner-only panel) — add a "Regenerate from new photo" button near the existing edit links. Grep for `agent-embed-preview` to find the right region, then add a sibling control.
- Create: `src/editor/regenerate-panel.js` — mounts a modal with `CameraCapture` (task 01 of band 2) and the selected pipeline.
- Reuse: `src/onboarding/pipeline-selector.js`, `AvaturnPipeline`, `RpmPipeline`, the commit helper.

Do not modify the onboarding flow page; this is a drop-in elsewhere.

## Deliverable

### Owner-only control

Only renders when the current viewer is the agent owner. Use whatever ownership check the existing agent page uses (grep for `isOwner`). Do not invent a new one.

Label: `📷 Regenerate from new photo`. Click opens the modal.

### Modal flow

1. Confirm step: "This will replace your avatar. Your agent identity, memories, and action history stay the same. Continue?"
2. Camera capture (same component as band 2 task 01).
3. Pipeline run (same pipelines).
4. Preview step: side-by-side old vs new in two `<model-viewer>` frames at equal size. Two buttons: `Keep old` / `Use new`.
5. On `Use new`: upload the new GLB via the save path from task 01, bump the avatar version, close the modal, refresh the viewer.

### Server side

No new endpoints required if task 01's save path is in place — regenerate is just a save where the client produces the GLB from the pipeline instead of from editor mutations.

Record an analytics event: `{ kind: 'agent_regenerated', agentId, source: 'selfie' }`.

## Constraints

- The agent id, slug, wallet link, and action history must not change. Only `model_url` / version.
- The user must explicitly click `Use new`. No auto-commit.
- Keep the previous version accessible — task 04 covers history UI, but the bytes must be preserved now (don't hard-delete).
- Don't surface this on pages where the viewer is embedded (iframes). Owner-only, and only on the canonical page.

## Acceptance test

1. `node --check src/editor/regenerate-panel.js` passes.
2. Owner clicks regenerate → modal → selfie → new avatar → preview → `Use new` → viewer shows new model. URL slug unchanged.
3. Non-owner viewing the same page: button absent.
4. Clicking `Keep old` discards the new GLB and cleans up without a DB write.
5. Agent's `actions` feed still shows prior events after regenerate.

## Reporting

- Whether the old GLB was retained (it must be, for task 04 rollback).
- Any visual glitches when swapping `src` on `<model-viewer>` mid-session.
- How the owner check was performed and whether it leaked any info to non-owners.
