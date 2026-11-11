# Announcement pack: NVIDIA Inception run-back

**Surface:** [`/nvidia`](https://three.ws/nvidia) · **Stage:** drafted, awaiting approval to post
· **Follows:** the Jul 20 Inception membership post (28K views, 358 likes, 117 reposts by 2026-11-11)

The first post proved the NVIDIA logo moves our audience. Reposting it adds nothing, so this one
puts a "four months later" milestone behind the same logo: real production numbers and the GTC 2027
poster. Every figure comes from the published post
[three.ws and NVIDIA: Inception, the GPU Fleet, and Our GTC 2027 Poster](https://three.ws/blog/three-ws-nvidia-inception-gtc-2027)
(2026-11-04), which is the link in the post.

## The claims, and where each is checked

| Claim | Source |
|---|---|
| 13 NVIDIA GPU deployments in production (12 L4, 1 RTX PRO 6000 Blackwell) | Blog post, fleet table |
| 19,270 3D meshes generated on our own GPUs in 31 days | Blog post (2026-08-31 to 2026-09-30) |
| 3.8 s median from text to a speaking, animated face | Blog post, headline figures |
| 98.1% of morphed user rigs driven by one Audio2Face-3D track | Blog post; `node scripts/a2f-rig-coverage.mjs` |
| GTC 2027 poster | Blog post and [nvidia-gtc-2027-poster.md](../nvidia-gtc-2027-poster.md). Say "submitted" only if the owner submitted it by the 2026-11-10 deadline; otherwise say "our GTC 2027 poster" without claiming acceptance |

## Posting rules

- Say "NVIDIA Inception member" or "in NVIDIA Inception". Never "NVIDIA partner", "backed by" or
  "endorsed by". Inception is a startup program, not a partnership or an investment.
- Tag `@NVIDIAAIDev` and add `#NVIDIAInception`. Per [nvidia-visibility-map.md](../nvidia-visibility-map.md#social-surfaces-ours-to-drive),
  posts with the official badge, the right handle and the hashtag are the ones NVIDIA's social team
  can reshare. A plain `@NVIDIA` mention in prose is not.
- Use the restored official co-brand kit (Portal > Benefits > Co-Branded Marketing Assets) for the
  card, the same way the Jul 20 video carried the official Inception lockup.
- Media: a 10 to 15 second capture of [/demos/audio2face](https://three.ws/demos/audio2face) (a face
  lip-syncing in a browser tab) beats a static card. The GTC poster image is
  `public/x-media/gtc-poster/poster.png` as a second attachment.
- Cross-post to LinkedIn and tag **NVIDIA for Startups** (82k+ followers). The Jul 20 post never went
  there, and that account is where NVIDIA reshares member milestones.
- Keep $THREE out of the post body so NVIDIA's team can reshare it. The coin can go in a reply.

## Post

Bytes in [nvidia-inception-runback.post.txt](./nvidia-inception-runback.post.txt):

> Four months in NVIDIA Inception. Here is what runs on NVIDIA at three.ws today:
>
> 13 GPU deployments in production, 12 L4 and one RTX PRO 6000 Blackwell
> 19,270 3D meshes generated on our own GPUs in 31 days
> 3.8 seconds median from a sentence to a talking, lip-synced 3D face, in a browser tab
> 98.1% of user rigs driven by a single Audio2Face-3D track
>
> We wrote it all up, including our GTC 2027 poster. @NVIDIAAIDev #NVIDIAInception
>
> three.ws/blog/three-ws-nvidia-inception-gtc-2027

## Save the bigger one

The NGC container (TRELLIS) passed inference on A100 and L4 on 2026-11-10. When the NGC listing is
live, that is an NVIDIA-hosted page with our name on it, and it gets its own post. Do not claim it
before the listing resolves.

## Ship

```bash
node scripts/post-tweet.mjs --file docs/announcements/nvidia-inception-runback.post.txt --dry-run
```
