---
slug: three-hold-activate-worlds-private
title: Enforce private and branded worlds behind $THREE holding with a visibility column
tier: P2
score: 58
area: three
sources: docs/hold-to-access.md
---

## Why this matters

Hold-to-access is the $THREE demand lever. Tiers are advertised for private worlds and branded worlds, but the entitlements `worlds.private` and `worlds.branded` are still `enforced:false` in `api/_lib/three-access.js`, and `world_docs` has no `visibility` column, so holding $THREE unlocks nothing for worlds. The honesty test (`tests/three-tier-honesty.test.js`) keeps the UI truthful only while they stay unenforced.

## Current state (measured by the reviewer on 2026-11-03)

- `api/_lib/three-access.js`: `worlds.private`, `worlds.branded`, `mcp.priority`, `drops.early`, `names.first_dibs` all `enforced:false`.
- `world_docs` has no `visibility` column. `tests/world-private-gate.test.js` does not exist. Existing: `tests/three-tier-honesty.test.js`, `tests/forge-high-gate.test.js` (the model to copy).
- Backends: `api/world/[action].js` (`handleLoad`, `handleSave`), `api/_lib/world-store.js`; gate helpers `api/_lib/require-three.js`.

## Step 0: re-derive the current state

```
grep -n "enforced" api/_lib/three-access.js
grep -rn "visibility" api/_lib/world-store.js api/world | head
ls tests | grep -E "world-private|three-tier|forge-high"
sed -n 1,80p tests/forge-high-gate.test.js
```

## Tasks

1. Test first: create `tests/world-private-gate.test.js` modeled on `tests/forge-high-gate.test.js`: saving a world as private without holding the tier returns the structured gate error; loading a private world as a non-owner is 403/404; a holder can save and load; public worlds are unaffected.
2. Additive migration adding `visibility text not null default 'public'` (check constraint `public|unlisted|private`) to `world_docs`; backfill is the default.
3. Enforce in `handleSave` (requires the `worlds.private` tier to set private) and `handleLoad` (owner or explicit grant only for private; never leak existence). Branded worlds: gate the branding fields (custom skin/logo) with `worlds.branded` the same way.
4. Flip `enforced:true` for the two entitlements, update the UI tier copy and the world editor visibility control with hover/focus/active, loading skeleton, empty and error states, and a clear upgrade prompt showing the hold requirement pulled from the live tier config (no hardcoded amounts).
5. Keep `tests/three-tier-honesty.test.js` green; extend it to assert the doc and UI agree with the flags.
6. Update `docs/hold-to-access.md`, changelog entry.

## Definition of done

- [ ] `npx vitest run tests/world-private-gate.test.js tests/three-tier-honesty.test.js` passes.
- [ ] `grep -n "worlds.private\|worlds.branded" api/_lib/three-access.js` shows `enforced:true`.
- [ ] Browser: as a non-holder, setting a world private shows the upgrade prompt; as a holder (test wallet fixture), it saves and the world is hidden from a second session.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No holder wallet for the browser check | Use the existing test hook in `api/_lib/three-access.js` tests or a seeded entitlement as the forge-high gate tests do |
| Migration risk | Additive default column; read `npm run db:status` first |
