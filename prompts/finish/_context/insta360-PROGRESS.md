# insta360 campaign: progress log

Cross-chat handoff log for orders 331 to 347. Context and contract: [insta360-00-CONTEXT.md](insta360-00-CONTEXT.md). Append one dated entry per finished order at the end of this file: order number, commit SHAs, what was proven live with its numbers, any contract extension, and what waits on the owner. Re-read the file right before appending; siblings write here too.

## Entries

2026-11-21: campaign filed. 17 orders (331 to 347). Orders 331 to 346 are independent and can run in parallel; 347 runs last.

2026-11-21: 337 fixtures (three-ws-c8, partial; three-ws-80's subagent owns the rest of the 337 service). Commit f42127da9. The verify set was empty, so three real Wikimedia Commons equirect videos are now mirrored into `gs://three-ws-capture-fixtures/insta360/` and marked `verify: true` in the shared `MANIFEST.json`: `commons-moscow-metro-interior-2023` (CC0, 3840x1920, 30 s, 42 MB), `commons-old-ghost-road-walkaround` (CC BY-SA 3.0, 4096x2048, 225.5 s, 869 MB) and `commons-norah-head-insta360-x5` (CC BY 3.0, Insta360 X5, 7680x3840, 488.6 s, 2.47 GB). All three are WebM, so the `equirect_video` sniff must accept EBML as well as ISO BMFF. `workers/model-pano2splat/fixtures/mirror_fixture.py` adds more fixtures, and its generation-guarded merge keeps sibling entries (332's stills are intact). Attribution and SHA-256 are in `fixtures/MANIFEST.md`.
