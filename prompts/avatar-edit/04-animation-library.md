# Task: Animation library — list, attach, detach, preview clips on an avatar

## Context

Repo: `/workspaces/3D`. Animation handling is centralized in [src/animation-manager.js](../../src/animation-manager.js). It loads clips from `.glb` files (typically Mixamo exports), retargets them against the current model's skeleton, and crossfades between them. It already supports:

- `loadAnimation(name, url, { loop, clipName })`
- `setAnimationDefs(defs)` / `getAnimationDefs()` where `defs = [{ name, url, loop?, clipName? }]`
- `loadAll()` for batch load, `play(name)`, `crossfadeTo(name, duration)`, `getLoadedNames()`

What is missing:
1. A **persistent** list of which clips belong to an avatar — today `defs` are set per-session in code.
2. A dashboard UI to add/remove clips.
3. A preview mechanism where the dashboard can load the avatar + a candidate clip without touching the live `<agent-3d>` instance.

Clip metadata should live in `agent_identities.meta.animations` as `[{ name, url, loop, clipName?, source: 'mixamo'|'preset'|'custom', addedAt }]`. The GLB itself does **not** need to be re-pinned to IPFS unless the user attaches a clip from a non-resolvable URL and the avatar is already registered on-chain.

## Goal

Ship an animation-library panel in the dashboard that lists clips attached to the selected avatar, lets the user attach new clips (from a preset URL list or by uploading), detach existing ones, preview each in an isolated viewer, and persist the set on the agent record. No change to agentId, wallet link, or ERC-8004 record.

## Deliverable

