# X thread: one clip library, any humanoid skeleton

Thread copy for `@trythreews`, the companion to the AWS Builder Center draft
[`aws-builder-center-universal-retargeting.md`](../aws-builder-center-universal-retargeting.md).
It explains how three.ws plays one pre-baked animation library on humanoid avatars from many
different exporters, in the browser, with no list of approved rigs, and it leads with the newest fix
in that path: A-pose avatars no longer swing their arms through their own torso.

**Thesis:** a matching bone name is the smaller half of retargeting. The larger half is rest poses
and axis conventions, and the platform handles both without a rig allowlist. No token talk, no
payments, no roadmap.

**Posting precondition (hard).** The news hook in post 1 and the mechanism in post 7 describe commit
`8561d5c5d` (merged 3 October 2026). When this draft was written, production was serving commit
`76081013b`, which predates it. Do not post until this prints `deployed`:

```bash
git merge-base --is-ancestor 8561d5c5d \
  "$(curl -s https://three.ws/api/version | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).commit))')" \
  && echo deployed
```

Posting is owner-gated like everything in this folder (see [README](./README.md)).

## Verified claims

Each claim the thread makes, and where it was checked on 2026-10-08.

| Claim | Verified at |
| --- | --- |
| 113 clips in the library | `public/animations/manifest.json` (113 entries) and the live `https://three.ws/animations/manifest.json` (113) |
| Clips are baked once onto one reference skeleton (`cz.glb`) | `scripts/build-animations.mjs` header; `src/animation-canonical-rest.js` is generated from `public/avatars/cz.glb` |
| 52 canonical joints | `CANONICAL_BONES` in `src/glb-canonicalize.js` (52 entries); live `/rig-doctor` shows "52 canonical joints scored" |
| 30 of a clip's 53 retargetable tracks are fingers | measured over `public/animations/clips/*.json`: 110 of 113 clips have 53 rotation-plus-hip tracks, 30 of them finger joints |
| A clip plays only if at least half its tracks map | `MIN_COVERAGE = 0.5` in `src/animation-retarget.js` |
| A rig needs a skinned mesh and 8 canonical bones | `_modelSupportsCanonicalClips` and `MIN_CANONICAL_BONES = 8` in `src/animation-manager.js` |
| The 12 elbow spellings in post 3 all resolve to `LeftForeArm` | each run through `canonicalizeBoneName` in `src/glb-canonicalize.js` |
| Rigify and SMPL clavicle/upper-arm clash, resolved by contention then hierarchy | `resolveArmShoulderCollisions` in `src/glb-canonicalize.js`; tests in `tests/glb-canonicalize.test.js` |
| Mixamo bakes +90 X on the armature and -90 X on the hips | comments and `canonicalizeArmatureOrientation` in `src/glb-canonicalize.js`; `src/animation-retarget.js` |
| A Mixamo avatar lay 92 degrees off vertical during idle before the bind correction, 7.3 after | empirical table in the header of `tests/animation-upright-invariant.test.js` |
| The correction is q' = L · q · R from each bone's local and world rest | `bindCorrections` in `src/animation-retarget.js` |
| The reference rig rests in a T-pose | computed from `CANONICAL_REST_POSITION` in `src/animation-canonical-rest.js`: upper arms and forearms within a fraction of a degree of horizontal |
| The idle swings the reference upper arm a little over 70 degrees down | forward kinematics on the reference skeleton with frame 0 of `public/animations/clips/idle.json` (71.6 and 76.5 degrees) |
| Upper arms, forearms, thighs and shins are re-aimed; feet keep their world rest; hands and fingers inherit | `LIMB_DIRECTION_CHILD`, `WORLD_REST_BONES` and `restAlignments` in `src/animation-retarget.js`, commit `8561d5c5d` |
| Only rotations and the hip translation cross over; hip motion is rescaled to the avatar's height | `retargetClip` in `src/animation-retarget.js`; `_retarget` in `src/animation-manager.js` |
| A clip that would tip the hips past 45 degrees is disabled | `CATASTROPHE_TILT_DEG = 45` and `_guardAgainstFallenPose` in `src/animation-manager.js` |
| Unmapped arms are found by direction and swung down | `src/animation-arm-relax.js` |
| 477 tests in the canonicalizer suite | `npx vitest run tests/glb-canonicalize.test.js` on 2026-10-08: 477 passed |
| A test runs without the fix and asserts the avatar falls | "the test has teeth" in `tests/animation-upright-invariant.test.js` |
| 10 of 10 naming conventions move both arms and both legs | `node scripts/animation-dignity-sweep.mjs` on 2026-10-08: "10/10 conventions animate both arms and both legs on both lanes" |
| Biped fingers, ValveBiped, and colon-stripped HumanIK names do not map | `canonicalizeBoneName('Bip01 L Finger0')`, `('ValveBiped.Bip01_Pelvis')`, `('Character1Hips')` all return `null`; listed as open in `docs/first-contribution.md` |
| A Biped rig with fingers gets no clip | scratch test against current code: idle maps 21 of 53 tracks (39.6 percent), `clip: null` |
| Rig Doctor reads the file in the browser and never uploads it | `src/rig-doctor-page.js` header (FileReader, blob URL); live page copy "Nothing is uploaded" |
| Rig Doctor recognises 15 conventions | `CONVENTION_COUNT` in `src/rig-report.js` (15); live `/rig-doctor` shows "15 rig conventions recognised" |

