# Adobe Mixamo redistribution permission request

Draft only. Sending this is owner order 938: nobody should submit it without the owner's
explicit go-ahead, since it is outbound contact with a third party on the owner's behalf.

Re-verified 2026-11-14:

- The public bulk library is confirmed CC0-only: `GET https://three.ws/api/animations/library`
  returns 219 clips (Mesh2Motion human-base 87, human-addon 74, Quaternius Universal Animation
  Library 2 42, Mesh2Motion human-mocap 16), every one `CC0 1.0 Universal`, and the word
  "mixamo" appears nowhere in the response. The draft's "219" and "zero Mixamo" statements are
  true. `/animations` returns 200.
- IS SENDING STILL NEEDED? Yes, but for a narrower and different reason than the old draft
  said, so the letter below was rewritten. Per `prompts/finish/_context/partners-PROGRESS.md`
  (2026-11-04, order 085) the curated in-product Mixamo clips stay. Those clips are still served
  as plain static files on three.ws today: `public/animations/clips/*.json` (113 retargeted
  `AnimationClip` JSON files, of which the Mixamo set is listed in
  `public/animations/LICENSES.md`), `/animations/*.glb` (for example `/animations/Angry.glb`
  returns 200, 732 KB), and `/animations/mixamo/index.json` plus `catalog.json`
  (the Mixamo name map and R2 keys, both 200). So "not redistributed as a raw library" is not
  strictly true: anyone can fetch them. The order 085 decision was not changed here. Owner
  call: either (a) send the letter, or (b) stop serving the Mixamo clip JSON, GLBs and index files
  publicly (serve them only through the app) and skip the letter. Option (b) removes the need
  to ask Adobe but needs an engineering change that this pass did not make.
- Contact path: `https://helpx.adobe.com/contact.html` is live (generic Customer Care page, no
  Mixamo category is listed in its text, so use the general support form and name Mixamo in the
  subject). `https://www.mixamo.com/` is live. No direct Mixamo mailbox is published. The FAQ
  thread moved to
  <https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400>
  (the old `community.adobe.com/t5/...` link redirects there), still contains the sentence "really
  the only thing you can't do is distribute the raw character and animation files", and now points
  to the official FAQ <https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html> (200). Two
  similar permission questions posted in that thread in August 2026 have no Adobe staff reply,
  so do not expect the community forum to produce an answer; use the support form.

## Why we need this

[`api/animations/library.js`](../../../api/animations/library.js) used to serve a bulk motion
library baked from Mixamo (`scripts/mixamo-all.mjs`) as raw clip JSON, mirrorable by anyone
through [`scripts/mirror-animation-library.mjs`](../../../scripts/mirror-animation-library.mjs).
Mixamo's own community FAQ states the license permits royalty-free use of the animations inside
a project but not redistribution of the raw character/animation files themselves (quoted below).
We have since rebuilt that bulk library from CC0 sources (Quaternius's Universal Animation Library
2 and Mesh2Motion's animation packs), so the public library endpoint carries no Mixamo clip. This
letter exists for the separate, narrower case: a curated set of Mixamo clips that stay in the
product (retargeted to our rig, and still reachable as static files on three.ws). We want Adobe's
explicit written permission for that, because the FAQ language does not grant it on its own.

## Target and channel

- **Target**: Adobe's Mixamo team / Adobe Developer Relations.
- **Channel**: the Adobe Customer Care contact page https://helpx.adobe.com/contact.html (no Mixamo
  category listed as of 2026-11-14, so put "Mixamo" in the subject), or a Mixamo mailbox if one is
  published at send time. Re-check the current contact path before sending; Adobe's support routing
  changes.
- **What to attach**: a link to this repo's public `/animations` page so Adobe can see exactly
  what "redistribute" would mean in context, and the current manifest's clip count.

## The letter

---

**Subject: Permission request: redistributing a small set of Mixamo motion clips as part of an open developer library**

Hello,

I'm writing on behalf of three.ws (https://three.ws), a platform for building, animating, and
rigging 3D AI agents on the web with Three.js. We use Mixamo today exactly as your FAQ describes:
retargeting Mixamo motion clips onto our own and user-uploaded avatar rigs, played back inside
our product. That use is working well for us and we're grateful Mixamo exists.

We want to confirm one specific case. Our product plays a curated set of retargeted Mixamo motion
clips (serialized as `three.js` `AnimationClip` JSON, not the original FBX character or animation
files) on our own rig, and those JSON files are fetchable from our website as static assets, so
other Three.js and WebGL developers could in principle pull named motions (walk, idle, wave, and
similar common gestures) onto their own non-Mixamo avatar rigs. We understand
from your community FAQ that Mixamo's current terms permit using the animations inside a project
but do not permit redistributing the raw character or animation files, and we want explicit
permission before doing anything that could fall into that second category, rather than relying
on our own interpretation.

Specifically, we're asking:

1. Whether Adobe would permit distribution of *retargeted, re-serialized* motion-curve data
   (joint rotations and root translation baked into our own `AnimationClip` JSON format, with no
   Mixamo character mesh, textures, rig, or original file format included) through a public API,
   with clear per-clip attribution to Mixamo as the motion source.
2. If yes, whether there are specific clips, categories, or a maximum count Adobe would be
   comfortable with, and whether a written license or usage agreement needs to accompany any
   such request.
3. If no, whether Adobe can point us to the right internal team or licensing contact for a
   conversation about a future partnership on this specific use case.

We've already removed Mixamo-derived clips from our public bulk-motion-library endpoint and
replaced that library with CC0-licensed sources (Quaternius's
Universal Animation Library and Mesh2Motion's animation packs) so our public developer-facing
surface ships nothing we are not certain we may redistribute. We'd welcome the chance to do more
with Mixamo if there's a path to it.

Thank you for your time, and please let us know if you need anything else from us to evaluate
this.

Best,
The three.ws team

---

## Evidence referenced in the letter

- Adobe's Mixamo community FAQ (now
  community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400;
  official FAQ at helpx.adobe.com/creative-cloud/faq/mixamo-faq.html): "really the only thing you can't do is
  distribute the raw character and animation files." This is the sentence the letter and our own
  code comments (`scripts/mixamo-all.mjs`, `scripts/cc0-animation-library.mjs`) quote as the
  reason the bulk library no longer serves Mixamo-derived clips.
- Current state (re-checked 2026-11-14): the public bulk library (`GET /api/animations/library`) serves
  219 CC0-sourced clips from Quaternius's Universal Animation Library 2 and Mesh2Motion's human
  animation packs, both CC0 1.0 Universal. No Mixamo-derived clip is reachable through that
  endpoint or its mirror script; `api/animations/library.js`'s `isPublishable()` filter drops any
  manifest entry without a `license` field or whose `source` names Mixamo as a second layer of
  defense.
- The already-uploaded Mixamo-derived R2 objects from before this change are left in storage
  (deleting them is treated as an unrecoverable-data action) but are no longer referenced by the
  published manifest, so they are unreachable through the product even though the objects still
  exist.

## Owner's action

Decide between sending the letter and taking the Mixamo files out of public static hosting
(see the 2026-11-14 note at the top). To send, review the letter above, make any edits, then submit
it at https://helpx.adobe.com/contact.html (owner order 938). Record the submission date, channel used, and any reference/ticket
number Adobe returns in this file once sent.
