---
slug: avatar-humanik-sanitized-bone-names
title: Autodesk HumanIK rigs animate after three.js load, and the rig gates and Rig Doctor agree with the runtime
tier: P1
score: 38
area: avatar
sources: docs/aws-builder-center-universal-retargeting.md#9. Failure modes and the fallback ladder, docs/aws-builder-center-universal-retargeting.md#11. What we would build differently, marketing/growth/events/osf-issues/01-rig-humanik-sanitized-names.md
---

## Why this matters

three.ws plays one shared clip library on any humanoid by rewriting bone names to a canonical skeleton. Autodesk HumanIK / MotionBuilder / Maya rigs are the standard mocap skeleton, and they ship every joint as `Character1:Hips`. The raw glTF spelling maps, but three.js `GLTFLoader` runs node names through `PropertyBinding.sanitizeNodeName`, which deletes `:`, so the runtime retargeter sees `Character1Hips`, which maps to nothing. Such an avatar shows its bind pose with no animation and no explanation. The same article also records two sibling defects of the same class: gates that disagree with each other (bone-count gate versus clip-coverage gate) and diagnostics that disagree with the runtime (Rig Doctor).

## Current state (measured by the reviewer on 2026-11-03)

- `node --input-type=module -e "import {canonicalizeBoneName as c} from './src/glb-canonicalize.js'; console.log(c('Character1Hips'), c('Character1LeftArm'))"` prints `null null`. `Character1:Hips` maps.
- Already shipped (do not redo): 3ds Max Biped fingers and toes, Source engine `ValveBiped` skeletons (commit 638a7f687, tests in `tests/glb-canonicalize.test.js` lines ~262-340).
- `src/glb-canonicalize.js` `_lookupBone` strips a leading `identifier:` namespace first (comment block near line 460), then vendor prefixes (`mixamorig`, `CH_`, `CC_Base_`, `Bip01`).
- `src/animation-retarget.js` `canonicalBoneEntries` calls `canonicalizeBoneName(node.name)` on loaded (sanitized) names. `retargetClipToRig` (line ~832) and `retargetClipToObject` (line ~878) each assemble their own inputs; the article records that `retargetClipToRig` once missed the A-pose rest directions.
- `src/rig-report.js` is Rig Doctor's fingerprinter (`character-namespaced joints (Character1:Hips)` at line ~139); the article says Rig Doctor does not use the clavicle/upper-arm resolver the runtime uses.
- `marketing/growth/events/osf-issues/01-rig-humanik-sanitized-names.md` is a ready-written issue body with acceptance criteria.

## Step 0: re-derive the current state

```
node --input-type=module -e "
import { canonicalizeBoneName as c } from './src/glb-canonicalize.js';
for (const n of ['Character1:Hips','Character1Hips','Character1LeftArm','Character1_Hips','Character2Hips','Character1LeftHandIndex1','CharacterMesh']) console.log(n,'->',c(n));
"
grep -n "Character1" tests/glb-canonicalize.test.js | head
sed -n 825,880p src/animation-retarget.js
grep -n "resolveArmShoulderCollisions\|canonicalBoneEntries" src/rig-report.js src/rig-doctor-page.js
grep -rn "coverage" src/animation-retarget.js | head
npx vitest run tests/glb-canonicalize.test.js tests/rig-report.test.js
```

Skip any task below whose behavior already holds.

## Tasks

1. Test first: in `tests/glb-canonicalize.test.js`, next to the existing HumanIK block, add `it.each` tables for the fused form (`Character1Hips`, `Character1Spine`, `Character1Neck`, `Character1Head`, arm, forearm, hand, up-leg, leg, foot, toe joints, both sides), the underscore form (`Character1_LeftArm`), another character number (`Character2Hips`), and fingers (`Character1LeftHandIndex1` to `LeftHandIndex1`, thumbs included). Add a negative case: `CharacterMesh` and `Character` without digits still return `null`. Add a never-crosses-sides test. Run and confirm the new cases fail for the stated reason.
2. Fix `_lookupBone` in `src/glb-canonicalize.js`: strip a leading `Character<digits>` prefix in its fused and `_` forms, next to the existing vendor-prefix strips, with a comment explaining why the fused form exists (the three.js node-name sanitizer). Require the digits. Rerun; all existing `Character1:` cases must still pass.
3. Runtime end-to-end test: add a case to the retarget tests (beside `tests/animation-retarget-rig-parity.test.js`) that builds a small skeleton named in the sanitized HumanIK spelling, loads it through the real `GLTFLoader` name path (or applies `PropertyBinding.sanitizeNodeName` to each name), and asserts the idle clip finds a home for at least the coverage floor of its tracks.
4. Make the gates agree: find the bone-count gate and the clip-coverage gate (grep `coverage` in `src/animation-retarget.js` and the callers that decide "fall back to default body"). Add a test that a rig which passes the bone-count gate but would map fewer tracks than the coverage floor is reported as unanimated rather than silently bind-posing, and make the gate decide on what the library would actually do (would any clip clear coverage). Keep the change minimal and covered by a test.
5. Rig Doctor parity: make `src/rig-report.js` report the same collision/resolution outcome the runtime computes (use the same `resolveArmShoulderCollisions`), so a Rigify rig no longer reports a collision the runtime resolves. Test in `tests/rig-report.test.js`. Add a HumanIK fingerprint line that recognises both `Character1:` and `Character1` spellings.
6. Entry-point parity: confirm `retargetClipToObject`, `retargetClipToRig` and the manager path pass identical rest-direction inputs for an A-posed rig; extend the parity test to cover them if it does not.
7. Docs: update the HumanIK row in `docs/3d-asset-pipeline.md` (line ~209) and remove the "not supported yet" line from `docs/first-contribution.md` (the three open items shrink to none; leave it consistent with Biped and ValveBiped being done). Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

- [ ] The Step 0 node snippet prints canonical names for every `Character1Hips`-style input and `null` for `CharacterMesh`.
- [ ] `npx vitest run tests/glb-canonicalize.test.js tests/rig-report.test.js tests/animation-retarget-rig-parity.test.js` passes, and the new HumanIK cases were observed failing before the fix.
- [ ] Rig Doctor (`/rig-doctor`) on a HumanIK-spelled GLB shows the same mapped-bone count the runtime reports; checked in a real browser.
- [ ] `docs/first-contribution.md` no longer lists HumanIK, Biped fingers or Source skeletons as open.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No HumanIK GLB fixture | Build a synthetic skeleton in the test from the canonical bone list, renamed `Character1<Bone>`, as the existing convention tests do. Do not commit a third-party model. |
| Coverage-gate change touches many callers | Change only the decision function; keep callers' signatures; prove with the parity tests. |