1. **Backend**
   - No new endpoints if `PATCH /api/agents/:id` already accepts `meta` (it does, per [src/agent-identity.js](../../src/agent-identity.js)'s `save()` which posts `meta`). Confirm and document.
   - Validate `meta.animations` server-side — add to the agents-patch zod schema:
     - Array, max 30 entries.
     - Each entry: `name` (1–60 chars), `url` (valid URL, `http`/`https`/`ipfs`/`ar`), `loop` (boolean, default true), `clipName` (optional, ≤ 120 chars), `source` (enum).
     - Dedupe by `name` case-insensitively.
   - Optional: add `POST /api/animations/presign` delegating to the same R2 flow if users upload custom `.glb` clips. Scope key under `u/{userId}/animations/{slug}.glb`. Use `limits.upload(userId)`. If this endpoint already exists under a different name (e.g. generic R2 presign), reuse it — do not duplicate.

2. **Preset pack**
   - Ship a small curated list in a new JSON file `public/animations/presets.json` with 6–10 entries (idle, wave, nod, shrug, thinking, celebrate, typing, walking). URLs point to `.glb` files in `public/animations/`. Do **not** add the `.glb` binary files in this task — assume they're pre-existing or will be added by a separate content task. Document missing files in the reporting section.
   - Loader in the dashboard fetches `presets.json` and renders each as a one-click "add" tile.

3. **Frontend — dashboard animation panel**
   - New route: `#edit/<agentId>/animations` in [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).
   - Two columns:
     - Left: current clips (from the agent's `meta.animations`). Each row has name, source, loop toggle, preview button, detach button.
     - Right: add-new area — preset tiles + "upload custom `.glb`" button.
   - Preview: mount an isolated `<agent-3d>` (or a dedicated Viewer instance) in a small modal, load the avatar's current GLB, attach the candidate clip via `AnimationManager`, and play it. Crossfade back to idle when the modal closes.
   - Must not reuse the main app's viewer — create a scoped one so preview playback doesn't disturb a live session in another tab. Use the existing `<agent-3d>` web component with an `animations` attribute if it supports per-instance clip override; otherwise instantiate `Viewer` + `AnimationManager` directly.
   - Attach: updates local state, calls `PATCH /api/agents/:id` with the new `meta.animations` set. Debounce 500 ms so rapid toggles don't spam.
   - Detach: removes from the list; same PATCH.

4. **Client runtime integration**
   - When `<agent-3d>` boots (see [src/element.js](../../src/element.js)), after loading the GLB it should hydrate animations from `agent_identities.meta.animations` by calling `AnimationManager.setAnimationDefs()` + `loadAll()` already. Verify this path. If not wired, add it. Do not change its API.

## IPFS / on-chain re-pinning

- If the agent is **not** ERC-8004-registered (`agent_identities.erc8004_agent_id` is null): no IPFS re-pin needed. Clips are referenced by their `url` in the agent record.
- If the agent **is** registered: show a warning — "Your on-chain registration references a pinned manifest. Animation changes won't be visible on-chain until you re-pin." Offer a disabled "Re-pin manifest" button with a tooltip pointing to the onchain layer. Do not actually re-pin in this task.

## Audit checklist

- agentId unchanged on attach / detach.
- Wallet link unchanged.
- `meta.animations` array shape matches the schema above on every PATCH.
- Preview viewer is fully disposed on modal close (call `dispose()` — if the Viewer class doesn't have a full `dispose()` yet, see [prompts/scalability/01-dispose.md](../scalability/01-dispose.md). In the meantime, at minimum `clear()` the scene and `cancelAnimationFrame` the RAF, and remove the canvas from the DOM).
- Custom clip uploads land under `u/{userId}/animations/...` — no cross-user key collision.
- Duplicate names are rejected at the PATCH layer and surfaced inline.
- Loop toggle persists after refresh.
- Detaching a clip does **not** delete the R2 object (users may re-attach; deletion is a separate feature).
- If the avatar's GLB has no skeleton, the UI surfaces "This avatar has no skeleton — clips cannot be attached" and disables the panel.

## Constraints

- No new runtime dependencies.
- Do not modify `AnimationManager`'s public API surface.
- Do not refactor [src/animation-manager.js](../../src/animation-manager.js)'s retargeting logic.
- Keep preset JSON in `public/animations/presets.json` — static fetchable asset, no API endpoint.
- Dashboard native-DOM only. A small shared `<dialog>` modal helper is fine.
- Preview playback must not rebind the global `<agent-3d>` instance's animations.

## Verification

1. `node --check` every modified JS file.
2. `npx vite build`.
3. Manual:
   - Open dashboard → avatar card → "Animations".
   - Attach `wave` from presets. Confirm `agent_identities.meta.animations` has an entry. Confirm the preview modal plays the clip.
   - Detach. Confirm the entry is gone and R2 object is untouched.
   - Upload a custom `.glb` animation. Confirm it lands under `u/{userId}/animations/...`.
   - Attempt to attach two clips named `wave` — second fails with inline error.
   - Reload the main app / `<agent-3d>` → confirm `getAnimationDefs()` returns the hydrated list.
   - With an agent where `isRegistered` is true, confirm the re-pin warning shows.
4. Confirm agentId + wallet fields unchanged in the DB.
5. Close the preview modal mid-playback → confirm no AnimationMixer errors in the console, RAF cancelled.

## Scope boundaries — do NOT do these

- Do not build a timeline editor / keyframe editor.
- Do not add clip-to-clip crossfade UI (it already works at runtime — the dashboard only manages the set).
- Do not implement actual IPFS re-pinning. Warning UI only.
- Do not add "trigger this clip when the user says X" keyword rules. That's skills territory.
- Do not re-use the main app Viewer for preview.
- Do not add third-party clip marketplaces.

## Reporting

- Files created / edited.
- Whether `<agent-3d>` already hydrates `meta.animations`; if not, what you added.
- Any preset `.glb` files you noted as missing from `public/animations/`.
- Whether the `POST /api/animations/presign` endpoint existed or was added.
- `npx vite build` output.
- Any leak observed when preview modal closes (you should see none after dispose).
