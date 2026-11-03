---
slug: avatar-animation-identity
title: Avatars carry a saved animation identity (idle, walk, gesture intensity, emote loadout) honored everywhere
tier: P3
score: 26
area: avatar
sources: specs/PARAMETRIC_AVATAR.md#Reserved, specs/AVATAR_PARAMETERS.md#Reserved, docs/avatar-studio.md
---

## Why this matters

Every avatar idles and walks the same way. Personality is the main thing that makes two parametric avatars with similar bodies feel like different characters, and the appearance schema already reserves `animation` for it ("default idle and walk, gesture intensity, mood blend, emote loadout", phase 7). Embeds, /play and the agent stage all choose animations in their own code, so the value must be saved on the avatar and read by one shared resolver.

## Current state (measured by the reviewer on 2026-11-03)

- `animation` is reserved in `specs/AVATAR_PARAMETERS.md` and `specs/PARAMETRIC_AVATAR.md`, not implemented in `api/_lib/validate.js` `avatarAppearance`.
- Animation sources: `/animations/manifest.json`, `src/idle-animation.js`, `src/animation-retarget.js`, `animation-sources/README.md`; the Studio's Walk tab drives an auto-walk.
- No shared per-avatar animation resolver exists (verify with grep in Step 0).

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
grep -n "animation" api/_lib/validate.js | head
grep -rn "idle\b.*manifest\|manifest.json" src/*.js | head -8 | cut -c1-150
ls public/animations | head; python3 -c "import json;d=json.load(open('public/animations/manifest.json'));print(len(d) if isinstance(d,list) else list(d)[:5])"
```

## Tasks

1. Spec: add the `animation` object to `specs/AVATAR_PARAMETERS.md`: `{ idle, walk, gestureIntensity (0..1), moodBlend, emotes: string[] (max 8) }` where clip ids reference `/animations/manifest.json` entries only. Validate with strict caps in `avatarAppearance` and reject unknown clip ids server-side against the manifest.
2. Pure resolver `src/avatar-animation-identity.js`: `resolveClip(appearance, intent)` mapping intents (`idle`, `walk`, `gesture`, `emote:<n>`) to clip ids with intensity scaling, falling back to the platform default when unset. Dependency-free; tested in `tests/avatar-animation-identity.test.js` (unset, partial, invalid id, intensity bounds, deterministic).
3. Wire into the runtimes that choose clips: `src/avatar-studio.js` (preview), the `<agent-3d>` element and the stage (`src/stage-element.js`, `src/stage.js`), and /play. Grep for the places that hard-code idle and walk clip names and replace them with the resolver.
4. Studio UI: an "Animation" tab with idle and walk pickers that preview on click, an intensity slider, and an emote loadout editor; designed empty/loading/error states, keyboard accessible, hover/focus/active states.
5. Save and load through the existing avatar PATCH route (`api/avatars/[id].js`) and verify the bake ignores the field safely (the bake must not depend on it; assert in `tests/avatar-bake.test.js`).
6. Docs, changelog, `npm run build:pages`.

## Definition of done

- [ ] `npx vitest run tests/avatar-animation-identity.test.js tests/avatar-bake.test.js` passes.
- [ ] PATCH of an avatar with an unknown clip id returns 400; a valid one persists and round-trips on GET.
- [ ] In a browser, an avatar saved with a non-default walk plays that walk in the Studio and in an `<agent-3d>` embed with zero console errors.
- [ ] `grep -rn "'idle'" src/stage*.js src/avatar-studio.js` shows no remaining hard-coded default that bypasses the resolver.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Manifest has few clips | Use what exists; the order does not add animation content (that is `animation-sources`' job) |
| Clip not present for a non-humanoid rig | Fall back to platform default per the resolver tests |
