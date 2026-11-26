# forge-hardening: make Forge as strong as possible, one task per order

Filed 2026-11-26, from a day of live testing of Forge on production ahead of the reply to NVIDIA's App Publishing team about the Accelerated Apps Catalog listing. 87 work orders, `101` to `187`, in [../](../) as `1NN-forge-hardening-NN-<slug>.md`.

This file is for the owner. No order reads it or depends on it.

## How to use the pack

1. Open a fresh Claude Code chat in this repository.
2. Paste the whole of one order file and send it. Nothing else is needed.
3. Repeat with the next file in another fresh chat. One order per agent.

Every order is self-contained: it carries its own facts, commands, rules, scope, tasks, definition of done and report format. No order depends on another, and any of them can run at the same time as any other. Each has its own dev port (`4100` plus its order number), so dev servers never collide.

When an order is finished, its agent moves the file to [../../archive/](../../archive/) in its closing commit. An order still in [../](../) is open.

## The rule every order carries

A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else. Everything else gets fixed. The rule, the measured state and the one command that re-measures it are in [../../../docs/ops/forge-protected-lanes.md](../../../docs/ops/forge-protected-lanes.md), and the full text is inlined in every order. On 2026-11-26 the protected lane was `trellis_selfhost` (911 done, 65 failed in 7 days, 93.3%), and the keyless image rung was protected in position.

## Run these first

- [184](../184-forge-hardening-84-undeployed-fixes-and-deploy-readiness.md): Find out exactly which Forge fixes are not live yet, and make the deploy a single safe command for the owner.
- [101](../101-forge-hardening-01-reference-step-stated-wait.md): Stop asking the image provider twice when it has just said how long to wait.
- [102](../102-forge-hardening-02-throttle-honesty-on-page.md): Tell the user the truth when a provider is busy, instead of "Generation limit reached".
- [103](../103-forge-hardening-03-image-ladder-outage-contract.md): Make the text-to-image ladder fail fast, fall through correctly and recover on its own.
- [182](../182-forge-hardening-82-background-jobs-must-not-starve-users.md): Stop our own scheduled jobs from using the capacity real users are waiting for.
- [177](../177-forge-hardening-77-nvidia-catalog-reply-readiness.md): Verify every claim behind the NVIDIA catalog listing, and draft the reply for the owner to send.
- [105](../105-forge-hardening-05-live-walkthrough-script.md): Build the one command that proves Forge works end to end, as a real user.
- [106](../106-forge-hardening-06-protected-lane-contract-tests.md): Pin the working lane with tests so nobody can move it by accident.

Order 184 comes first because of what it will confirm: on 2026-11-26 at 20:50 UTC production ran commit `f0eed584f` (`curl -s https://three.ws/api/version`), 17 commits behind local `main`. Commit `b41786cd6`, which fixes two bugs in the only image rung that was serving, was committed and not live. Until a deploy happens, the live site shows the old behavior whatever the agents fix.

## Running many at once: the shared limits

The orders are independent in what they change. They still share three real limits, so run them in waves.

- **Live generations.** Production has one GPU behind the main lane (about 24 models an hour at its median time) and, on 2026-11-26, one image rung that allowed one reference image every 45 seconds for the whole service. Every order states its own live budget and most have none: 63 of the 87 orders start no generation at all. If every order ran, the pack would start at most 27 generations in total. Avoid starting more than about five orders with a live budget in the same quarter hour.
- **The QA account.** All agents sign in as the same production QA account, which has one hourly allowance for editing tools. Orders are written to use finished public models as inputs wherever they can.
- **This machine.** Each agent may run a dev server and a browser. Ten to fifteen agents at a time is a sensible ceiling on one devbox.

A workable sequence: the 19 P0 orders first (in two batches), then the 56 P1 orders in batches of ten to fifteen, then the 12 P2 orders.

Several orders touch the same hot files (`src/forge.js`, `api/forge.js`, `pages/forge.html`, `docs/forge.md`). Each order tells its agent to keep those diffs small, re-read before every edit, stage explicit paths and commit promptly. Expect an occasional merge by hand when two agents meet in the same function.

## What no order can do (owner actions)

