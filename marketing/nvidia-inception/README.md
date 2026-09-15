# marketing/nvidia-inception/

Campaign assets for the NVIDIA Inception membership. Membership was accepted July
2026 and never announced on our own social channels, which is the gap this
directory closes.

NVIDIA confirmed on 2026-09-14 that its Marketing Assets page is available again at
`Inception portal > Benefits > Co-Branded Marketing Assets`. The checked-in badge is the
asset already used by the site, but the owner must download the current package and compare
its badge and usage guidance before any new campaign is published. Record the archive name,
download date, and whether the SVG changed here when that is done.

| File | What it is |
| --- | --- |
| [social-copy.md](social-copy.md) | Paste-ready posts for X, LinkedIn, and Telegram, plus the badge and no-endorsement rules every one of them follows. Owner-gated: drafted, not posted. |
| [assets/three-ws-nvidia-1920x1080.png](assets/three-ws-nvidia-1920x1080.png) | Lead catalog screenshot: the dedicated NVIDIA product and integration page. |
| [assets/three-ws-audio2face-1920x1080.png](assets/three-ws-audio2face-1920x1080.png) | Browser-native Audio2Face-3D and Riva demo screenshot. |
| [assets/three-ws-forge-1920x1080.png](assets/three-ws-forge-1920x1080.png) | Supporting Forge product screenshot; it includes token controls, so do not use it as the lead NVIDIA image. |

Strategy lives in docs, not here:

- [docs/nvidia-visibility-map.md](../../docs/nvidia-visibility-map.md): every NVIDIA surface, the verified intake route for each, and the member benefits still unclaimed
- [docs/nvidia-apps-catalog-listing.md](../../docs/nvidia-apps-catalog-listing.md) and [docs/nvidia-apps-catalog-request.md](../../docs/nvidia-apps-catalog-request.md): the Accelerated Apps Catalog listing kit and its outbound email
- [docs/nvidia-inception.md](../../docs/nvidia-inception.md): what the membership is, and the rule that it is a program rather than a partnership or an endorsement
- [docs/nvidia-ngc-listing.md](../../docs/nvidia-ngc-listing.md): the NGC catalog kit, the only NVIDIA listing with a self-serve intake form
- [docs/nvidia-forum-browser-digital-human.md](../../docs/nvidia-forum-browser-digital-human.md): NVIDIA Developer Forums post 3, the browser-native Audio2Face-3D write-up, drafted and owner-gated

## Assets

- Existing member badge: [public/marks/nvidia-inception-badge.svg](../../public/marks/nvidia-inception-badge.svg), used unmodified and already live in the site footer. Reconcile it against the restored portal package before new use.
- Brand marks and lockups: [public/brand/](../../public/brand)
- Demo to capture for the highest-value clip: `/demos/audio2face`

## Portal retrieval checklist

- [ ] Download the current badge package, social kits, event assets, and brand guidelines.
- [ ] Record the archive filename and download date here.
- [ ] Compare the supplied badge with `public/marks/nvidia-inception-badge.svg`.
- [ ] Record clear-space, background, attribution, and social-tag requirements here.
- [ ] Replace assets only if NVIDIA's current package differs.
- [ ] Approve and publish the prepared posts in `social-copy.md`.

## NVIDIA review demo, 60 seconds

NVIDIA said Pavilion candidates should make the acceleration visible. Use this sequence for
any program review, Showcase pitch, or contact introduction:

1. Open `/nvidia` (10 seconds). Say: “three.ws has two runtime layers: self-hosted NVIDIA
   GPU workers for 3D and NVIDIA-hosted NIM/NVCF services around them.”
2. Open `/forge`, select the free NVIDIA/TRELLIS lane, and submit one centered-object prompt
   (25 seconds). Say: “This is a real textured GLB generated in the browser workflow, not a
   prerendered image.”
3. Open `/demos/audio2face`, press Speak, and point to the live pipeline state and returned
   blendshapes (20 seconds). Say: “Riva Magpie produces the voice; Audio2Face-3D returns the
   facial track; the browser maps it onto the loaded avatar.”
4. End on the downloadable GLB or moving face (5 seconds). Say: “No plugin, game engine, or
   visitor install.”

Capture browser chrome so the browser-native claim is visible. Use the prepared NVIDIA-page
and Audio2Face PNGs as still-image backup. Do not lead with the Forge capture because it
contains `$THREE` holder controls, and do not call a fallback result NVIDIA-generated unless
the live pipeline identifies the NVIDIA lane.
