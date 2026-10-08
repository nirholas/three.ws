---
title: "Any skeleton, one clip library: how we animate every humanoid avatar in the browser without a rig allowlist | three.ws on AWS"
venue: AWS Builder Center
account: three.ws (official organization account, byline "three.ws")
status: draft, owner approval required before publishing (external-channel gate in CLAUDE.md)
description: "Every animation clip on three.ws was baked once, onto one reference skeleton, and plays on avatars exported later by other tools. This is how: a bone-name canonicalizer that knows the naming conventions of the major exporters, a world-space bind correction for rest poses and axis conventions, a limb re-aim for A-pose rigs, root motion rescaled to the avatar's own height, and a fallback ladder that refuses to animate a rig badly. With the tests that pin each convention down, and the places it still fails."
tags: [three-js, animation, gltf, webgl, open-source]
index: docs/aws-builder-center.md
---

# Any skeleton, one clip library: how we animate every humanoid avatar in the browser without a rig allowlist

There are 113 animation clips on three.ws: idles, walks, waves, dances, emotes. We baked each of them once, at build time, onto one reference skeleton. They play, in the browser, on avatars other tools exported under other naming schemes: Mixamo, VRoid, an Unreal mannequin, Daz, Blender, a hobby rig whose bones are called `shoulderL` and `kneeL`. Nobody re-authors a clip per avatar, and the animation stack keeps no list of approved rigs.

This is how that works, and where it stops. Mapping bone names is the part everybody expects, and the smaller half. The larger half: two skeletons with identical names can rest in different poses and measure rotations in different frames, and a clip copied verbatim tips one avatar onto its back and drives another's arms through its chest. We shipped both of those bugs. The fixes, and the tests that keep them fixed, are the substance here.