## Do not claim

1. **Do not post before the precondition passes.** The A-pose re-aim is merged, not deployed, as of this draft.
2. **Do not say "any rig" or "every avatar" without "humanoid".** Non-humanoid skeletons are refused on purpose, and three humanoid conventions (Biped fingers, ValveBiped, colon-stripped HumanIK) still fail. The thread says so in post 11; keep it.
3. **Do not quote a convention count other than 15 (Rig Doctor fingerprints) or 10 (the motion sweep).** The canonicalizer's header lists more spellings than that, but nobody has counted them into a defensible number.
4. **Do not say the re-aim is tested.** It shipped without a dedicated unit test. The upright suite and the sweep predate it.
5. **Do not say the npm package has the re-aim.** `@three-ws/retarget` 0.1.2 (published 2026-09-11) predates it. The Animation Studio gallery and GLB export (`retargetClipToRig`) got it in a follow-up commit, so the same deploy precondition applies to them.
6. **Do not call it AI or machine learning.** It is deterministic name tables and quaternion math.
7. **Do not imply AWS hosting.** The companion article is on the AWS Builder Center; the platform runs on Google Cloud Run and retargeting runs in the browser.
8. **Do not name other animation tools or engines as comparisons.** Exporter names appear only as the conventions we read.

---

## The thread

Counts are X weighted characters, with the one URL counted as 23. Every post is under the
1000-character Premium ceiling and over 280, per [the announcement voice](../announce-voice.md).

