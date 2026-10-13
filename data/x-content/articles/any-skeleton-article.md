The Boxer Dance clip in the three.ws library is 9.87 seconds long, and it was made once, not for any one avatar. We loaded it onto four characters that came from different tools and had no history together: a girl in yellow trousers whose bones carry the Mixamo prefix, a site worker with a second Mixamo prefix, a man in a pink tailcoat whose bones carry no prefix at all, and a footballer. We pressed play on all four at once, and they danced in step. This is the story of that one clip, and of everything that has to go right between the file and the feet.

![Four avatars in four different outfits caught mid-dance in the same frame: a girl in yellow trousers, a site worker in a hi-vis vest, a man in a pink tailcoat and a hat, and a footballer in a striped shirt. Each is playing the shared Boxer Dance clip. Captured live on three.ws.](/x-media/any-skeleton-article/four-rigs-one-dance-a.png)

## One clip, four bodies, and a table of what happened

Here is the result before the explanation. I fetched the clip from the production manifest, fetched four avatars shipped on three.ws, and ran the same canonicalizer the site runs in the browser. The clip carries one track for each of 52 bones' rotation, 52 for position and 52 for scale. Only 53 of those can cross onto another skeleton: the 52 rotations and the Hips translation. The table counts, for each avatar, how many of those 53 found a bone to drive.

| Avatar | Exporter or naming | Skinned joints | Canonical joints found | Retargetable tracks matched |
|---|---|---|---|---|
| michelle.glb | `mixamorig:` prefix | 65 | 52 | 53 of 53 |
| dancing-twerk.glb | `mixamorig1:` prefix | 65 | 52 | 53 of 53 |
| studio.glb | no prefix, such as `LeftHandThumb1` | 67 | 52 | 53 of 53 |
| cz.glb | already canonical names | 52 | 52 | 53 of 53 |
| realistic-halfbody.glb | canonical names, no legs | 38 | 36 | 37 of 53 |
| fox.glb | animal rig | 24 | 0 | 0 of 53 |

Read the table row by row. The two Mixamo rows use different prefixes, `mixamorig:` and `mixamorig1:`, and both match all 53 tracks, because the canonicalizer strips the prefix before it looks anything up. The unprefixed studio rig and the avatar that already carries canonical names match all 53 too. The half-body row finds only part of the canonical set and matches only some of the tracks, as the table shows: the legs are absent from that file, so there is nothing for the leg tracks to drive, and everything above the hips still moves. The last row is a fox, a non-humanoid rig with no canonical joints at all, which is why the library treats it as a prop rather than a character.

The top four rows are the dancers in the picture. The bottom two rows are not, and they are in the table on purpose: they are what the retargeter does when a body is not the one the clip was made for, and the rest of this article follows the same clip from the file to the screen and to those two rows.

## A clip is a list of bone names

A clip does not store a body. It stores tracks, and each track names the joint it turns. Every clip in the three.ws library is authored against one canonical skeleton: Hips, LeftForeArm, RightUpLeg, 52 joints in total. A track that names LeftForeArm drives nothing on a rig that calls that joint lowerarm_l.

That is the whole problem in one line. Each tool that exports a humanoid picks its own spelling. A library tied to one spelling animates one family of avatars and leaves the rest standing in their bind pose with their arms out. The Boxer Dance clip is no different from the others: open its JSON and the track names read like Hips.quaternion and LeftForeArm.quaternion, spelled exactly one way.

Two avatars in the picture above show the failure mode at its mildest. Michelle's bones are called mixamorig:LeftForeArm. The site worker's are called mixamorig1:LeftForeArm, with a different digit. Neither string matches the clip, and a literal name lookup would leave both of them frozen.

## More than twenty spellings, one skeleton

Before a clip touches an avatar, the canonicalizer in src/glb-canonicalize.js reduces each joint name to the canonical one. It strips vendor prefixes and namespaces, collapses separators and case, then looks what is left up in alias tables. Its header lists more than twenty naming schemes, from Mixamo, Unreal, VRM and VRoid, Daz and Genesis, MakeHuman and Blender to Kinect, MediaPipe and the Japanese bone names of MikuMikuDance. Here is one elbow, as eight exporters spell it. I ran every line of this against the current source and each one returns the same canonical name:

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