Everything runs client-side in [three.js](https://threejs.org), and every code sample is an excerpt from [the repository](https://github.com/nirholas/three.ws) (Apache-2.0) with its file path, so you can check each claim in the same sitting.

**Status, plainly, because AWS builders check.** three.ws is a verified AWS Partner. Nothing in this article runs on an AWS service: retargeting happens in the viewer's browser tab, and the platform's own runtime is on Google Cloud Run. We would rather say that than let a partner article imply a hosting story that is not ours. One more date matters: the A-pose limb re-aim described in section 7 merged on 3 October 2026. At the time of writing, production still runs an earlier commit (`curl -s https://three.ws/api/version` shows which commit is live), and the published npm package `@three-ws/retarget` 0.1.2 predates it too. Everything else described as shipped is live.

**Contents**

1. A clip is a list of bone names
2. One canonical skeleton, and why fingers decide everything
3. Reducing a name: prefixes, separators, alias tables, and their order
4. When spelling cannot decide: the clavicle and the upper arm
5. Why a name map is not enough
6. The bind correction, q' = L · q · R
7. T-pose against A-pose: re-aim the limbs before the motion plays
8. Hips, legs, and root motion
9. Failure modes and the fallback ladder
10. How the tests encode each convention
11. What we would build differently
12. What to lift from this
13. Try it

---

## 1. A clip is a list of bone names

A three.js `AnimationClip` does not store a body. It stores keyframe tracks, and each track is addressed by a string: `Hips.position`, `Spine.quaternion`, `LeftForeArm.quaternion`. When you hand the clip to an `AnimationMixer`, the mixer binds each track by looking up a node with that name in the scene graph. A track whose node does not exist is skipped without an error.

That silence is the whole problem. A rig whose elbow is named `lowerarm_l` loads, renders, runs the mixer at full frame rate, and never moves its elbow. If no track binds, the avatar stands in its bind pose: for many exporters a T-pose with the arms straight out, which reads as broken.

Every tool that exports a humanoid picks its own spelling, and the spellings are not cosmetic variants of one another. Here is one joint, the left elbow, as different conventions name it. Each line was run against the canonicalizer in [`src/glb-canonicalize.js`](https://github.com/nirholas/three.ws/blob/main/src/glb-canonicalize.js) and returns `LeftForeArm`:

```
mixamorig:LeftForeArm     Mixamo
lowerarm_l                Unreal mannequin
J_Bip_L_LowerArm          VRM 0.x / VRoid
leftLowerArm              VRM 1.0
lForeArm                  Daz Genesis
forearm.L                 Blender Rigify
CC_Base_L_Forearm         Reallusion Character Creator
Bip01 L Forearm           3ds Max Biped
ElbowLeft                 Kinect
mElbowLeft                Second Life
elbowL                    hand-built hobby rigs
ulna.L                    anatomy-kit and scan rigs
```

A library tied to one spelling animates one family of avatars. We wanted it to animate any humanoid somebody brings, which raised two questions: what turns any of those names into one name, and what else must be true for the motion to look right once it binds?

## 2. One canonical skeleton, and why fingers decide everything

The clips are produced by a build script ([`scripts/build-animations.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/build-animations.mjs)) that retargets source motion onto one reference avatar, a photo-avatar rig checked in as `public/avatars/cz.glb`, and writes each clip out as three.js JSON. Every track in the library therefore addresses one of 52 canonical joint names:

```js
export const CANONICAL_BONES = Object.freeze([
	'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
	'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
	'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
```

That excerpt is the head of the list in `src/glb-canonicalize.js`; the rest repeats the hand for the other side and adds the legs (`LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase` and their right twins).

Count where those 52 joints are. Six are torso and head, eight are arms, eight are legs, and **30 are fingers**. We measured the shipped library: 110 of the 113 clips carry exactly 53 tracks we can retarget (52 joint rotations plus the hip translation), and 30 of those 53 address a finger joint.

That ratio turns out to be load-bearing, because of a gate we will come back to in section 9. The retargeter refuses to play a clip unless at least half of its tracks find a home on the target rig:

```js
export const MIN_COVERAGE = 0.5;
```

(`src/animation-retarget.js`.) A rig whose body maps perfectly but whose hands do not scores 23 of 53, about 43 percent, which is under the gate. So a missing finger convention does not cost you finger animation. It costs you **all** animation: the manager builds no action for that clip, and the avatar stands in its bind pose. We learned this the hard way. Unreal mannequins, VRM 1.0 avatars, Genesis figures, MakeHuman exports and Rigify characters were all doing exactly that until their finger spellings were added,

## 3. Reducing a name: prefixes, separators, alias tables, and their order

`canonicalizeBoneName(name)` takes any string and returns a canonical name or `null`. It works in stages, and the order of the stages is where the subtlety lives.

**Strip namespaces and vendor prefixes.** A leading namespace (`Character1:Hips` from Autodesk HumanIK, `subject:LeftUpLeg` from mocap tools) goes first. Then known vendor prefixes, each one a single line: `mixamorig:` and its numbered variants, Blender's `Armature_`, Rigify's `DEF-`/`ORG-`/`MCH-` layers, the `CH_` prefix some avatar builders emit, Reallusion's `CC_Base_`, Sketchfab's `j_`, the 3ds Max `Bip01 ` prefix, and the numbered `5.joint_` form a VRM converter emits.

**Collapse separators and case, then look up.** What remains is folded into one key, and the key is looked up in three tables in a fixed priority order:

```js
	const key = s.replace(/[-_.\s]+/g, '').toLowerCase();
	// Canonical/Mixamo/Rigify spellings first, then the Unreal-mannequin aliases,
	// then the extended VRM/Daz/MakeHuman/simple-rig table (lowest priority, so it
	// only catches names the first two don't already resolve).
	return LOOKUP.get(key) ?? UNREAL_ALIASES.get(key) ?? EXTRA_ALIASES.get(key) ?? null;
```

That one fold is why `Left_Arm`, `left-arm`, `left arm`, `LEFT_ARM` and `upperarm.L`-style names reach the same key. The priority order is a safety property: the lowest-priority table can never shadow a canonical spelling, so adding an alias for an obscure convention cannot break Mixamo.

**Alias tables carry the conventions that share no spelling with the canonical set.** The Unreal mannequin is the cleanest example, because its names are keyed by the same folded form the lookup produces:

```js
const UNREAL_ALIASES = new Map(Object.entries({
	pelvis: 'Hips',
	neck01: 'Neck',
	claviclel: 'LeftShoulder', upperarml: 'LeftArm', lowerarml: 'LeftForeArm', handl: 'LeftHand',
	clavicler: 'RightShoulder', upperarmr: 'RightArm', lowerarmr: 'RightForeArm', handr: 'RightHand',
	thighl: 'LeftUpLeg', calfl: 'LeftLeg', footl: 'LeftFoot', balll: 'LeftToeBase',
	thighr: 'RightUpLeg', calfr: 'RightLeg', footr: 'RightFoot', ballr: 'RightToeBase',
}));
```

Notice what is missing: the Unreal spine chain. `spine_02` folds to `spine02`, which collides with a different convention, the `_02` node-deduplication suffix that glTF and FBX exporters append (`mixamorig:Spine_02`). That suffix must keep resolving to `Spine`, and a test pins it. The conflict was resolved by leaving the Unreal spine unaliased rather than letting the two conventions fight.

**Write the left side once, derive the right.** Most side-paired conventions are listed only by their left spelling, and the right twin is derived by swapping the side token:

```js
	for (const [lv, lc] of SIDED) {
		put(lv, lc);
		const rc = lc.replace(/^Left/, 'Right');
		let rv;
		if (/^left/.test(lv)) rv = lv.replace(/^left/, 'right');
		else if (/^l[A-Z]/.test(lv)) rv = 'r' + lv.slice(1);
		else if (/Left$/.test(lv)) rv = lv.replace(/Left$/, 'Right');
		else if (/L$/.test(lv)) rv = lv.replace(/L$/, 'R');
		else rv = lv;
		put(rv, rc);
	}
```

Halving the table halves the places a typo can hide, and the derivation rule is tested directly: a test feeds every left spelling through and asserts none of them lands on a `Right` bone, and the reverse.

**Retry suffixes only after the full name failed.** Two trailing forms get one retry each: Apple's `_joint` suffix (`left_arm_joint`) and the deduplication suffix (`LeftForeArm_010`, Blender's `.001`). Both retries run only when the unstripped name did not resolve, so a genuinely numbered bone like `left_hand_index_1` maps to `LeftHandIndex1` before its index is ever treated as a suffix.

**Non-Latin conventions get explicit entries.** MikuMikuDance names bones in Japanese with the side as a leading character (`左ひじ` is the left elbow), which the side-swap rule cannot reach, so both sides are listed. Its IK targets and twist bones stay unmapped on purpose: neither is a chain joint, and driving them fights the IK solve or tears the mesh.

The header of the file lists the conventions it handles. Rig Doctor (section 13) fingerprints 15 of them by name and reports which one a file uses.

## 4. When spelling cannot decide: the clavicle and the upper arm

Some collisions cannot be settled by any table, because the same word means different bones on different rigs:

- Rigify names the clavicle `shoulder.L` and the upper arm `upper_arm.L`. Both fold onto `LeftArm`.
- SMPL, the body model many research pipelines emit, names the clavicle `left_collar` and the upper arm `left_shoulder`. Both fold onto `LeftShoulder`, which leaves `LeftArm` empty.
- A hand-built hobby rig names its upper arm `shoulderL` and has no clavicle at all, so "always treat shoulder as the clavicle" would freeze its arms.

Whichever way a name-only rule leans, it breaks one of those three. So `resolveArmShoulderCollisions` resolves the clash by **contention**, not spelling: an entry is only reassigned when two joints contest one canonical target and the sibling target is free. A rig without the collision is never touched: on Rigify the clavicle-spelled contender is demoted to `LeftShoulder`, and on SMPL the shoulder-spelled one is promoted to `LeftArm`.

When spelling leaves more than one candidate, the skeleton breaks the tie: the clavicle is the ancestor of the upper arm. The same resolver runs on the glTF JSON at ingest and on the live scene graph at runtime, and it runs before any first-match claim, because Rigify lists `shoulder.L` first: claiming first would bind the arm rotation to the clavicle, and the arm would swing from the shoulder blade.

After resolution, a canonical name is assigned at most once. When two joints still want the same target (SMPL's ankle and foot, or Reallusion's two neck twist joints), the first in parent-first order wins and the other stays unmapped. Duplicate node names make three.js bind to an arbitrary twin, which is worse than leaving an extra joint still.

## 5. Why a name map is not enough

Suppose every name maps. Two things can still go badly wrong, because a rotation track stores **absolute local rotations** measured against one skeleton's rest pose and axes.

**Axis conventions.** Mixamo exports bake a +90 degree rotation about X into the armature node and a -90 degree rotation into the hips. The two cancel, so the avatar stands upright at rest. But the clip was authored on a rig whose hips rest at identity, so the first keyframe of the hip track overwrites the -90 and leaves the armature's +90 uncancelled. The avatar plays its idle lying on its back. Our upright-invariant test suite records how bad this was on a real Mixamo export (`public/avatars/michelle.glb`) before the fix: the hips sat 92 degrees off vertical during `idle`, 94 during `celebrate`, and 115 during `dance`.

**Rest poses.** The reference rig rests in a T-pose. We checked rather than assumed: from the rest positions generated out of `cz.glb` into `src/animation-canonical-rest.js`, both upper arms and forearms point within a fraction of a degree of horizontal. Plenty of avatars rest differently: an A-pose with the arms angled down, bent elbows, splayed legs. The idle's first frame swings the reference rig's upper arms a little over 70 degrees down from horizontal (we measured it by forward kinematics on the reference skeleton). Apply that same rotation to an arm that already hangs well below horizontal at rest, and the hand ends up inside the torso.

Neither of these is a naming problem, and no amount of naming work fixes them. They need the target's own rest pose, measured at load time.

## 6. The bind correction, q' = L · q · R

When the `AnimationManager` attaches to a model, before any clip has moved a bone, it captures each canonical bone's rest rotation twice: in its parent's frame (local) and in the model's frame (world). The retargeter then rewrites every rotation keyframe as `q' = L · q · R`, where the factors are built from the reference rig's rest rotations (`Rs` local, `WS` world, generated from `cz.glb`) and the target's (`Rt`, `WT`):

```js
		if (WS && WT) {
			const C = turns.get(canonical);
			const Cp = turns.get(CANONICAL_PARENT[canonical]);
			// L = Rt · WT⁻¹ · Cp⁻¹ · WS · Rs⁻¹
			L = Rt.clone().multiply(WT.clone().invert());
			if (Cp) L.multiply(Cp.clone().invert());
			L.multiply(WS).multiply(Rs.clone().invert());
			// R = WS⁻¹ · C · WT
			R = WS.clone().invert();
			if (C) R.multiply(C);
			R.multiply(WT);
			if (1 - Math.abs(R.w) < BIND_EPSILON) R = null; // identity post-factor
		} else {
```

(`bindCorrections` in `src/animation-retarget.js`.) Ignore `C` and `Cp` until section 7; without them they are identity. What remains is the standard world-delta-preserving retarget: express the clip bone's motion as a change in world space from the reference rest, and replay that change from the target's rest.

For the Mixamo hips, the world rest matches and only the parent frame differs, so the formula collapses to a pure reframe that keeps the -90 the rig needs. For limbs, it replaced an earlier local-only premultiply (`Rt · Rs⁻¹`), which the code comments record as skewing limbs by about 30 degrees between A-pose and T-pose rigs.

Two details make this cheap and safe. A bone whose correction is within `1e-6` of identity is skipped, so retargeting onto the reference rig itself is byte-for-byte the verbatim path, and a test asserts that track for track. And rest is always read from the bind pose: a preview mixer leaves bones mid-pose when it stops, and measuring "rest" from that state once skewed the second clip a user played by 60 to 90 degrees.

## 7. T-pose against A-pose: re-aim the limbs before the motion plays

The bind correction preserves each bone's world-space motion delta. That is only the right thing to replay when both rigs rest in the same stance. The reference rig rests in a T-pose; replaying "swing the arm about 70 degrees down" onto a rig whose arm already hangs down in an A-pose drives the arm through the body. The commit that fixed this (`8561d5c5d`, "re-aim limb rest direction so A-pose rigs stop clipping through the torso") names the rigs it was found on: MakeHuman-derived bodies and a selfie-derived body in our Avatar Studio.

The fix adds one step before the delta replays: turn each limb bone, in the rig's own world frame, from its rest direction onto the reference rig's rest direction. Only the bones whose direction is a stance convention are listed, each keyed to the child joint that defines its direction:

```js
const LIMB_DIRECTION_CHILD = Object.freeze({
	LeftArm: 'LeftForeArm',
	LeftForeArm: 'LeftHand',
	RightArm: 'RightForeArm',
	RightForeArm: 'RightHand',
	LeftUpLeg: 'LeftLeg',
	LeftLeg: 'LeftFoot',
	RightUpLeg: 'RightLeg',
	RightLeg: 'RightFoot',
});
```

The spine, neck, head and clavicles are deliberately absent, because their rest angles are anatomy rather than a stance convention. The turns are computed parents first, so an elbow only adds the bend its parent did not already remove:

```js
	for (const bone of CANONICAL_TOPO_ORDER) {
		const parentTurn = turn.get(CANONICAL_PARENT[bone]) || null;
		if (WORLD_REST_BONES.has(bone)) continue; // identity: the foot keeps its own rest
		const target = targetDirections.get(bone);
		const source = SOURCE_REST_DIRECTION.get(bone);
		if (!target || !source) {
			if (parentTurn) turn.set(bone, parentTurn);
			continue;
		}
		dir.copy(target);
		if (parentTurn) dir.applyQuaternion(parentTurn);
		const own = dir.dot(source) > ALIGN_DOT ? null : new Quaternion().setFromUnitVectors(dir, source);
		if (own && parentTurn) turn.set(bone, own.multiply(parentTurn));
		else if (own || parentTurn) turn.set(bone, own || parentTurn);
	}
```

(`restAlignments` in `src/animation-retarget.js`.) Three choices in that loop are worth naming:

- **Shortest arc, from the parent-carried direction.** `setFromUnitVectors` gives the minimal rotation between two directions, so no bone picks up a spurious twist about its own axis.
- **Inheritance.** A bone without its own entry (a hand, a finger) inherits its parent's turn, so the hand stays rigid with the forearm and the fingers with the hand.
- **Feet keep their world rest.** The foot is in `WORLD_REST_BONES` and turns by nothing, so a sole that is flat on the floor at rest stays flat whatever angle the shin was re-aimed by. Toes inherit from the foot.

The threshold `ALIGN_DOT = 1 - 1e-6` is about 0.08 degrees, so export noise counts as aligned, a T-pose rig turns by a few degrees at most, and the reference rig turns by nothing and still round-trips unchanged. The bone's turn and its parent's (`C` and `Cp`) then slot into the section 6 correction.

## 8. Hips, legs, and root motion

Legs are ordinary entries in the naming layer (section 10's sweep checks they actually swing). They need care in two other places.

**Only motion crosses over.** About a third of the clips (41 of 113) ship a position and a scale track for every bone, because that is how the build bakes them. A bone's local position is its offset from its parent, which is to say the reference rig's bone lengths. Copy those onto an avatar with different proportions and every bone "matches" while the skeleton folds into a heap. So the retargeter takes only what is genuinely motion:

```js
		const retargetable =
			property === 'quaternion' || (property === 'position' && canonical === 'Hips');
		if (!retargetable) continue;
```

Joint rotations, plus the root translation. Every rig keeps its own bone lengths, which is how a stylized character with short legs and a large head keeps its proportions instead of being stretched into the reference body.

**Root motion is rescaled and re-grounded.** The hip track is authored in metres around the reference rig's hip height. The manager measures the target's hip height above its own floor, in the units of the hips' parent, and scales the track to match:

```js
		let hipScale = 1;
		const baseline = clipHipBaselineY(clip);
		if (this._hipTargetLocalY > 0.05 && baseline > 0.05) {
			hipScale = Math.min(200, Math.max(0.2, this._hipTargetLocalY / baseline));
		}
```

(`src/animation-manager.js`.) The clamp reaches 200 because a Mixamo armature exported at `scale 0.01` puts its hips near 100 in local units; matching world heights instead would leave about a centimetre of hip motion and sink the avatar into the floor. Height is measured from the model's bounding-box bottom, not world zero, because many exports put their floor below the origin. The track is also rotated into the target's hips-parent frame, so root motion travels the same world direction on any armature.

One more consequence: when a gesture plays over a walk as an additive overlay, every hip, leg and foot track is stripped from the overlay, so a wave never fights the walk cycle's root sway.

## 9. Failure modes and the fallback ladder

The rule we hold is that the library should rather leave an avatar alone than animate it badly, and the next rule is that "alone" must not mean a frozen T-pose when anything better is available. That gives a ladder of gates, each cheaper than the one after it.

**Rung 1: is this a drivable humanoid at all?** The manager's gate needs a skinned mesh and at least eight canonical bones:

```js
function _modelSupportsCanonicalClips(model) {
	let hasSkinnedMesh = false;
	const canonical = new Set();
	model.traverse((node) => {
		if (node.isSkinnedMesh) hasSkinnedMesh = true;
		if (node.name) {
			const c = canonicalizeBoneName(node.name);
			if (c) canonical.add(c);
		}
	});
	return hasSkinnedMesh && canonical.size >= MIN_CANONICAL_BONES;
}
```

`supportsCanonicalClips()` returns that answer, and callers decide what "no" means. A shared scene substitutes a known-good performer: the theater stage tries the agent's own avatar, then an assigned fallback avatar, then the plain mannequin, and only one that passes this gate gets to perform. A personal view, like an agent's own screen, shows the model as authored. Non-humanoid skeletons fail this rung on purpose: there is no safe automatic mapping for them.

**Rung 2: does this clip find enough of a home?** Coverage below `MIN_COVERAGE` returns `clip: null` with an honest breakdown of matched, total and dropped bones. No half-puppet plays.

**Rung 3: would this clip knock the avatar over?** Before an action plays, the manager poses the hips at the clip's first keyframe and measures how far the bone's up-axis tilts from vertical, once per avatar and clip. Past 45 degrees the clip is disabled for that avatar, the rig keeps its authored pose, and one report goes to our client-error channel. Healthy rigs rest under about 18 degrees.

**Rung 4: the body maps but the arms do not.** If neither upper arm resolved, the clip plays on the torso and legs while the arms stay out. `relaxUndrivenArms` finds those arms geometrically, with no name needed (an upper-body bone pointing mostly sideways, not steeply up), and swings them down to a relaxed rest. It runs only when neither upper arm mapped, so it never touches a rig the clip drives.

**Deliberate refusals.** Blender control rigs of the "tracker" family export deform bones that hang off tracker nodes instead of forming a chain, and glTF cannot carry the trackers' constraints. Rotate one mapped deform bone and the next segment stays put: the arm comes apart. So the canonicalizer leaves that layer unmapped, a test pins the refusal, and those uploads need re-rigging, not renaming.

**Where the ladder still has a hole.** Rung 1 counts bones and rung 2 counts tracks, and a rig can pass the first and fail the second. A 3ds Max Biped skeleton is the live example: its body maps (`Bip01 L UpperArm` resolves), its numbered finger chain (`Bip01 L Finger0`, `Finger01`) does not. We built that skeleton in a scratch test against the current code: the idle finds a home for 21 of its 53 tracks, about 40 percent, so no clip plays; and because the arms did map, rung 4 does not engage either. The avatar shows its bind pose. Biped fingers are written up as an open task in our contribution guide, alongside two other verified gaps: HumanIK names after three.js strips the colon from them on load (`Character1Hips` maps to nothing), and Source-engine `ValveBiped` skeletons.

**What no gate can see.** A rig can map all 52 joints and still move badly if its bones are oriented unusually, and the mesh follows whatever skin weights it shipped with: a sleeve weighted to the wrong bone bends with that bone. Retargeting moves skeletons; it cannot repair skinning.

## 10. How the tests encode each convention

Three layers of tests keep this honest, and each catches a failure the others cannot.

**Name tests, one table per convention.** [`tests/glb-canonicalize.test.js`](https://github.com/nirholas/three.ws/blob/main/tests/glb-canonicalize.test.js) is mostly `it.each` tables of real export spellings, one block per convention. The Unreal block opens like this:

```js
	it.each([
		['pelvis',      'Hips'],
		['pelvis_09',   'Hips'],            // UE name + de-dup suffix
		['clavicle_l',  'LeftShoulder'],
		['upperarm_l',  'LeftArm'],
		['lowerarm_r',  'RightForeArm'],
		['hand_r',      'RightHand'],
```

Around them sit tests that encode decisions rather than spellings: the Unreal spine stays unaliased, side derivation never crosses sides, control-rig bones stay unmapped, a full Unreal mannequin hand maps all 15 joints per side, the Rigify and SMPL collisions split correctly in either joint order, and no canonical name is assigned twice. Real fixtures cover both ends: `cz.glb` is a no-op, and `michelle.glb` is renamed, axis-folded, and asserted to keep every joint's world matrix, so the mesh cannot change. The file ran 477 tests green when we wrote this.

A new convention is always the same four parts: an alias entry, a table of its real spellings, a "never crosses sides" test, and a Rig Doctor fingerprint. That is what "no allowlist" means in practice: teach the canonicalizer once, and every surface that animates avatars learns it at the same moment.

**Upright tests that prove they have teeth.** [`tests/animation-upright-invariant.test.js`](https://github.com/nirholas/three.ws/blob/main/tests/animation-upright-invariant.test.js) retargets the featured clips onto real and synthetic rigs and asserts the hips stay within 40 degrees of vertical at every keyframe. Its best test asserts the opposite (comment lines omitted from the excerpt):

```js
	it('the test has teeth: WITHOUT the bind correction, michelle + celebrate falls flat', () => {
		const { root } = loadBoneGraph(avatar('michelle.glb'));
		const verbatim = scanClip(root, 'celebrate', { withFix: false });
		expect(verbatim).not.toBeNull();
		expect(verbatim.max).toBeGreaterThan(CATASTROPHE_DEG);
	});
```

A regression test that passes with or without the fix tests nothing.

**A motion sweep, because names passing is not limbs moving.** A rig can map its hips and animate as a torso with four frozen sticks attached, and every name test stays green. `scripts/animation-dignity-sweep.mjs` drives the real idle and walk clips onto ten differently named rigs, down both production paths (canonicalize at ingest, then retarget; and retarget straight onto raw names at runtime), and measures per-limb rotation swing plus hand and foot travel through space in hip-heights, by composing world matrices. We ran it for this article: 10 of 10 conventions animate both arms and both legs on both paths, with coverage from 94 percent (the `shoulderL` hobby rig, 49 bones mapped) to 100 percent. On that hobby rig, the walk swings the legs by 50.7 and 54.4 degrees.

One caveat: the ten rigs are one synthetic T-pose skeleton renamed ten ways, deliberately, so differences are about naming, never proportions. The sweep therefore says nothing about rest poses; the upright suite, the reference-rig test and the real Mixamo fixture cover those. The section 7 re-aim has no dedicated test yet.

## 11. What we would build differently

**Derive descriptive claims from data.** Writing this article, we found our own comments disagreeing: one says the reference rig rests in an A-pose, the comment added by the October fix says T-pose, and the generated rest data settles it (T-pose). A comment cannot fail a test. Where a stance or a number can be computed from reference data, compute it or assert it.

**Write the test in the same commit as the geometric fix.** The A-pose re-aim shipped with no unit test of its own, and the gap it left is exactly the kind a test would have caught on day one (see the next point). The test that finally came is a parity test, `tests/animation-retarget-rig-parity.test.js`: it loads the A-posed parametric base, retargets the idle and the walk through both entry points, and requires every limb track to agree. Run without the fix, it fails with the right upper arm about 50 degrees off.

**One retarget entry point, not three.** The runtime manager, `retargetClipToObject` and `retargetClipToRig` each assemble their own inputs. The re-aim reached the first two and missed the third: `retargetClipToRig`, used by the Animation Studio's preset gallery and its animated-GLB export, did not pass rest directions for five days, although the helper it needed (`canonicalRestDirectionMapFromRig`) shipped in the same commit. An A-posed body animated correctly on its own page and put its arms through its torso in the studio. The fix was four lines; the lesson is that entry points which assemble their own inputs drift, and a parity test is the cheapest guard against it.

**Make the gates agree.** The bone-count gate and the coverage gate answer different questions, which is how the Biped case slips between them. Gate on what the library will actually do (would any clip clear coverage?), not on a proxy. Likewise Rig Doctor uses the same canonicalizer but not the clavicle/upper-arm resolver, so on a Rigify rig it reports a collision the runtime resolves. A diagnostic that disagrees with the runtime teaches the wrong thing.

## 12. What to lift from this

All Apache-2.0, none of it tied to our hosting:

1. **`@three-ws/retarget`** on npm packages the canonicalizer, retargeter and `AnimationManager`, with `three` as a peer dependency. Its 0.1.2 release predates the A-pose re-aim; read that piece in `src/animation-retarget.js` until the next release.
2. **The bind correction** (section 6) works for any two skeletons given their local and world rest rotations: about thirty lines of three.js quaternions.
3. **Gate on coverage, not on a rig list.** A 50 percent coverage floor and a first-keyframe hips-tilt check are cheap, rig-agnostic, and catch the two failures that look worst on screen.
4. **Keep structure out of motion.** Skip per-bone position and scale tracks, and proportions survive.
5. **Test the absence of the fix.** For every geometric correction, keep a test that runs without it and asserts the catastrophe.

## 13. Try it

Everything below is public and keyless.

- **Rig Doctor**, with a Mixamo rig preloaded: [three.ws/rig-doctor?sample=/avatars/michelle.glb](https://three.ws/rig-doctor?sample=/avatars/michelle.glb). It names the convention, scores each limb group, lists the bone rewrites, and plays idle, walk, wave and dance on the rig through the platform's own animation manager. Drop your own `.glb` on [three.ws/rig-doctor](https://three.ws/rig-doctor): the file is read in your browser and never uploaded. The [Rig Doctor reference](https://three.ws/docs/rig-doctor) explains each verdict.
- **The Animation Studio** at [three.ws/pose](https://three.ws/pose) plays the rest of the library on a loaded avatar and exports an animated GLB.
- **The clip library itself:**

```bash
# the 113 clips and their metadata
curl -s https://three.ws/animations/manifest.json | head -c 600

# one clip: tracks addressed by canonical bone name
curl -s https://three.ws/animations/clips/idle.json | head -c 400

# which commit production runs (the A-pose re-aim is 8561d5c5d)
curl -s https://three.ws/api/version
```

- **The tests and the sweep**, from a clone of [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws):

```bash
npx vitest run tests/glb-canonicalize.test.js tests/animation-upright-invariant.test.js
node scripts/animation-dignity-sweep.mjs --verbose
```

If your rig uses a naming convention the tables do not know, Rig Doctor lists the unrecognised names, and [the contribution guide](./first-contribution.md) walks through teaching the canonicalizer a new one, and lists the three open conventions from section 9 ready to pick up.

---

*three.ws is a verified AWS Partner and an open-source platform for 3D AI agents. Previously from us here: [how we metered a SaaS product through AWS Marketplace with the AWS SDK for JavaScript v3](https://builder.aws.com/content/3ESpll50BdSp9eiCEIxcfG9pGUN/how-we-metered-a-saas-product-through-aws-marketplace-with-the-aws-sdk-for-javascript-v3).*
