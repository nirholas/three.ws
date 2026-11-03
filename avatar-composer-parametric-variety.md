---
slug: avatar-composer-parametric-variety
title: Avatar surprise composer produces body-shape variety and bone accessories on the parametric base
tier: P3
score: 28
area: avatar
sources: api/_lib/avatar-composer/README.md, specs/PARAMETRIC_AVATAR.md
---

## Why this matters

The "surprise me" composer (`api/avatars/surprise.js`, `api/_lib/avatar-composer/`) mixes parts only within the same group of the RPM bases, so every result has the same body build, and it cannot add hats, glasses or earrings. The Parametric base now has 306 morphs and a proportions solver, so the README's stated roadmap ("a parametric-body backbone") is already available: a seeded random appearance record on `parametric-base-v1` yields real variety, and bone-attached accessories already bake via `api/_lib/bake.js`. The composer should use them.

## Current state (measured by the reviewer on 2026-11-03)

- `api/_lib/avatar-composer/` has `select.js`, `parts.js`, `compose.js`; tests in `tests/avatar-composer.test.js`.
- README roadmap: cross-group mixing needs vertex rebinding; body shape needs real morphs "which the RPM bases don't carry"; bone-attached accessories are "a clean next add via the existing `api/_lib/bake.js` merge".
- Parametric base: `public/avatars/parametric-base.glb` (306 morphs), `src/avatar-proportions.js`, `api/_lib/bake-proportions.js`, `api/_lib/accessories.js`, garments catalog (58 items incl. 8 hair) at `gs://three-ws-garments/garments/catalog.json`.
- The README's roadmap text predates the parametric base and is stale.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
sed -n 1,80p api/_lib/avatar-composer/README.md
grep -n "parametric\|accessor\|proportion" api/_lib/avatar-composer/*.js api/avatars/surprise.js | head
npx vitest run tests/avatar-composer.test.js 2>&1 | tail -5
grep -n "export" api/_lib/accessories.js | head
```

## Tasks

1. Test-first: extend `tests/avatar-composer.test.js` (or add `tests/avatar-composer-parametric.test.js`): for 200 seeds the composer must produce valid `avatarAppearance` records (validated by `api/_lib/validate.js`), be deterministic per seed, and cover a spread of builds (assert the distribution of proportion values has a spread above a threshold).
2. Add a parametric mode in `api/_lib/avatar-composer/select.js`: a seeded generator choosing a coherent set of identity morphs (use slider group metadata from the base build, not hand-listed names), a proportions preset within safe ranges from `src/avatar-proportions.js`, skin tone, hair and outfit garments from the live catalog (fetch with the existing catalog cache in `api/_lib/bake-garments.js`), and 0 to 2 accessories from `api/_lib/accessories.js`.
3. Keep the legacy RPM mixing path behind an explicit `base` choice and make parametric the default for new surprises once the tests prove validity and bakeability (`isBakeable`).
4. Bake every generated record through `bakeAppearance` in the test for a sample of 10 seeds to prove none fails the VRAM and file ceilings.
5. Surface the choice in the UI where surprise is triggered (grep `surprise` in `src/` and `pages/`): a seed display so a result can be reproduced and shared, with empty, error and loading states.
6. Replace the stale roadmap in the README with the real remaining limits; update docs and changelog.

## Definition of done

- [ ] `npx vitest run tests/avatar-composer.test.js tests/avatar-composer-parametric.test.js` passes.
- [ ] 200-seed test shows determinism and spread; 10 sampled seeds bake successfully.
- [ ] `POST /api/avatars/surprise` (authenticated, locally) returns an appearance with `base: 'parametric-base-v1'` or the documented base field.
- [ ] README roadmap no longer claims body-shape variety needs an external backbone.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Catalog unreachable in CI | Read it once into a gitignored cache the same way the bake tests do |
| Random morphs look grotesque | Constrain sampling to per-slider safe ranges derived from the base metadata and add a regression test with the extremes |
