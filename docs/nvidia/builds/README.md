# NVIDIA builds: the plan

Written 2026-11-26. This is the plan for the nine builds that came out of the
[NVIDIA showcase research](../../nvidia-showcase-research.md). Each build has a
design doc in this folder and a work order in `prompts/finish/` that one agent
runs from start to finish.

Nothing on this page is shipped unless its status says so. A NVIDIA technology
counts as "used" only once it serves real visitors in production. Until then it
is "under evaluation", here and in everything we send NVIDIA.

## How to use this page

1. Pick a build from the table. Read its design doc if you want the detail.
2. Open its work order, paste the whole file into a new agent, and let it run.
   Orders do not depend on each other, so any number can run at the same time.
3. When an agent finishes, it reports the measured number and what waits on
   you. It also updates the status column here.

## The nine builds

| # | Build | Design | Order | New GPU service | The number it leaves behind | Status |
|---|---|---|---|---|---|---|
| 1 | Our own Audio2Face-3D face service | [871](871-self-hosted-audio2face.md) | [order](../../../prompts/finish/871-nvidia-21-self-hosted-audio2face-worker.md) | yes | share of talking-avatar requests that get real facial animation; cold and warm latency; match against the hosted lane | planned |
| 2 | Kimodo motion engine beside the current one | [872](872-kimodo-motion-engine.md) | [order](../../../prompts/finish/872-nvidia-22-kimodo-motion-engine.md) | yes | success rate, latency and quality scores on the same 40 prompts through both engines | planned |
| 3 | One scene idea becomes a matched kit of props | [873](873-scene-kit.md) | [order](../../../prompts/finish/873-nvidia-23-scene-kit-from-one-prompt.md) | no | time from one sentence to a finished kit; objects per kit that pass | planned |
| 4 | three.ws tools for NemoClaw agents under an OpenShell policy | [874](874-nemoclaw-openshell.md) | [order](../../../prompts/finish/874-nvidia-24-nemoclaw-openshell-integration.md) | no | three recorded end-to-end runs; a policy proven to deny what it should | planned |
| 5 | Physics-checked simulation-ready assets | [875](875-physics-checked-simready.md) | [order](../../../prompts/finish/875-nvidia-25-physics-validated-simready.md) | maybe | pass rate by object class over 200 real exports | planned |
| 6 | A 3D face for NVIDIA's Nemotron Voice Agent blueprint | [876](876-voice-agent-face.md) | [order](../../../prompts/finish/876-nvidia-26-voice-agent-blueprint-face.md) | no | audio-to-mouth offset (median and 95th percentile); latency the face adds | planned |
| 7 | A watch for NVIDIA contests, calls and events | [877](877-opportunity-watch.md) | [order](../../../prompts/finish/877-nvidia-27-nvidia-contest-and-event-watch.md) | no | opportunities caught with their deadlines; zero duplicate alerts | planned |
| 8 | An avatar that says one line in every supported language | [878](878-multilingual-avatar.md) | [order](../../../prompts/finish/878-nvidia-28-multilingual-talking-avatar.md) | no | per language: time to first audio, time to first face frame, translation check score | planned |
| 9 | An open pack of simulation-ready props made by Forge | [879](879-simready-prop-pack.md) | [order](../../../prompts/finish/879-nvidia-29-open-simready-prop-dataset.md) | no | validated assets in the pack; pass rate by class; time and GPU cost per asset | planned |

## If you cannot run all nine at once

All nine can run together. If agent capacity is the limit, this is the order
that pays back fastest.

**First: fix what is broken and catch what is about to open.**

- **871, the face service.** The hosted Audio2Face lane answered 7 of 56 health
  probes in the 7 days to 2026-11-26, so most talking avatars fall back to a
  simpler mouth today. Every other avatar build on this page (876, 878) and
  several earlier orders (the conference demo, the clip export, emotion) look
  better once the face is reliable.
- **877, the watch.** No GPU, small, and GTC Washington, D.C. runs December 1 to
  3, 2026. Announcements cluster around events, and we have already missed two
  contests because nobody saw them open.

**Second: things a visitor can use.**

- **878, the multilingual avatar.** Every part exists. It is wiring, a language
  switcher and a demo page.
- **873, the scene kit.** The one step of NVIDIA's own 3D blueprint we lack.

**Third: things NVIDIA developers can pick up.**

- **874, NemoClaw and OpenShell.** Agents are NVIDIA's largest 2026 push and
  this is the one community channel it named.
- **876, the voice agent face.** NVIDIA's voice agent has no face and no avatar
  blueprint exists.

**Fourth: the longer measurements.**

- **875, physics checks**, then **879, the prop pack**. 879 is better after 875
  because the pack can then carry a physics result per asset, but it does not
  wait for it.
- **872, Kimodo.** The current motion engine works. This is a second engine and
  a comparison, so it is the least urgent.

## Where builds can get in each other's way

The orders are independent, but three resources are shared.