Each agent stops at the CLAUDE.md gates and reports. These are yours:

- Approve the production deploy (`npm run deploy:gcp:full`) and the `git push threews main`. Order 184 prepares the decision note.
- Send the reply to NVIDIA and rename the portal record. Order 177 verifies every claim and drafts the reply; it never sends.
- Clear the provider holds that took the image ladder down to its last rung: the Google Cloud billing hold (Vertex answered 403), Hugging Face credits (402), OpenRouter credits (402), the OpenAI limit (429). The orders make Forge degrade honestly and fall back while those are down. They do not buy a way around them.
- Run `gcloud auth login` once on this machine. Until then agents cannot read the database or the Cloud Run logs, and each order tells them how to proceed without that.

## The orders

### P0: broken or blocking today (19)

| Order | Area | What it does | Live generations |
|---|---|---|---|
| [101](../101-forge-hardening-01-reference-step-stated-wait.md) | text to 3D, reference image step | Stop asking the image provider twice when it has just said how long to wait | 1 |
| [102](../102-forge-hardening-02-throttle-honesty-on-page.md) | Forge page, error messages | Tell the user the truth when a provider is busy, instead of "Generation limit reached" | 1 |
| [103](../103-forge-hardening-03-image-ladder-outage-contract.md) | text-to-image provider ladder | Make the text-to-image ladder fail fast, fall through correctly and recover on its own | 1 |
| [104](../104-forge-hardening-04-pre-job-failure-visibility.md) | observability, failures before a job exists | Count the generations that die before a job is created | 0 |
| [105](../105-forge-hardening-05-live-walkthrough-script.md) | end-to-end verification | Build the one command that proves Forge works end to end, as a real user | 2 |
| [106](../106-forge-hardening-06-protected-lane-contract-tests.md) | protected lanes, regression safety | Pin the working lane with tests so nobody can move it by accident | 0 |
| [107](../107-forge-hardening-07-seed-range-end-to-end.md) | generation inputs, seeds | Make every seed the page can send valid for every engine it can reach | 1 |
| [108](../108-forge-hardening-08-director-llm-fail-open.md) | prompt direction, LLM chain | Keep generating when every language model is down | 1 |
| [109](../109-forge-hardening-09-photo-to-3d-intake.md) | photo to 3D, upload and validation | Make every photo a user can reasonably drop turn into a model, or a clear reason why not | 1 |
| [110](../110-forge-hardening-10-lane-failover-and-breakers.md) | 3D lane failover | Prove that when the working lane fails, the user still gets a model | 0 |
| [111](../111-forge-hardening-11-job-lifecycle-poll-resume.md) | job lifecycle, polling and resume | Never lose a generation: closing the tab, reloading or double-clicking must all be safe | 1 |
| [112](../112-forge-hardening-12-limits-and-daily-caps.md) | rate limits and daily caps | Make every limit fair, accurate and explained | 0 |
| [113](../113-forge-hardening-13-error-copy-taxonomy.md) | error handling, page copy | Give every error Forge can return a message that says what happened and what to do | 0 |
| [167](../167-forge-hardening-67-input-security-uploads-and-urls.md) | security: what Forge accepts from the internet | Make sure nothing a stranger sends to Forge can reach inside our systems | 0 |
| [168](../168-forge-hardening-68-ownership-and-token-security.md) | security: who may do what | Make sure one user can never see, change or spend another user's Forge work | 0 |
| [169](../169-forge-hardening-69-content-safety-and-takedown.md) | safety: what Forge will make and how it is removed | Make sure Forge refuses what it must, and that removal requests actually remove | 0 |
| [177](../177-forge-hardening-77-nvidia-catalog-reply-readiness.md) | the reply to NVIDIA | Verify every claim behind the NVIDIA catalog listing, and draft the reply for the owner to send | 1 |
| [182](../182-forge-hardening-82-background-jobs-must-not-starve-users.md) | operations: scheduled jobs that share Forge's capacity | Stop our own scheduled jobs from using the capacity real users are waiting for | 0 |
| [184](../184-forge-hardening-84-undeployed-fixes-and-deploy-readiness.md) | operations: what is fixed in code but not live | Find out exactly which Forge fixes are not live yet, and make the deploy a single safe command for the owner | 0 |

