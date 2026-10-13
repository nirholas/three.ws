# Adobe Mixamo redistribution permission request

Draft only. Sending this is owner order 938: nobody should submit it without the owner's
explicit go-ahead, since it is outbound contact with a third party on the owner's behalf.

## Why we need this

[`api/animations/library.js`](../../../api/animations/library.js) used to serve a bulk motion
library baked from Mixamo (`scripts/mixamo-all.mjs`) as raw clip JSON, mirrorable by anyone
through [`scripts/mirror-animation-library.mjs`](../../../scripts/mirror-animation-library.mjs).
Mixamo's own community FAQ states the license permits royalty-free use of the animations inside
a project but not redistribution of the raw character/animation files themselves (quoted below).
We have since rebuilt that library from CC0 sources (Quaternius's Universal Animation Library 2
and Mesh2Motion's animation packs) and the Mixamo-baked clips no longer publish anywhere public.
This letter exists for the separate, narrower case: if we ever want to keep (or re-add) specific
Mixamo clips in that public, redistributable library, we need Adobe's explicit written permission
first, because the FAQ language does not grant it on its own.

## Target and channel

- **Target**: Adobe's Mixamo team / Adobe Developer Relations.
- **Channel**: the contact form at helpx.adobe.com/contact (category: Mixamo), or
  mixamo-support if a direct mailbox is published at send time. Re-check the current contact
  path before sending; Adobe's support routing changes.
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

We'd like to go one step further for a specific, narrow case: publishing a curated subset of
retargeted Mixamo motion clips (serialized as `three.js` `AnimationClip` JSON, not the original
FBX/GLB character or animation files) through a public developer-facing API endpoint, so that
other Three.js and WebGL developers can pull named motions (walk, idle, wave, and similar common
gestures) into their own non-Mixamo avatar rigs the same way our own product does. We understand
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

We've already removed Mixamo-derived clips from our public bulk-motion-library endpoint while we
wait to hear from you, and replaced that library with CC0-licensed sources (Quaternius's
Universal Animation Library and Mesh2Motion's animation packs) so our public developer-facing
surface ships nothing we are not certain we may redistribute. We'd welcome the chance to do more
with Mixamo if there's a path to it.

Thank you for your time, and please let us know if you need anything else from us to evaluate
this.

Best,
The three.ws team

---

## Evidence referenced in the letter

- Adobe's Mixamo community FAQ (community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-
  royalties-ownership-eula-and-tos/m-p/13234775): "really the only thing you can't do is
  distribute the raw character and animation files." This is the sentence the letter and our own
  code comments (`scripts/mixamo-all.mjs`, `scripts/cc0-animation-library.mjs`) quote as the
  reason the bulk library no longer serves Mixamo-derived clips.
- Current state at draft time: the public bulk library (`GET /api/animations/library`) serves
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

Review the letter above, make any edits, then submit it through Adobe's current Mixamo contact
channel (owner order 938). Record the submission date, channel used, and any reference/ticket
number Adobe returns in this file once sent.