| Shared thing | Who touches it | What keeps it safe |
|---|---|---|
| The reference-image rung (about 1 image per 45 seconds for the whole site) | 873 (6 objects), 874 (5 models), 875 (3 models), 879 (a background builder) | Every one of them yields to real visitors. If you run 879's builder while 873 or 874 is testing, their tests just take longer. |
| GPU quota in `aerial-vehicle-466722-p5` (us-central1 L4 quota is fully held) | 871, 872, possibly 875 | Each deploys to a region where it cannot compete with the protected TRELLIS lane, at minimum instances 0 and maximum 1. |
| Files several builds edit (`data/changelog.json`, `data/pages.json`, `STRUCTURE.md`, `docs/nvidia-models.md`, `docs/nvidia-apps-catalog-listing.md`, `api/_lib/nvidia-lanes.js`) | all | Each order re-reads a shared file right before a small anchored edit and stages explicit paths only. |

Two builds touch the same feature area and are still safe to run together: 871
adds a second face lane inside `api/a2f.js`, and 878 only calls the face path
as it is served.

## What waits on you

None of this blocks an agent from finishing its build. It is the list of things
only the owner does.

| When | What | Unlocks |
|---|---|---|
| After any build lands | `git push threews main` and the API deploy (`npm run deploy:gcp:full`) | The build is live for visitors. Until then it is committed and tested, not serving. |
| After 871 and 872 report | Decide whether the new face or motion engine serves first. Each report gives the one-line change and the numbers. | Promotion of a new lane. The default is that the working lane keeps its place. |
| After 874 reports | Open the pull request on `NVIDIA/nemoclaw-community` with the prepared text | Our entry in NVIDIA's community use cases |
| After 876 reports | Post the prepared forum write-up | A NVIDIA-forum post with measured numbers and code |
| After 879 reports | Create the Hugging Face dataset and run the one upload command | The pack is public where robotics developers look |
| After each build is live | Update the Inception portal record and the catalog listing with the technology that now serves | The technology moves from "under evaluation" to "used" |
| Now | Send the catalog reply to Jiyeon ([text](../../nvidia-apps-catalog-request.md)) if it has not gone | The Accelerated Apps Catalog listing |

## What each build lets us say, and where

| Build | Once it is live we can truthfully say | Where it goes |
|---|---|---|
| 871 | Facial animation runs on the open Audio2Face-3D SDK on our own NVIDIA GPUs, with measured latency | Catalog record, `/nvidia` page, a forum post |
| 872 | Motion can be generated by NVIDIA Kimodo, with a published comparison | Catalog record, `/nvidia` page |
| 873 | The pipeline of NVIDIA's 3D Object Generation Blueprint, hosted in a browser with no RTX PC | Product page, a forum post that compares requirements honestly |
| 874 | A NemoClaw agent can generate 3D models through three.ws under a least-privilege OpenShell policy | NVIDIA's community repository |
| 875 | Text to a simulation-ready asset that has been dropped, settled and rendered in NVIDIA's own libraries | Catalog record, a forum post with the pass rates |
| 876 | NVIDIA's voice agent blueprint with a face that renders in the visitor's browser | A forum post, the integration directory |
| 877 | Nothing public. It makes sure we enter the next contest. | Internal alert |
| 878 | One avatar, one sentence, every language our NVIDIA voice supports, lips correct in each | Demo page, a short video for social |
| 879 | A free pack of validated simulation-ready props with a report per asset | Hugging Face, the simulation forums |

Every NVIDIA-facing sentence stays technical. No token, price or monetization
vocabulary, no NVIDIA logo on our media, and no claim beyond "three.ws is a
member of the NVIDIA Inception program".

## Dates

| Date | What |
|---|---|
| 2026-12-01 to 12-03 | GTC Washington, D.C. Too close for any of these to be live. What we can show is Forge as it is. |
| 2027-03-15 to 03-18 | GTC 2027. The target for having builds 871, 873, 875 and 878 live with numbers. The poster work is in [nvidia-gtc-2027](../../nvidia-gtc-2027/README.md). |
| Unknown | The next NVIDIA contest. Build 877 exists so we see it the day it opens. |

## Rules that hold for every build

- **Working Forge lanes are not touched.** The self-hosted TRELLIS lane and the
  working reference-image rung keep their code, config and position
  ([forge-protected-lanes.md](../../ops/forge-protected-lanes.md)). New engines
  go behind the working one, and promotion is the owner's decision.
- **No new standing cost.** Every new service scales to zero, has a maximum
  instance count, and reports its measured cost per request.
- **Licenses are read, not assumed.** Each build quotes the clause that permits
  a hosted commercial service before it uses a model or library.
- **Real runs only.** Every number on this page comes from a real run against
  real services.

## The rest of the NVIDIA campaign

Orders 851 to 870 are the earlier part of the same campaign and are listed in
[prompts/README.md](../../../prompts/README.md). The ones closest to these
builds: 864 (OpenUSD export, which 875 and 879 build on), 866 (conference-grade
digital human), 867 (talking-avatar clip export, which 878 reuses if it has
landed), 869 (Audio2Face emotion) and 870 (our own reference-image engine,
which would lift the image budget that 873 and 879 share).

## Keeping this page true

Each work order's close-out tells its agent to update the build's design doc and
its row above: status, the measured number, and the commit in place of the link
to the order (finished orders are archived, so the link would break).