### P1: every feature works, with fallbacks and tests (56)

| Order | Area | What it does | Live generations |
|---|---|---|---|
| [114](../114-forge-hardening-14-nim-flux-and-nvidia-text-lane.md) | NVIDIA NIM image rung and NVIDIA text lane | Find out why the NVIDIA FLUX rung times out, and make the NVIDIA lanes of Forge dependable | 1 |
| [115](../115-forge-hardening-15-vertex-reference-image-breaker.md) | Vertex reference image module | Make the Vertex image step step aside instantly when billing blocks it, and come back by itself | 0 |
| [116](../116-forge-hardening-16-trellis2-lane-diagnosis.md) | TRELLIS.2 lane | Find out why the configured first-choice lane serves nothing, without moving traffic onto it | 0 |
| [117](../117-forge-hardening-17-pixal3d-match-my-photo.md) | Pixal3D lane ("Match my photo") | Fix or honestly gate "Match my photo", which fails four times out of five | 1 |
| [118](../118-forge-hardening-18-triposg-sketch-lane.md) | TripoSG lane (sketch to 3D) | Fix sketch to 3D, which fails more often than it works | 1 |
| [119](../119-forge-hardening-19-hunyuan-hf-lanes-and-regions.md) | Hunyuan3D and Hugging Face lanes, region rules | Prove the Hunyuan3D and Hugging Face lanes work as fallbacks and obey their region rules | 0 |
| [120](../120-forge-hardening-20-nvidia-hosted-trellis-lane.md) | TRELLIS hosted by NVIDIA (NVCF) | Make the NVIDIA-hosted TRELLIS lane a fallback we can rely on | 0 |
| [121](../121-forge-hardening-21-byok-geometry-lanes.md) | bring-your-own-key lanes | Make the bring-your-own-key lanes safe with users' keys and honest about failures | 0 |
| [122](../122-forge-hardening-22-multi-view-inputs.md) | multiple photos and generated views | Make multi-view generation help when it works and vanish when it does not | 1 |
| [123](../123-forge-hardening-23-background-removal-photo-prep.md) | background removal and photo preparation | Make photo preparation dependable: background removal, cropping and review | 0 |
| [124](../124-forge-hardening-24-quality-gate-and-retry.md) | quality gate and automatic retry | Make sure the quality gate can only improve results, never block or double-spend them | 0 |
| [125](../125-forge-hardening-25-cache-correctness.md) | generation and catalog caches | Make caching correct: never a wrong model, never a failed one, never a removed one | 0 |
| [126](../126-forge-hardening-26-progress-and-wait-experience.md) | waiting experience | Make the wait honest: real progress, real estimates, and no silence | 1 |
| [127](../127-forge-hardening-27-auth-gating-and-sign-in.md) | sign-in flow around Forge | Make the sign-in wall lose no one: keep the prompt, explain why, and recover from expiry | 0 |
| [128](../128-forge-hardening-28-generation-controls-honored.md) | generation options | Make every control on the page do what it says, or take it off the page | 1 |
| [129](../129-forge-hardening-29-paid-tier-quote-and-keep.md) | pricing, quotes and pay-to-keep (no spending) | Audit the paid paths of Forge so nobody is ever charged for nothing | 0 |
| [130](../130-forge-hardening-30-rig-tool.md) | tools: auto-rig | Make "Rig" turn any reasonable model into one that can move, or say clearly why it cannot | 0 |
| [131](../131-forge-hardening-31-motion-tool.md) | tools: text to motion | Make "describe a motion" produce an animation that plays, on every rigged model | 0 |
| [132](../132-forge-hardening-32-remesh-and-optimize-tool.md) | tools: remesh and optimize | Make "Optimize" produce a smaller model that still looks like the original | 0 |
| [133](../133-forge-hardening-33-stylize-and-materials-tool.md) | tools: stylize and materials | Make restyling change the look without wrecking the model | 0 |
| [134](../134-forge-hardening-34-segment-and-parts-tool.md) | tools: segment into parts | Make "split into parts" give clean, usable pieces | 0 |
| [135](../135-forge-hardening-35-iterate-and-refine.md) | iterate, refine and "more like this" | Make "change this" and "more like this" behave like a conversation, not a lottery | 2 |
| [136](../136-forge-hardening-36-texture-lanes.md) | texture generation and upscaling | Make texturing dependable and worth the wait | 0 |
| [137](../137-forge-hardening-37-game-ready-export.md) | tools: game-ready | Make "Game-ready" produce a file a game engine opens without complaint | 0 |
| [138](../138-forge-hardening-38-splat-generation-and-viewer.md) | Gaussian splats | Make splats generate, load and look right | 1 |
| [139](../139-forge-hardening-39-core-export-formats.md) | downloads and export formats | Make every download open in the tool it is meant for | 0 |
| [140](../140-forge-hardening-40-office-and-engine-exports.md) | exports: PowerPoint, OpenUSD, OneDrive, engines, Minecraft | Make the special exports work end to end, or remove the ones that do not | 0 |
| [141](../141-forge-hardening-41-print-pipeline.md) | 3D printing: prepare, slicer hand-off, print quote | Make "Print it" lead to an object that can actually be printed | 0 |
| [142](../142-forge-hardening-42-ar-viewing.md) | AR on phones and headsets | Make "View in your room" work on the phones people actually have | 0 |
| [143](../143-forge-hardening-43-share-embed-and-previews.md) | sharing, embeds, link previews | Make every shared Forge link look good and load fast, everywhere it is pasted | 0 |
| [144](../144-forge-hardening-44-my-creations-management.md) | a user's own models: list, manage, delete | Make "My creations" a place people can rely on to find and manage their work | 0 |
| [145](../145-forge-hardening-45-community-gallery.md) | the public gallery at /forged | Make the public gallery fast, safe and worth browsing | 0 |
| [146](../146-forge-hardening-46-batch-generation.md) | batch generation | Make batch generation safe for one GPU and clear for the user | 2 |
| [149](../149-forge-hardening-49-workflows-editor.md) | Forge workflows (node editor) | Make the workflow editor run a chain of steps reliably | 1 |
| [150](../150-forge-hardening-50-studio-page-parity.md) | surfaces: Forge Studio | Bring Forge Studio level with the main Forge page, and stop the two from drifting | 1 |
| [151](../151-forge-hardening-51-home-and-alternate-entry-points.md) | surfaces: homepage, /forge-max, /forge-spark, embed | Make every other way into Forge behave like the front door | 1 |
| [152](../152-forge-hardening-52-mcp-3d-tools.md) | surfaces: MCP tools for 3D | Make the MCP tools for 3D reliable for the AI agents that call them | 1 |
| [153](../153-forge-hardening-53-programmatic-api.md) | surfaces: the developer API | Make the developer API for 3D generation correct, documented and hard to misuse | 1 |
| [154](../154-forge-hardening-54-chatgpt-forge-clone-parity.md) | surfaces: the ChatGPT pipeline | Make the ChatGPT copy of the Forge pipeline carry every fix the original has | 0 |
| [156](../156-forge-hardening-56-nvidia-nim-demo-pages.md) | surfaces: the NVIDIA NIM demo pages | Make the NVIDIA NIM demo pages either work or say clearly what they need | 0 |
| [160](../160-forge-hardening-60-page-states-and-clean-console.md) | quality: every state of the Forge page | Give every state of the Forge page a designed screen and a clean console | 0 |
| [161](../161-forge-hardening-61-accessibility.md) | quality: accessibility | Make Forge usable with a keyboard and a screen reader | 0 |
| [162](../162-forge-hardening-62-mobile-experience.md) | quality: phones and tablets | Make Forge work properly on a phone | 0 |
| [163](../163-forge-hardening-63-page-speed.md) | quality: load speed and runtime performance | Make the Forge page fast to open and smooth to use | 0 |
| [164](../164-forge-hardening-64-viewer-correctness.md) | quality: the 3D viewer | Make the viewer show every model correctly and never leave a blank canvas | 0 |
| [166](../166-forge-hardening-66-search-presence-and-product-name.md) | quality: search, link previews and naming | Make Forge findable and consistently named everywhere | 0 |
| [170](../170-forge-hardening-70-stats-and-health-truth.md) | operations: the numbers Forge reports about itself | Make Forge's own health and stats pages tell the truth | 0 |
| [171](../171-forge-hardening-71-daily-smoke-test-coverage.md) | operations: the daily end-to-end check | Make the daily smoke test catch the failures that actually happened | 0 |
| [172](../172-forge-hardening-72-storage-thumbnails-and-retention.md) | operations: files, thumbnails and cleanup | Make sure every finished model keeps its files and has a thumbnail, and that cleanup never eats live work | 0 |
| [173](../173-forge-hardening-73-background-completion.md) | operations: finishing jobs when nobody is watching | Make sure a generation finishes and is saved even if the user closed the tab | 0 |
| [175](../175-forge-hardening-75-forge-test-suite-health.md) | quality: the Forge test suite itself | Make the Forge tests trustworthy: all green, none flaky, none testing nothing | 0 |
| [176](../176-forge-hardening-76-documentation-truth.md) | quality: Forge documentation | Make every Forge document say what the product does today | 0 |
| [178](../178-forge-hardening-78-concurrency-and-queue-honesty.md) | operations: many users at once | Make Forge behave well when many people generate at the same moment | 0 |
| [179](../179-forge-hardening-79-prompt-help-and-enhancement.md) | the prompt box: suggestions and "enhance" | Make the prompt helpers produce better models, and work when the LLM is down | 0 |
| [183](../183-forge-hardening-83-worker-fleet-truth.md) | operations: every GPU worker Forge can reach | Make sure every worker Forge offers is real and reachable, and that Forge offers nothing else | 0 |
| [186](../186-forge-hardening-86-duplicate-submits-and-retries.md) | reliability: the same request sent twice | Make a repeated request return the first job, never a second generation | 0 |