**1/** (466)

> Every animation on three.ws was baked once, onto one reference skeleton. All 113 clips then play, in the browser, on avatars it has never seen: Mixamo, VRoid, Unreal mannequins, Daz figures, Blender exports, hobby rigs with bones named shoulderL.
>
> Our latest fix closes the stance gap: avatars that rest in an A-pose no longer swing their arms through their own torso.
>
> How one clip library drives any humanoid skeleton, with no list of approved rigs:

**2/** (408)

> A clip does not store a body. It stores tracks, and each track names the joint it turns: Hips, LeftForeArm, RightUpLeg. 52 joint names in all.
>
> Load a rig whose elbow is called lowerarm_l and that track binds to nothing. No error. The model renders, the mixer runs, and the avatar stands frozen in its bind pose with its arms straight out.
>
> So step one is turning every exporter's spelling into one spelling.

**3/** (499)

> The canonicalizer strips vendor prefixes and namespaces, folds separators and case, then looks the rest up in alias tables, in a fixed priority order so an obscure convention can never shadow a common one.
>
> These all resolve to LeftForeArm:
>
> mixamorig:LeftForeArm
> lowerarm_l
> J_Bip_L_LowerArm
> leftLowerArm
> lForeArm
> forearm.L
> CC_Base_L_Forearm
> Bip01 L Forearm
> ElbowLeft
> mElbowLeft
> elbowL
> ulna.L
>
> Left spellings are written once; the right side is derived, and a test checks no name ever crosses sides.

**4/** (403)

> Fingers decide more than they look like they should. 30 of a clip's 53 tracks are finger joints, and a clip only plays when at least half its tracks find a home.
>
> So a rig whose body maps perfectly but whose hands don't scores about 43 percent and gets no animation at all. Not stiff fingers: nothing.
>
> That is why finger chains are mapped convention by convention, from index_01_l to leftIndexProximal.

**5/** (457)

> Some names can't be settled by spelling. Rigify calls the collarbone shoulder.L. SMPL calls the upper arm left_shoulder. A hobby rig calls its upper arm shoulderL and has no collarbone at all.
>
> Any name-only rule breaks one of the three. So the clash is resolved by contention: a joint is only reassigned when two joints fight over one name and the sibling slot is empty. If there is still a tie, the hierarchy decides, because the collarbone is the parent.

**6/** (526)

> Matching names is the smaller half.
>
> A clip stores absolute rotations measured against the reference rig's rest pose and axes. Mixamo exports bake +90 degrees into the armature and -90 into the hips. Copy the clip verbatim and the hips lose their -90: our Mixamo test avatar played its idle lying 92 degrees off vertical.
>
> The fix replays each bone's motion as the same change in world space from the target's own rest: q' = L · q · R, built from each bone's local and world rest rotation. Same avatar, same idle: 7.3 degrees.

**7/** (532)

> Then the A-pose problem. The reference rig rests in a T-pose, and the idle swings its upper arm a little over 70 degrees down from there. Apply that same swing to an arm that already hangs down in an A-pose, and the hand ends up inside the chest.
>
> Now, before the motion replays, each upper arm, forearm, thigh and shin is turned from its own rest direction onto the reference's. Hands and fingers inherit the turn, feet keep their own rest so soles stay flat, and the spine is left alone because its angles are anatomy, not stance.

**8/** (433)

> Only motion crosses over. Some clips carry a position and scale for every bone, and those encode the reference rig's bone lengths. Copy them onto an avatar with different proportions and its skeleton folds into a heap, even though every bone matched.
>
> So only joint rotations and the hip translation retarget, and the hip track is rescaled to the avatar's own hip height, measured from its own floor. Every rig keeps its proportions.

**9/** (513)

> It would rather leave an avatar alone than animate it badly:
>
> No skinned mesh, or fewer than 8 recognised joints: treated as a prop, shown as authored.
> Under half of a clip's tracks mapped: that clip does not play.
> A clip that would tip the hips past 45 degrees: disabled for that avatar, and reported.
> Body maps but arms don't: the stuck arms are found by direction, no name needed, and swung down to the sides.
>
> In shared scenes, a rig that fails is swapped for a known-good one instead of standing in a T-pose.

**10/** (413)

> The tests are written so they can fail. 477 name tests, one table of real export spellings per convention. An upright suite that also runs WITHOUT the correction and asserts the avatar falls over, so it would catch anyone removing it.
>
> And a motion sweep, because names passing is not limbs moving: idle and walk on 10 differently named rigs, measuring hand and foot travel. 10 of 10 move both arms and both legs.

**11/** (479)

> Where it still fails, plainly. A 3ds Max Biped rig maps its body but not its numbered fingers (Bip01 L Finger0), so it lands under the half-the-tracks line, gets no clip, and shows its bind pose. Source-engine ValveBiped rigs and HumanIK names with the colon stripped don't map either. All three are open contributor tasks.
>
> And no retargeter can fix skinning: a sleeve weighted to the wrong bone bends with that bone.
>
> The re-aim from post 7 also has no dedicated unit test yet.

**12/** (281)

> Try it on your own avatar. Drop a .glb on Rig Doctor and it names your skeleton's convention, scores torso, arms, hands and legs, lists the bone renames, and plays idle, walk, wave and dance on your rig. The file is read in your browser and never uploaded.
>
> three.ws/rig-doctor

---

## Reply to append once the AWS article is live

Post this as a reply to post 12 after the AWS Builder Center article is published. Whoever
publishes pastes the article's URL directly after the colon; with the URL counted as 23 the reply
measures 144 characters.

> The full write-up, with the code excerpts, the tests, and what we would build differently, is on the AWS Builder Center:

---

## Media plan

Three stills, captured on 2026-10-08 with Playwright (headless Chromium, SwiftShader WebGL) against
`https://three.ws/rig-doctor?sample=...`, which is reproducible from those URLs. They are in
[`public/x-media/universal-retargeting-thread/`](../../public/x-media/universal-retargeting-thread/).
Each was checked by eye: no sign-in wall, no spinner, no error, no T-posed avatar. For the two
report captures, the site's floating corner widgets (the walking companion and the help stack)
were hidden with CSS so they would not cover the panels; nothing inside the report was altered.

The captures were taken while production ran `76081013b`, before the A-pose fix. The avatar shown is
a Mixamo rig, which rests in a T-pose, so the fix does not change how it looks. If you film a reel
for post 1 instead (the voice guide's first rule, `npm run x:content -- prove <id>`), film it after the
precondition passes, on an A-pose avatar.

| File | Attach to | Alt text |
| --- | --- | --- |
| `rig-doctor-walk-preview.png` | Post 1 | A stylized 3D woman in a grey crop top, yellow trousers and red headphones walks toward the camera mid-stride, one foot ahead of the other, inside Rig Doctor's live preview panel on three.ws. The Walk button is selected beside Idle, Wave and Dance, with the caption "This is the same retargeting path the platform uses." |
| `rig-doctor-mixamo-report.png` | Post 3 | Rig Doctor's report for a Mixamo avatar named michelle.glb. A green Ready banner reads "Every limb group is drivable. This rig performs the full clip library." and "52 of 52 canonical joints mapped from a Mixamo rig." Coverage bars show torso 6 of 6, arms 8 of 8, hands 30 of 30 and legs 8 of 8. A bone rewrites panel maps mixamorig:Hips to Hips, mixamorig:LeftArm to LeftArm and so on, with the avatar standing at rest, arms at her sides, in the live preview. |
| `rig-doctor-partial-verdict.png` | Post 11 | Rig Doctor's amber Partial verdict for a half-body avatar: "This rig animates, but arms and legs will not move. 36 of 52 canonical joints mapped." It lists arms at 2 of 8 joints mapped and legs at 0 of 8, names the missing joints, and notes that without legs a walk cycle plays as a slide. |

The partial-verdict capture is cropped to the banner on purpose: on that sample the live preview
panel rendered empty in our headless run, so it is not shown.
