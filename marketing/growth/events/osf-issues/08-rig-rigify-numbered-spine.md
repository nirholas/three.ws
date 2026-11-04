## Context

three.ws plays one shared animation library on any humanoid avatar by rewriting every bone name to one canonical skeleton. The map is [`src/glb-canonicalize.js`](https://github.com/nirholas/three.ws/blob/main/src/glb-canonicalize.js), and [Rig Doctor](https://three.ws/rig-doctor) ([`src/rig-report.js`](https://github.com/nirholas/three.ws/blob/main/src/rig-report.js)) names which convention an uploaded skeleton follows.

Blender's Rigify generates a deform skeleton whose trunk is one numbered chain: `DEF-spine` is the hips, `DEF-spine.001` to `DEF-spine.003` are the spine and chest, `DEF-spine.004` and `DEF-spine.005` are the neck, and `DEF-spine.006` is the head. The limbs (`DEF-upper_arm.L`, `DEF-forearm.L`, `DEF-thigh.L`, `DEF-shin.L`, `DEF-foot.L`) already map. The trunk does not, and it fails differently in the two spellings a rig is read in:

- **The raw glTF spelling** (what Rig Doctor and the capabilities API read) collapses all seven joints to `Spine`. Only one can bind, so the report overstates nothing but the rig has no `Hips`, `Neck` or `Head`.
- **The runtime spelling** (three.js names every node through `PropertyBinding.sanitizeNodeName`, which deletes the `.`) maps `DEF-spine` to `Spine` and drops `DEF-spine001` to `DEF-spine006` entirely.

Either way a Rigify character animates with no root motion, a rigid torso and a frozen head. There is also a side-chain collision: `DEF-shoulder.L` maps to `LeftArm`, the same target as `DEF-upper_arm.L`, when it is the clavicle and belongs on `LeftShoulder`.

Verified on `main` (run from a checkout with `npm install` done, since the probe imports `three`):

```bash
node --input-type=module -e "
import { canonicalizeBoneName as c } from './src/glb-canonicalize.js';
import { PropertyBinding } from 'three';
for (const n of ['DEF-spine', 'DEF-spine.001', 'DEF-spine.003', 'DEF-spine.004', 'DEF-spine.006', 'DEF-shoulder.L', 'DEF-upper_arm.L']) {
  const s = PropertyBinding.sanitizeNodeName(n);
  console.log(n, '->', c(n), '| runtime', s, '->', c(s));
}
"
```

```
DEF-spine -> Spine | runtime DEF-spine -> Spine
DEF-spine.001 -> Spine | runtime DEF-spine001 -> null
DEF-spine.003 -> Spine | runtime DEF-spine003 -> null
DEF-spine.004 -> Spine | runtime DEF-spine004 -> null
DEF-spine.006 -> Spine | runtime DEF-spine006 -> null
DEF-shoulder.L -> LeftArm | runtime DEF-shoulderL -> LeftArm
DEF-upper_arm.L -> LeftArm | runtime DEF-upper_armL -> LeftArm
```

## What to change

1. In `src/glb-canonicalize.js`, recognise the Rigify trunk after the `DEF-`/`ORG-`/`MCH-` prefix strip, in both the dotted (`spine.003`) and sanitized (`spine003`) spellings. Map `DEF-spine` to `Hips`, `.001` to `Spine`, `.002` to `Spine1`, `.003` to `Spine2`, `.004` to `Neck`, and `.006` to `Head`. `.005` is the upper neck: leave it unmapped (the canonical set has one neck joint) and say so in a comment. Scope the rule to Rigify-prefixed names so a bare `spine003` from another exporter is not swept in.
2. Map `shoulder` to the sided `Shoulder` target when it follows a Rigify prefix, so `DEF-shoulder.L` lands on `LeftShoulder` and stops colliding with the upper arm.
3. Rig Doctor already names the convention (the `rigify` entry in `CONVENTIONS` in `src/rig-report.js` matches the `DEF-`/`ORG-`/`MCH-` layers), so no fingerprint work is needed. Add `DEF-spine.003` to the existing Rigify row of the bone-convention table in [`docs/3d-asset-pipeline.md`](https://github.com/nirholas/three.ws/blob/main/docs/3d-asset-pipeline.md).

## Acceptance criteria

- [ ] Each of the seven trunk joints resolves to the target above, in both the dotted and the sanitized spelling.
- [ ] `DEF-shoulder.L` and `DEF-shoulder.R` resolve to `LeftShoulder` and `RightShoulder`; no mapping crosses sides.
- [ ] A Rigify-named skeleton has no two joints resolving to the same canonical bone (assert it over the full chain in the test).
- [ ] Every existing case in `tests/glb-canonicalize.test.js` still passes, including the Unreal and Reallusion numbered spines.
- [ ] `analyzeGlb` on a Rigify-named skeleton reports convention `rigify` and maps `Hips`, `Spine2`, `Neck` and `Head`; a test in `tests/rig-report.test.js` builds the rig with the file's `syntheticRig` helper and proves it.

## How to test

```bash
npx vitest run tests/glb-canonicalize.test.js tests/rig-report.test.js tests/canonical-clip-gate.test.js
npm test
```

Comment "taking this" before you start.