### P2: secondary surfaces and polish (12)

| Order | Area | What it does | Live generations |
|---|---|---|---|
| [147](../147-forge-hardening-47-compare-view.md) | compare view | Make side-by-side comparison accurate and smooth | 0 |
| [148](../148-forge-hardening-48-reel-and-showcase.md) | turntable videos and showcase | Make the shareable video of a model come out right on every browser | 0 |
| [155](../155-forge-hardening-55-teams-and-copilot-bot.md) | surfaces: Microsoft Teams and Copilot | Make "create a 3D model" in Teams finish with a model or a clear message, every time | 0 |
| [157](../157-forge-hardening-57-audio2face-facial-animation.md) | NVIDIA Audio2Face for talking avatars | Make facial animation fall back gracefully when NVIDIA's service is unavailable | 0 |
| [158](../158-forge-hardening-58-garment-generation.md) | wardrobe garments from a prompt | Make generated clothing fit the avatar it is made for | 1 |
| [159](../159-forge-hardening-59-photo-to-scene-objects.md) | a photo into a scene of objects | Make "turn this photo into a scene" return a usable set of objects, or decline cleanly | 0 |
| [165](../165-forge-hardening-65-translations-and-rtl.md) | quality: languages | Make Forge read correctly in every language it claims to support | 0 |
| [174](../174-forge-hardening-74-notifications-and-webhooks.md) | operations: telling users and integrations a model is ready | Make "tell me when it is ready" dependable | 0 |
| [180](../180-forge-hardening-80-forge-off-events.md) | Forge Off competitions | Make Forge Off events run fairly from open to crowning | 0 |
| [181](../181-forge-hardening-81-desktop-app-and-local-generation.md) | Forge desktop and local engines | Make the Forge desktop path honest about what it is and correct about how to install it | 0 |
| [185](../185-forge-hardening-85-region-restricted-engines.md) | compliance: engines that may not serve some regions | Make region restrictions exact, tested and kindly worded | 0 |
| [187](../187-forge-hardening-87-operator-reports.md) | operations: the reports operators rely on | Make the Forge operator reports run, agree with each other, and point at the real problem | 0 |

## Keeping this file true

The directory is the truth, never this table. The measurements above are dated 2026-11-26 and every order re-measures in its Step 0 before changing anything.
