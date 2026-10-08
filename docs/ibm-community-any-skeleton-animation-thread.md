---
title: "How do you retarget animation onto humanoid rigs you did not author?"
venue: IBM Community, Three.ws User Group (discussion thread)
account: nich (nich8)
companion_to: docs/ibm-community-any-skeleton-animation-post.md (group blog post, not yet posted; link it here once it has a URL)
status: draft, not yet posted
framing_notes: |
  Self-contained discussion piece. "The full write-up on the group blog" has no URL
  because the post does not exist yet; link it once it does. docs/ibm.md applies, and
  this feature has no IBM component, so IBM appears only in the affiliation line. No
  crypto-cluster content. Snippet run on three.js r184 on 2026-10-08; output verbatim.
---

# How do you retarget animation onto humanoid rigs you did not author?

Every embodied-agent project hits this wall. You have a library of animation clips authored on one skeleton, and avatars arriving from everywhere else: Mixamo, VRoid, Unreal mannequins, Daz, Blender, a text-to-3D pipeline that rigged a body a minute ago. Play a clip on the wrong rig and you get one of three things: limbs that never move, a body lying on its back, or an avatar standing in its bind pose with its arms straight out, which every viewer reads as "broken".

At three.ws we decided early not to keep a list of supported skeletons. Any humanoid should idle, walk and gesture from one shared library, authored against a single 52-joint reference skeleton (the full library is 3,343 clips today). Here is what made that work and what surprised us, and then a question for you, because I do not think we have the last word.

## The core idea in three problems

A clip is a list of tracks, and each track names the joint it drives. Three things differ between rigs, and they need three different fixes:

1. **Names.** `mixamorig:LeftForeArm`, `lowerarm_l`, `J_Bip_L_LowerArm`, `leftLowerArm`, `forearm.L` and `左ひじ` are all the same elbow. We reduce every name to a canonical one (strip namespaces and vendor prefixes, collapse separators and case, look up alias tables in priority order). Our tables hold 736 normalized spellings for the 52 joints.
2. **Rest pose.** Even with names solved, copying a clip's rotations fails, because a clip stores absolute local rotations relative to the authoring rig's rest. Different local axes, a T-pose versus an A-pose, or a rotation an exporter baked onto the armature all change what those numbers mean.
3. **Proportions and units.** Bone lengths, height, metres versus centimetres, and where the floor sits. Get these wrong and avatars sink, float, or fold into a heap.

The fix for the second problem is to stop copying rotations and copy **world-space motion** instead. For each bone, with `Rs`/`Rt` its local rest rotation on source and target and `WS`/`WT` its world rest rotation, every keyframe `q` becomes `L * q * R`, where `L = Rt * WT^-1 * WS * Rs^-1` and `R = WS^-1 * WT`. Both factors depend only on rest poses, so you compute them once per bone and the animated parent cancels out of the derivation.

Here is the smallest demonstration I could make: one arm, one keyframe, and a target rig whose exporter put 90 degrees on the armature and the opposite on the bone (exactly what Mixamo exports do). It runs with nothing but `three` installed:

```js
import { Quaternion, Vector3 } from 'three';

const rot = (axis, deg) => new Quaternion().setFromAxisAngle(new Vector3(...axis), (deg * Math.PI) / 180);
const inv = (q) => q.clone().invert();

// Source rig: no armature rotation, the upper arm rests pointing +X (a T-pose).
const Rs = new Quaternion(), WS = new Quaternion();
// Target rig: an exporter put +90 deg X on the armature and -90 deg X on the bone
// to cancel it. Same world rest, different local numbers.
const parentT = rot([1, 0, 0], 90);
const Rt = rot([1, 0, 0], -90), WT = parentT.clone().multiply(Rt);

const key = rot([0, 0, 1], -70); // one clip keyframe: drop the arm 70 deg

const L = Rt.clone().multiply(inv(WT)).multiply(WS).multiply(inv(Rs));
const R = inv(WS).multiply(WT);
const armDir = (local) => new Vector3(1, 0, 0).applyQuaternion(inv(WT)) // rest axis, bone frame
  .applyQuaternion(parentT.clone().multiply(local));                     // to world
const fmt = (v) => v.toArray().map((n) => n.toFixed(2)).join(', ');

console.log('copied as-is:', fmt(armDir(key)));                         // points backward
console.log('L * q * R:   ', fmt(armDir(L.clone().multiply(key).multiply(R)))); // points down and out
```

Output:

```
copied as-is: 0.34, -0.00, -0.94
L * q * R:    0.34, -0.94, 0.00
```

Copied verbatim, the arm swings backward; corrected, it drops down and out as intended. Across a whole skeleton, the copied case is the avatar lying on its back.

## Five things we learned the hard way

**Your loader renames bones before you see them.** three.js's `GLTFLoader` strips the characters `[ ] . : /` from node names, because they are reserved in track paths. `mixamorig:LeftArm` in the file is `mixamorigLeftArm` in memory, and `upper_arm.L` becomes `upper_armL`. A normalizer that only knows the file's spelling will miss the scene's.

**Names are evidence, hierarchy is proof.** Rigify calls the clavicle `shoulder.L`; SMPL calls the upper arm `left_shoulder`; hobby rigs call the upper arm `shoulderL` and have no clavicle. No spelling table handles all three. We resolve it by contention (only reassign a name two joints are fighting over, and only when the sibling slot is free), with the skeleton hierarchy breaking ties, since the clavicle is the upper arm's ancestor.

**World-space motion is not enough: stance matters too.** The world-delta formula preserves the turn *from rest*. Our reference rests in a T-pose and the idle lowers its arms about 72 to 77 degrees. On a rig that already rests in an A-pose, that same turn put the upper arms at 122 to 128 degrees, past vertical and into the torso. The fix we shipped on 2026-10-03 turns each target limb (upper arm, forearm, thigh, shin) from its own rest direction onto the reference's by the shortest arc before replaying the motion, leaves the spine and clavicles alone, and lets feet keep their own rest so soles stay flat. Afterwards every rig we measured, T-pose, A-pose or arms slightly raised, held its arms at exactly the reference's angle at the first frame of the idle.

**Retarget motion, not structure.** Many baked clips carry position and scale tracks for every bone. Those encode the authoring rig's bone lengths. Copy them and a differently proportioned body folds into a heap while your coverage metric cheerfully reports 100%, because every bone "matched". Only joint rotations and the hip translation should cross over, and the hip track needs rotating into the target's frame, scaling by hip height in the parent's local units (a Mixamo armature exported at scale 0.01 needs a factor of about 100), and offsetting to the model's real floor.

**A clip in the wrong basis passes every self-consistency check.** Our text-to-motion clips came out relative to the generator's own skeleton (HumanML3D-style offsets: arms hanging, head forward of the neck), not our reference rest. They played with heads thrown back about 90 degrees, yet passed every quality rule we had, because each rule compared a clip to itself. Converting the clips into the right basis and adding a rule that checks the basis directly took the honest accept rate on the same 882 takes from 47% to 71%.

And one process lesson: **measure motion, not mapping.** A rig can map every name and still animate as a torso with frozen limbs if a parent chain is broken. We drive real clips onto ten differently named copies of one skeleton and measure that hands and feet actually travel in world space. We also audit stored avatars cheaply by fetching only each GLB's JSON chunk (it always starts at byte 20) with an HTTP Range request, which is how we found five naming conventions our tables were missing.

## The full write-up

The full write-up on the group blog goes much further: the derivation step by step, the stance correction with before-and-after measurements on six public avatars, hips and units, the gates that decide when *not* to animate (a skinned mesh and at least eight mapped joints, 50% track coverage, a guard that rejects any clip that would tip the body more than 45 degrees), a 140-line standalone three.js implementation, and a browser page you can run against public avatar files to watch one idle play on four differently rigged humanoids while a fox is left alone. It also lists where it still fails.

## Questions for the group

1. **Names or geometry?** We start from names and use hierarchy only to break ties. A humanoid whose joints are named like `Skeleton_arm_joint_L__4_` (the glTF sample Cesium Man) gives us nothing to work with. Has anyone matched joints from topology and rest geometry alone (chain lengths, symmetry, which chain reaches the floor) reliably enough to ship?
2. **Where does IK belong?** Rotation-only retargeting is cheap and runs once per rig, but it preserves angles, not contacts: feet can slide and claps can miss on different proportions. For real-time avatars in a browser, where would you add a solver: feet only, feet and hands, or a learned retargeter instead?
3. **How do you validate generated motion?** If you train or fine-tune text-to-motion models, what checks do you run on the output's rest basis before it reaches a renderer? Our self-consistency rules missed an entire library's worth of inverted clips.

I would especially like to hear from anyone who has tried learned retargeting in production.

_three.ws is an IBM Business Partner. The animation system described here is three.ws engineering; it is not an IBM product, uses no IBM technology, and is not endorsed by IBM._
