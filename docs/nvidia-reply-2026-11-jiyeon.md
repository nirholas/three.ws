# Reply to NVIDIA App Publishing (Jiyeon), verified 2026-11-27

NVIDIA's App Publishing team (Jiyeon, AppPublishingRequests@exchange.nvidia.com, email dated
2026-11-24) asked two things: do we want to be listed in the Accelerated Apps Catalog, and what
is the exact product name, with the page that uses it. This file holds the pre-send checklist,
the draft reply (long and short), and the evidence behind every claim the listing makes.

It builds on the reply first drafted on 2026-11-25 in
[nvidia-apps-catalog-request.md](./nvidia-apps-catalog-request.md#app-publishing-reply-2026-11-25)
and the field copy in [nvidia-apps-catalog-listing.md](./nvidia-apps-catalog-listing.md). That
draft stands; this file re-checks it against production, corrects what drifted, and adds the
checklist and a shorter variant. **Nothing here has been sent.** Sending, and editing the
Inception portal, are the owner's actions.

Measured on production between 2026-11-26 23:40 UTC and 2026-11-27 00:05 UTC. Production ran
commit `f0eed584f` (built 2026-11-26 06:57 UTC).

## Pre-send checklist

Every item must be true before the owner presses send. Each has the one command or address that
proves it.

1. **The page says the name.** `curl -s https://three.ws/forge | grep -o "<title[^>]*>[^<]*"`
   prints `Forge: AI 3D Model Generator · three.ws`, and `curl -s https://three.ws/forge | grep -o "<h1[^>]*>.*</h1>"`
   shows `Forge` plus `: AI 3D Model Generator`. Verified true 2026-11-26. The page is already
   live: the commit that renamed it (`7b864a50d`) predates the build production runs, so the
   deploy step in the 2026-11-25 send steps is already done.
2. **The portal record is renamed.** Portal > Profile > Products > Edit: Product/Service Name
   reads `Forge: AI 3D Model Generator`, webpage `https://three.ws/forge`, brand color `0B0D0C`,
   "Do not share" unchecked. Not verifiable from here (portal login). If this is not done yet,
   send the "rename pending" wording in the short variant instead of the long one.
3. **The portal text matches the corrected copy.** Re-paste Product Description (489
   characters) and Technical Details (now 803 characters) from the listing doc. The saved
   Technical Details of 2026-10-25 still names TripoSR and UniRig, which could not be shown
   serving (see claim 9).
4. **A signed-out visitor understands what happens.** Open `https://three.ws/forge` in a
   private window, type a prompt, press Generate: the page says "Making a 3D model needs a free
   account" with a Sign in link. Verified 2026-11-26. This is expected, and the reply tells the
   reviewer.
5. **A signed-in text prompt finishes.** `npm run forge:walkthrough` (one real generation, about
   4 minutes, uses real GPU time) prints `FORGE OK`. Verified 2026-11-26: 8 of 8 stages passed
   in 242 s. Run it again within an hour of sending, because the reference-image step is
   fragile (blocker 2).
6. **The main engine is healthy.** `npm run forge:lanes` shows `trellis_selfhost` at 85 percent
   or better over 7 days. Measured 95.7 percent (910 done, 41 failed).
7. **Nothing in the reply is false today.** Re-read the reply against the verdicts below. In
   particular do not add "no signup", "in seconds", or "every lane runs on NVIDIA".
8. **The catalog does not already list us.** `node scripts/nvidia-apps-catalog-pull.mjs --inception --find three.ws`
   prints `0 match "three.ws"` (true 2026-11-27, 932 entries). A match means the reply is moot.
9. **Reply all in the same thread** so AppPublishingRequests and the Inception program both
   get it, and record the send date in the header of `nvidia-apps-catalog-request.md`.

## Draft reply (long)

Reply all in the existing thread. Plain text.

```text
Hi Jiyeon,

Thank you for reviewing the record.

1. Yes. Please consider three.ws for listing in the NVIDIA Accelerated Apps Catalog.

2. The product name is "Forge: AI 3D Model Generator". "three.ws 3D AI Studio" was a
descriptive label I used only in the portal, and I have renamed the portal record so the two
match. The name is the heading and the browser title of the product page in the record,
https://three.ws/forge.

For your review: Forge turns a text prompt, photos or a sketch into a textured 3D model you
can view, rig and download. Making a model needs a free account (sign in with email). Our
default engine is Microsoft TRELLIS running on our own NVIDIA L4 GPUs, and a model usually
takes two to three minutes. If it would help your reviewer, I can set up a test login.

Please let me know if you need anything else for the listing.

Best regards,

Nicholas Resendez
nich@three.ws
three.ws
```

## Draft reply (short)

If the portal record has been renamed:

```text
Hi Jiyeon,

Yes, please consider three.ws for the Accelerated Apps Catalog. The product name is "Forge: AI
3D Model Generator", the heading of https://three.ws/forge, and the portal record now uses the
same name. Making a model there needs a free account. I am at nich@three.ws if you need
anything else.

Nicholas Resendez, three.ws
```

If the portal record has not been renamed yet, replace the second sentence with: "The product
name is "Forge: AI 3D Model Generator", the heading of https://three.ws/forge. I am renaming
the portal record to match today."

## What the reviewer sees (walkthrough, 2026-11-26)

Screenshots are in the session scratchpad
(`/tmp/claude-1001/-home-nich-three-ws/ca18f3f6-f53a-4815-8bea-73a9d7ad3012/scratchpad/walk/`):
`signedout-desktop-1-landing.png`, `signedout-desktop-2-typed.png`,
`signedout-desktop-3-after-generate.png`, `signedout-phone-1-landing.png`,
`result-share-page.png`, plus `report.json` and `gen.log` from the signed-in run.

- **First view, signed out, desktop and phone.** The heading "Forge: AI 3D Model Generator" sits
  about 88 px from the top, with a FREE tag and "text or photos to textured 3D model" beside it.
  No scrolling is needed to see the name. The browser title carries it too. No console errors
  and no failed requests on phone width; desktop logged only WebGL driver performance warnings
  from the headless software renderer.
- **They try it.** A prompt typed and Generate pressed returns a designed message, "Sign in to
  make a 3D model. Making a 3D model needs a free account... You come straight back here." with
  Sign in and Try again controls. This is the expected hurdle. It is clear, and not an error.
- **Other things a reviewer notices.** The engine picker lists NVIDIA first and has TRELLIS (our
  own L4 worker) selected, with Hunyuan3D shown dimmed. The page shows `$THREE` holder
  controls and a Connect wallet button. The page says "usually about 60s" for Standard, and the
  measured time is longer (claim 5).
- **Signed in as the QA account, one real generation.** Prompt "a tin toy robot with speckled
  terracotta, single object, plain background, clean product shot", Standard quality. Direction
  step ran, reference view painted, model ready in 160 s on `trellis_selfhost`, creation
  `5b7e1980-4321-4cd7-8856-fcb46c27d0a1`. The GLB is 5.98 MB, one mesh, 36,930 triangles,
  textured. The viewer drew it (13 percent of the canvas, 293 colours), the share page and
  preview card answered 200, and the model is listed under the account. Total 242 s.

## Claims, with verdicts

Sources: the listing kit, the sent request email of 2026-09-04, and the portal fields saved on
2026-10-25. True, true with a caveat, or false, with the evidence and what changed.

1. **Product name "Forge: AI 3D Model Generator" at https://three.ws/forge.** True. Title,
   heading, `og:title`, `twitter:title`, JSON-LD `name`, the meta description and the English
   locale string `forge.product_name` all carry it, live. Pinned by `tests/forge-product-name.test.js`.
2. **Every link in the listing and the sent email.** True. All 16 answered 200 on 2026-11-26
   (the Forge page, /nvidia, the Audio2Face demo, /docs/nvidia-models, /docs/embedding, the L4
   and Blackwell blog post, /legal/privacy, /objects, /docs/simready-assets, /ar, the press kit
   zip, both NVIDIA Developer Forums posts, the GitHub repository, the X profile, /docs).
3. **"Free text-to-3D, no signup" (sent email) and "no account required for the free lane"
   (listing).** False today. Generating needs a free account; signed out the page shows a
   sign-in message. The sent email is a dated record and stays as sent. Listing copy corrected.
   The reply says "free account".
4. **"Textured, rigged, animation-ready" output, export as GLB, FBX or USDZ.** True. A real
   generation produced a textured GLB (3 images, WebP textures). The export code
   (`src/forge-export.js`, `src/forge-openusd.js`) exists. The auto-rig worker answers healthy
   (Make-It-Animatable). Not exercised: FBX, USDZ and a rig run (the 4-call edit budget was not
   spent, and edit tools share a rate-limit bucket).
5. **"In seconds".** False. Median end to end is 149 s on the main engine over 7 days
   (p95 448 s), and the live run took 160 s. The page itself says "usually about 60s", which is
   also optimistic (not fixed here, see Found, not fixed in the report). Copy corrected to a few
   minutes.
6. **"Every generation lane runs on NVIDIA GPUs and NVIDIA-hosted models."** False as worded.
   The 3D engines that served traffic are NVIDIA-GPU workers, but the reference image for a text
   prompt is painted by a keyless third-party rung today (the NVIDIA FLUX rung is not serving),
   and bring-your-own-key engines (Meshy, Tripo, Rodin, Stability, Replicate) are third-party.
   Corrected to "the default 3D engine runs on NVIDIA GPUs".
7. **"TRELLIS on NVCF is our default free text-to-3D lane."** False. `trellis_nvcf` finished 0
   jobs in the last 7 days (518 done, 334 failed over 30 days, 60.8 percent). Text prompts are
   served by self-hosted TRELLIS on our L4 (`trellis_selfhost`: 910 done, 41 failed, 95.7
   percent over 7 days). The hosted lane is reachable (probe availability 97 percent) and stays
   a selectable engine. Corrected in the listing.
8. **Self-hosted fleet: "eight GPU workers, twelve deployments, eleven L4, one RTX PRO 6000".**
   Unverified. The count comes from 2026-09-02 and the old Google Cloud project cannot be
   queried from this machine (the `nich@sperax.io` login needs `gcloud auth login`). What is
   verified today from `/api/nvidia/stats` and `/api/forge?health=1`: L4 workers serving jobs
   are `trellis_selfhost` (us-central1), `triposg` (us-central1) and `pixal3d` (europe-west4),
   and Hunyuan3D 2.1 answers on an NVIDIA RTX PRO 6000 Blackwell Server Edition. The reply makes
   no count claim. Recount command is in the listing.
9. **Models named in Technical Details: Hunyuan3D, TRELLIS, TripoSG, TripoSR,
   Make-It-Animatable, UniRig.** Four true, two unproven. TRELLIS: serving. TripoSG: serving
   with a low success rate (14 done, 26 failed in 7 days, 35 percent; 704 and 946 over 30 days).
   Hunyuan3D 2.1: reachable on Blackwell, 8 jobs in 30 days, none in 7. Make-It-Animatable: the
   rig worker is healthy. TripoSR has a worker directory but no route in the engine table and
   no health or stats row. UniRig is only used by the non-humanoid rig worker when
   `RIG_NONHUMAN_URL` is set, and that worker has no health row. Both removed from the portal
   text rather than argued over.
10. **NVIDIA technologies "used": CUDA Toolkit, cuDNN, cuBLAS, CUDA Python, Kaolin, Riva,
    Audio2Face, NIM.** True with caveats, as the listing already records (Kaolin and nvdiffrast
    in the TRELLIS worker image, CuPy as the thin CUDA Python evidence). Riva ASR: `/api/asr`
    answers `configured: true` (no probe lane exists, so served volume is unmeasured). Riva
    Magpie TTS: 100 percent probe availability over 7 days. NIM chat, vision, embeddings: 85.4,
    96.4 and 100 percent over 7 days.
11. **Models named in the listing copy.** Several were stale. Corrected to the pinned ids in
    [nvidia-models.md](./nvidia-models.md): chat leads with `nvidia/nemotron-3-super-120b-a12b`
    then `nvidia/nemotron-3-ultra-550b-a55b`, vision is `nvidia/nemotron-3.5-super-vl-120b-a12b`
    (not Nemotron Nano VL), embeddings are the Nemotron 3.5 embed 8b model (not NV-EmbedQA-E5-v5),
    reranking is opt-in and under evaluation (not Mistral 4B), safety is
    `nvidia/llama-3.1-nemotron-safety-guard-8b-v3`, and the hosted image rung is FLUX.2 klein 4B
    in the code (production still runs the FLUX.1-dev rung, which hangs on NVIDIA's gateway, so it
    is not serving until the next deploy).
12. **"NemoGuard gates every public publish."** True with a caveat. The module is configured
    and the probe answered ok at the last check, but it fails open by design (a timeout, outage
    or unreadable reply publishes anyway), and probe availability was 75.6 percent over 7 days.
    The portal fields do not use the word "gates", and the reply makes no safety claim.
13. **"Audio2Face-3D drives real-time facial animation in the browser, live demo at
    /demos/audio2face".** True with a caveat. The page is live and the code path is wired, but
    the hourly-cadence probe of the NVIDIA-hosted function answered in 6 of 55 tries over 7 days
    (10.9 percent) and was down at its last run (30 s timeout). A reviewer who opens the demo may
    find it not answering. The reply does not mention Audio2Face. Blocker 3.
14. **Stage "Shipping", "GPU Accelerated", logo, brand color 0B0D0C.** Portal-side; unverifiable
    from here. The logo file and color match the repository assets.
15. **Catalog status.** Not listed: 0 matches for "three.ws" in the 932-entry Inception view on
    2026-11-27.

## Blockers a reviewer could hit, ranked

1. **Account wall (owner: product decision, none needed to send).** The reviewer cannot try
   Forge without signing up. The message is clear and sign-up is free. The reply says so and
   offers a test login. If the owner wants the reviewer to experience a generation with no
   friction, that is a product change (a guest generation), not a pre-send task.
2. **Reference image for text prompts is held up (owner: billing and credits).** Only the
   keyless Pollinations rung serves, at one image per 45 seconds for the whole service. Vertex
   image generation answers 403 (billing hold on project 93741856), Hugging Face fal-ai and
   WaveSpeed answer 402 (credits exhausted), no Replicate token is set, and the NVIDIA FLUX rung
   in production hangs. Two reviewers trying at once, or one other visitor a moment before,
   will see a "try again in a few seconds" response. Photo and sketch inputs skip this step.
   The fix for the NVIDIA rung (`dc26e442b`) and the Pollinations fixes (`b41786cd6`,
   `a267ccea8`) are committed and not deployed: 48 commits under `api/`, `src/`, `pages/` and
   the locales separate production from `main`. Deploy: `npm run deploy:gcp:full` after the
   `deploy-runbook` skill.
3. **Audio2Face demo availability (owner: NVIDIA side or function id).** 10.9 percent probe
   availability over 7 days. If the reviewer opens `/demos/audio2face` it may not answer. Not
   mentioned in the reply, and the listing's NVIDIA technologies still count it because the code
   path ships. Re-probe with `node scripts/verify-nvidia-a2f.mjs --list`.
4. **The prompt-direction chat chain is down (owner: billing and credits).** OpenRouter 402,
   OpenAI 429, Vertex Gemini 403. The "Enhance" and art-director steps then degrade; the live
   generation still completed. The NVIDIA Nemotron rung answered at the last probe.
5. **Portal record out of step with the page (owner: five minutes in the portal).** Rename,
   re-paste the 489-character description and the corrected Technical Details, check the "Do not
   share" box is unchecked.
6. **The page promises "usually about 60s" and a first-time visitor will wait about three
   minutes (owner: product copy).** Honest in the reply, optimistic on the page.
7. **`$THREE` holder controls and a wallet button on the page (owner: none, a product
   choice).** A reviewer reads them. They do not block anything, and the first-view copy does
   not depend on them.
8. **Other lanes are weak.** Sketch to 3D (`triposg`) finished 36 percent of jobs and "Match my
   photo" (`pixal3d`) 27 percent over 7 days. A reviewer who picks those engines may hit a
   failure. The default engine for text and photo is the 95.7 percent one.

## Corrections made to the listing kit on 2026-11-27

In [nvidia-apps-catalog-listing.md](./nvidia-apps-catalog-listing.md): Technical Details drops
TripoSR and UniRig (803 characters now); the short, medium and long descriptions drop "in
seconds", "no account required", "every lane" and the TRELLIS-on-NVCF-default claim and name the
models actually pinned; the NVIDIA technologies list updates the NVCF, NIM and Audio2Face
bullets and marks the fleet count as unverified since 2026-09-02. Records of what was already
sent (the 2026-09-04 email, the 2026-10-25 and 2026-11-02 replies, the 2026-10-25 saved fields)
are unchanged.