The Rig Doctor page shows the same mapping for a real file without uploading it. Pointed at Michelle, it rewrites each mixamorig: joint to its canonical name, reports that 52 of her skinned joints were applied, and lists the rest as unrecognised. The leftovers are the fingertip end bones and the toe and head-top end bones, which no clip animates.

![Rig Doctor's bone rewrites for michelle.glb: mixamorig:Hips becomes Hips, mixamorig:LeftForeArm becomes LeftForeArm and so on, followed by the list of unrecognised joints, which are fingertip, toe and head-top end bones.](/x-media/any-skeleton-article/rig-doctor-bone-rewrites.png)

## Hands decide whether a rig animates

Fingers are 30 of the clip library's 53 tracks, so a rig whose hands do not map scores about 40% coverage and gets no animation at all. That is why the tables spell out finger chains per convention, from Unreal's index_01_l to the VRM 1.0 names that call each phalanx proximal, intermediate or distal.

It is the reason the Boxer Dance moves Michelle's fists and not only her arms, and it is the number the coverage panel counts. In Rig Doctor, Michelle scores full marks in every limb group: torso, arms, hands, and legs. The hands row is the one that most often falls short on exports from other tools.

![Rig Doctor's verdict for michelle.glb: a green banner saying the rig performs the full clip library, the live preview with Idle, Walk, Wave and Dance buttons, and the coverage bars for torso, arms, hands and legs, all full.](/x-media/any-skeleton-article/rig-doctor-coverage.png)

Some names cannot be settled by spelling alone. Rigify names the collarbone shoulder.L and the upper arm upper_arm.L; SMPL names the collarbone left_collar and the upper arm left_shoulder. No table can read those two the same way, so a second pass looks at the hierarchy instead, because the collarbone is the parent of the upper arm.

## A matching name is half the job

Once every track has a bone, the clip still cannot be copied across as it is. The reference rig the clips were baked on rests in an A-pose, and Mixamo rigs rest in a T-pose. Mixamo exports also bake a 90 degree turn into the armature and the hips. Copy a clip's rotations across as they are, and an avatar plays with its limbs in the wrong frame, or tips the body onto its back.

So the retargeter reads each joint's rest rotation on the target, in its own parent's frame and in the model's frame, and replays the clip bone's motion as the same change in world space from that rest. A rig that already matches the reference gets no correction at all. 

The frame below was taken a few seconds after the one at the top. There, the fists were raised at the chest. Here the arms have swung out and down, the knees are bent, and the four bodies are still in step.

![The same four avatars a few seconds later in the Boxer Dance: arms swung out and knees bent, still in step with one another.](/x-media/any-skeleton-article/four-rigs-one-dance-b.png)

## Motion crosses over, bone lengths stay behind

The clip file carries a position and a scale for each of its 52 bones as well. Those encode the reference rig's bone lengths, and copying them would stretch every avatar into the reference body. So the retargeter refuses them. Only joint rotations and the root (Hips) translation are true motion, so only those cross over, and the hip track is rescaled so root motion lands at the new rig's height. That is how a chibi with a head as wide as its shoulders keeps its own proportions instead of being stretched into the reference body.

The clip also holds a position track and a scale track for every bone, and the table above leaves those out of its count because they describe someone else's body.

## Why the library bets on one skeleton

The cost of this design lands in one place. A new clip is retargeted once, at build time, onto the reference rig. `npm run build:animations` retargets to the Avaturn rig, writes a JSON clip to public/animations/clips and updates the manifest. After that, the clip works on every rig the canonicalizer understands, with no per-avatar work and no per-avatar file.

Compare the alternative. A clip library that had to be re-authored for each skeleton would grow with the number of clips times the number of rigs, and every new naming scheme would put the whole library back in the queue. With one reference skeleton the growth is the sum, not the product: a new clip is added once, and a new naming scheme is a few lines in an alias table. That is also why the contribution guide for a missing rig convention is a short document rather than a project.

The agents on the platform use the same property. An agent does not ask for a file. It asks for a slot such as celebrate or bow, a slot resolves to a clip name in the manifest, and the clip is retargeted onto whichever body the owner gave that agent. An owner can point a slot at any clip in the manifest, and the Boxer Dance in the pictures above is just a manifest name, the same as idle.

## Where it stops on purpose

The retargeter would rather leave an avatar alone than animate it badly. That is what the last two rows of the results table are about, and why a refusal there is the right answer for a body the clip was not made for.

- A model needs a skinned mesh and at least eight canonical bones before the library will drive it. Anything less is treated as a prop and shown as authored.
- A clip that finds a home for less than half of its tracks on a rig is not played on it.
- When the body maps but the arms do not, the idle still plays on the torso and legs, and the stuck arms are swung down to a relaxed rest by their direction, with no name needed.
- Control rigs from some Blender add-ons are skipped deliberately. Their deform bones hang off tracker nodes instead of forming a chain, and glTF has no constraints to carry, so moving them would pull the arm apart. Those uploads need re-rigging, not renaming.

The limits above each live in one place in the source, so you can check them rather than take our word:

| Rule | Where it lives | Value |
|---|---|---|
| Smallest skeleton the library will drive | `MIN_CANONICAL_BONES` in src/animation-manager.js | 8 bones, and a skinned mesh |
| Smallest share of a clip's tracks that must find a bone | `MIN_COVERAGE` in src/animation-retarget.js | 0.5 |
| Tracks that cross onto another rig | src/animation-retarget.js | rotations, plus Hips translation |
| Upper arms in a rendered thumbnail | docs/avatar-thumbnails.md | at least 30 degrees below horizontal |
| Canonical joints in the reference skeleton | `CANONICAL_BONES` in src/glb-canonicalize.js | 52 |

Take the fox. None of its joints is a canonical name, so no track has a bone to turn, and the dance does not play. The half-body avatar is the middle case: its row in the table clears the floor, so the clip plays on the joints it does match and leaves the rest of the body at rest.

The arm case deserves a closer look, because it is the one that would look broken on screen. Suppose a file names its torso and legs in a way the canonicalizer knows but spells its arms in a convention it does not. The clip still clears the coverage floor, so it plays, and the body idles while both arms stay stuck out sideways in the authored bind pose. The module that guards against this finds the stuck arms geometrically: it looks for a bone whose direction to its child points sideways, not steeply up the way a collarbone does, and swings it down to a relaxed rest. It is gated hard, and runs only when neither canonical upper-arm bone name-mapped, so a rig whose arms the clip already drives is left alone.

A full name map is not a promise of a good performance. A rig can map all 52 joints and still move badly if its bones are oriented in an unusual way, and the mesh follows whatever skin weights it was given: a sleeve weighted to the wrong bone bends with that bone. Rig Doctor tells you which joints mapped. It does not judge the weighting.

## Thumbnails stand at rest too

The same path poses still pictures. Before a renderer frames an avatar for a thumbnail or a social card, it plays one held frame of the standing idle through the retargeter, then checks that both upper arms end at least 30 degrees below horizontal. A pose that fails the check falls back to the geometric arm swing. If that fails as well, the model renders as authored and is reported, rather than replaced with something worse.

## Run it on your own avatar

Everything above can be reproduced in a few lines. The HTML snippet is the page I used to put four avatars side by side. It loads the web component, waits for each avatar, and starts the same library clip on all of them:

```html
<script type="module" src="https://three.ws/agent-3d/1/agent-3d.js"></script>

<agent-3d body="https://three.ws/avatars/michelle.glb"></agent-3d>
<agent-3d body="https://three.ws/avatars/dancing-twerk.glb"></agent-3d>
<agent-3d body="https://three.ws/avatars/studio.glb"></agent-3d>
<agent-3d body="https://three.ws/avatars/cz.glb"></agent-3d>

<script type="module">
  const els = [...document.querySelectorAll('agent-3d')];
  await Promise.all(
    els.map((el) => new Promise((done) => el.addEventListener('agent:ready', done, { once: true }))),
  );
  for (const el of els) await el.playClip('av-boxer-dance', { userInitiated: true });
</script>
```

The Node snippet is the coverage count behind the table. Run it from a checkout of the repository with a clip name and any number of GLB files from the avatars folder. It reads each file's skin joints, canonicalizes their names, and counts how many rotation tracks plus the Hips translation find a bone:

```js
import { canonicalizeBoneName } from './src/glb-canonicalize.js';

const clipName = 'av-boxer-dance';
const clip = await (await fetch(`https://three.ws/animations/clips/${clipName}.json`)).json();
const wanted = clip.tracks
  .map((t) => t.name)
  .filter((n) => /\.quaternion$/.test(n) || n === 'Hips.position');

for (const file of process.argv.slice(2)) {
  const res = await fetch(`https://three.ws/avatars/${file}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());

  const joints = new Set();
  for (const skin of json.skins ?? []) skin.joints.forEach((j) => joints.add(j));

  const canonical = new Set();
  for (const j of joints) {
    const name = canonicalizeBoneName(json.nodes[j].name);
    if (name) canonical.add(name);
  }
  const hits = wanted.filter((n) => canonical.has(n.split('.')[0])).length;
  console.log(file, `${joints.size} joints, ${canonical.size} canonical, ${hits}/${wanted.length} tracks`);
}
```

Run it as `node coverage.mjs michelle.glb fox.glb` and it prints the same rows as the table. If a row of yours comes out low, the Rig Doctor page will show you which joints are missing before anything else.

## Credits for the open work underneath

New bodies get their skeletons from open research: Make-It-Animatable (MIT, CVPR 2025) predicts joint positions and skinning weights for meshes that arrive without a rig. The Quaternius Base character in the avatar library is published under CC0. Three.js, which draws every frame in the pictures above, is MIT licensed.

## The partners behind the retargeter
three.ws builds alongside eight partners across AI, cloud, hardware, infrastructure and media. Each is an independent company, and each line below is taken from how [three.ws/partners](https://three.ws/partners) describes the partner.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The 3D Studio connector gives ChatGPT eleven keyless 3D tools.

**IBM.** The partners page lists IBM as a Strategic partner: three.ws 3D agent identity integrates with IBM watsonx and IBM Granite.

**Amazon Web Services.** The partners page lists Amazon Web Services under Cloud: three.ws is deployed on AWS infrastructure with Marketplace availability.

**Google Cloud.** The partners page lists Google Cloud under Cloud: its Vertex AI integration lets agents leverage Gemini models alongside the three.ws identity layer.

**Alibaba Cloud.** The partners page lists Alibaba Cloud under Cloud: it extends three.ws into APAC markets with Qwen model integration.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's program for startups building on accelerated computing. Every 3D generation lane already runs on NVIDIA silicon. The auto-rigging worker that gives a new mesh its skeleton runs Make-It-Animatable on an NVIDIA L4.

**HackerNoon.** The partners page lists HackerNoon under Media: a builder-focused publishing partnership, with articles published to HackerNoon's developer audience.

**Quicknode.** three.ws is a member of the Quicknode Startup Program with approved infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind agent wallets.

## Try it

Check a GLB in [Rig Doctor](https://three.ws/rig-doctor) and see which of its joints map. Nothing is uploaded. The [Avatar Artifact viewer](https://three.ws/avatar-artifact) shows a model on its own page, and the [Animation Studio](https://three.ws/pose) plays the rest of the library on a loaded avatar. Browse every clip in the [animation gallery](https://three.ws/animations), and generate a new body to try them on at [three.ws/create/prompt](https://three.ws/create/prompt). If your rig uses a naming scheme the tables do not know, the [web component reference](https://three.ws/docs/web-component) documents `playClip` for your own page, and the canonicalizer source is open to read.
