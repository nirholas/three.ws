# Video to Motion launch announcement (order 090 landing)

**Status: not posted.** Owner order 938, item 7. Re-verified 2026-11-14.

The landing shipped in order 090 on 2026-10-13 (`/video-to-motion`, doc `docs/video-to-motion.md`)
and was never announced. This file is the copy.

## Facts the copy relies on (checked 2026-11-14)

| Claim | Source | Value |
| --- | --- | --- |
| Page is live | `curl -s -o /dev/null -w '%{http_code}' https://three.ws/video-to-motion` | 200 |
| No account needed | `api/motion-swap.js` | per-IP rate limit only; sign-in is needed only to save a clip to an agent |
| Upload cap and processing cap | `src/video-to-motion.js` `MAX_UPLOAD_BYTES` | 256 MB, first 90 seconds processed |
| Outputs | `docs/video-to-motion.md` | GLB (baked on the previewed avatar), BVH (canonical skeleton), FBX (server conversion, rig preserved) |
| Your own rig | `docs/video-to-motion.md` | load any rigged humanoid GLB by URL or file; retarget runs in the browser |
| Capture time | `docs/video-to-motion.md` | about two minutes for a 30-second clip |

On the day you post, open the page, run one short clip through it and confirm all three
downloads still work before posting.

## Naming the closed services

Default: do not name them. The copy speaks to "your mocap service shut down" without naming any
company, which matches the house rule that competitors stay unnamed and avoids a claim about a
third party's status that could go stale. Naming them is the owner's call (order 938, item 7);
if you decide to, add the names only to the first post and link each one's own shutdown notice.

## X post

> Your online mocap service shut down, but you still have the footage.
>
> three.ws/video-to-motion turns a video of someone moving into an animation file: GLB, BVH or FBX. Preview it on your own rig, trim it, download it. No account.

## Follow-up reply (thread)

> How it works: upload up to 90 seconds of one person, full body in frame. The server tracks pose in every frame (about two minutes for a 30-second clip), then the clip retargets onto whatever humanoid GLB you load, right in the browser.
>
> BVH comes out on a canonical skeleton, so it drops straight into Blender, MotionBuilder or Unreal's IK Retargeter.

## Short version (Discord, community channels)

> New: three.ws/video-to-motion. Drop in a video of a person, get the motion back as a GLB, BVH or FBX you can retarget onto any humanoid rig. Free, no account. Built for anyone whose markerless mocap service closed and who still has clips to convert.

## Owner steps

1. Run the day-of check above.
2. Post the X post, then the reply under it; post the short version in the community channels.
3. Log the post URL and date in the `Video to Motion launch announcement` row of
   `marketing/growth/opportunities.csv`.
