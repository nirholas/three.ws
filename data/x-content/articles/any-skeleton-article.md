The idle, walk and gesture clips on three.ws were made once, against one reference skeleton, and they play on avatars built later by other tools: a Mixamo character, a VRoid model, an Unreal mannequin, or a body our text-to-3D lane rigged a minute ago. No clip is re-authored per avatar. This is how the retargeter does it, and where it stops.

![The same idle clip playing on four avatars side by side: a chibi schoolgirl and a ballet dancer rigged with Mixamo bone names, and two avatars built on a different skeleton naming. Each stands at rest with its arms down. Captured live on three.ws/avatar-artifact.](/x-media/any-skeleton-article/one-idle-four-bodies.png)

## A clip is a list of bone names

A clip does not store a body. It stores tracks, and each track names the joint it turns. Every clip in the three.ws library is authored against one canonical skeleton: Hips, LeftForeArm, RightUpLeg, 52 joints in total. A track that names LeftForeArm drives nothing on a rig that calls that joint lowerarm_l.

That is the whole problem in one line. Each tool that exports a humanoid picks its own spelling. A library tied to one spelling animates one family of avatars and leaves the rest standing in their bind pose with their arms out.

## More than twenty spellings, one skeleton

Before a clip touches an avatar, the canonicalizer in src/glb-canonicalize.js reduces each joint name to the canonical one. It strips vendor prefixes and namespaces, collapses separators and case, then looks what is left up in alias tables. Its header lists more than twenty naming schemes, from Mixamo, Unreal, VRM and VRoid, Daz and Genesis, MakeHuman and Blender to Kinect, MediaPipe and the Japanese bone names of MikuMikuDance. Here is one elbow, as eight exporters spell it:

```js
import { canonicalizeBoneName } from './src/glb-canonicalize.js';

canonicalizeBoneName('mixamorig:LeftForeArm'); // 'LeftForeArm'  Mixamo
canonicalizeBoneName('lowerarm_l');            // 'LeftForeArm'  Unreal mannequin
canonicalizeBoneName('J_Bip_L_LowerArm');      // 'LeftForeArm'  VRoid
canonicalizeBoneName('lForeArm');              // 'LeftForeArm'  Daz Genesis
canonicalizeBoneName('forearm.L');             // 'LeftForeArm'  Blender Rigify
canonicalizeBoneName('CC_Base_L_Forearm');     // 'LeftForeArm'  Reallusion
canonicalizeBoneName('Bip01 L Forearm');       // 'LeftForeArm'  3ds Max Biped
canonicalizeBoneName('左ひじ');                 // 'LeftForeArm'  MikuMikuDance
```

Hands matter more than they look. Fingers are 30 of the clip library's 53 tracks, so a rig whose hands do not map scores about 40% coverage and gets no animation at all. That is why the tables spell out finger chains per convention, from Unreal's index_01_l to the VRM 1.0 names that call each phalanx proximal, intermediate or distal.

Some names cannot be settled by spelling alone. Rigify names the collarbone shoulder.L and the upper arm upper_arm.L; SMPL names the collarbone left_collar and the upper arm left_shoulder. No table can read those two the same way, so a second pass looks at the hierarchy instead, because the collarbone is the parent of the upper arm.

![Rig Doctor's report for a Mixamo sample rig: all four limb groups at full coverage, and the bone rewrites that turn mixamorig:Hips into Hips, mixamorig:LeftForeArm into LeftForeArm, and so on down the skeleton.](/x-media/any-skeleton-article/rig-doctor-mapping.png)

## A matching name is half the job

The reference rig the clips were baked on rests in an A-pose, and Mixamo rigs rest in a T-pose. Mixamo exports also bake a 90 degree turn into the armature and the hips. Copy a clip's rotations across as they are, and an avatar plays with its limbs in the wrong frame, or tips the body onto its back.

So the retargeter reads each joint's rest rotation on the target, in its own parent's frame and in the model's frame, and replays the clip bone's motion as the same change in world space from that rest. A rig that already matches the reference gets no correction at all.

It also refuses to copy what is not motion. The clips carry a position and a scale for each bone, and those encode the reference rig's bone lengths. Only joint rotations and the root (Hips) translation are true motion, so only those cross over, and the hip track is rescaled so root motion lands at the new rig's height. That is how a chibi with a head as wide as its shoulders keeps its own proportions instead of being stretched into the reference body.

## Where it stops on purpose

The retargeter would rather leave an avatar alone than animate it badly:

- A model needs a skinned mesh and at least eight canonical bones before the library will drive it. Anything less is treated as a prop and shown as authored.
- A clip that finds a home for less than half of its tracks on a rig is not played on it.
- When the body maps but the arms do not, the idle still plays on the torso and legs, and the stuck arms are swung down to a relaxed rest by their direction, with no name needed.
- Control rigs from some Blender add-ons are skipped deliberately. Their deform bones hang off tracker nodes instead of forming a chain, and glTF has no constraints to carry, so moving them would pull the arm apart. Those uploads need re-rigging, not renaming.

A full name map is not a promise of a good performance. A rig can map all 52 joints and still move badly if its bones are oriented in an unusual way, and the mesh follows whatever skin weights it was given: a sleeve weighted to the wrong bone bends with that bone.

## Thumbnails stand at rest too

The same path poses still pictures. Before a renderer frames an avatar for a thumbnail or a social card, it plays one held frame of the standing idle through the retargeter, then checks that both upper arms end at least 30 degrees below horizontal. A pose that fails the check falls back to the geometric arm swing. If that fails as well, the model renders as authored and is reported, rather than replaced with something worse.

![Four avatar thumbnails rendered by three.ws, each standing at rest with arms down: a chibi schoolgirl and three generated characters in dark outfits.](/x-media/any-skeleton-article/rest-pose-thumbnails.png)

## See it on your own avatar

Paste a GLB link into the [Avatar Artifact viewer](https://three.ws/avatar-artifact) and it retargets the idle onto whatever skeleton the file carries. [Rig Doctor](https://three.ws/rig-doctor) shows the mapping joint by joint before you upload anything, and the [Animation Studio](https://three.ws/pose) plays the rest of the library on a loaded avatar. If your rig uses a naming scheme the tables do not know, the [contribution guide](https://three.ws/docs/first-contribution) walks through teaching the retargeter a new one.
