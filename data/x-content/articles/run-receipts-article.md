A reader replied to our last article with one line that we have been thinking about ever since: "prioritize higher-quality and more trustworthy product. system writes down exactly what went wrong and what was expected." Thank you. That is the right ask, and it is specific enough to build. So we built it, ran it against production, and let it grade us in public.

Every generation on the free three.ws 3D Studio now writes a run receipt. The receipt walks the pipeline one stage at a time and records, for each stage, what was expected, what was observed, a verdict, and the cause whenever the verdict is anything other than a clean pass. The finished record is hashed and signed with ed25519, so nobody, including us, can quietly improve it afterwards.

The best part of this story is what happened on day one. The receipts went live, and within hours they told us that one of our own stages had been falling back on almost every run. We would not have seen it from the outside: every model was still delivered. The receipts saw it, named it, and we fixed it the same day. This article shows the receipts, the bug they caught, the before and after on the same prompt, and how to check every number here yourself without trusting us.

## What a receipt records

A studio call such as forge_avatar takes one sentence and returns a rigged, animation-ready 3D character. Inside that one call, up to eight stages run in order, and the receipt has a row for each:

1. **Input.** The prompt or reference image passed the content-safety check.
2. **Subject check.** Auto-rigging builds a two-legged skeleton, so the subject should be a character.
3. **Brief.** A director model rewrites the sentence into a 3D specification.
4. **Mesh.** A reconstruction model on our GPU builds a textured mesh at the requested tier.
5. **Geometry check.** A deterministic score over the file: real triangles, real vertices, real textures.
6. **Visual check.** A vision model looks at a render and scores it, on the tiers that run it.
7. **Rig.** A skinned humanoid skeleton with torso, arms and legs mapped.
8. **Delivery.** A permanent first-party link, not an engine's temporary URL.

Each row gets one of five verdicts:

- **met:** the stage did what it was expected to do.
- **recovered:** it did not, but a named fallback carried the run.
- **missed:** it did not, and the cause says why.
- **skipped:** it did not run, and a skip is never counted as a pass.
- **pending:** it was still running when the tool answered.

Two rules keep the receipt honest. First, the overall outcome is derived from the stages, and a tool can only ever state a worse outcome than its stages imply, never a better one. Second, the rig row is read back from the delivered file with the same analysis our Rig Doctor runs in the browser. It is not copied from the rigger's own report. If the rigger says "done" and the file has no legs, the receipt says the file has no legs.

## A receipt, in full

Here is one real run from 11 October. We sent forge_avatar the sentence "a friendly cartoon astronaut in a white suit with an orange visor". 77.6 seconds later the server answered with a rigged character and receipt rr_81qbfUbiZNqSTD6rVmjCoA:

```
MET        Input
           observed: Received a text prompt; it passed the safety check.
MET        Subject check
           observed: The prompt reads as a character.
RECOVERED  Brief (7.7s)
           observed: The fixed full-body brief was appended to the prompt as written.
           cause:    The director reply stopped mid-sentence, so it was treated as
                     clipped and set aside. The fixed brief keeps the framing.
MET        Mesh (47.1s)
           observed: A mesh from the high-detail tier on TRELLIS (free).
MET        Geometry check
           observed: 7,755 triangles, 5,465 vertices, textured, score 0.914.
MET        Visual check
           observed: Scored 85 and passed.
MET        Rig (22.7s)
           observed: 52 joints (Mixamo), 52 mapped to the canonical skeleton;
                     torso, arms and legs all driven.
MET        Delivery
           observed: Stored permanently and served first-party.
```

The summary line reads "Delivered as expected. 1 carried by a fallback (Brief)." That is the point of the whole system. The character is good: 52 of 52 joints mapped, a visual score of 85, a permanent link. And the receipt still tells you that one stage took the fallback path, and exactly why. A system that only says "here is your model" would have hidden that line. This one prints it.

## Day one: the receipts graded us, and we did not pass

Once receipts were flowing, we asked the stats endpoint for the last seven days. Every run that reached the end had delivered a model, and the mesh, geometry, rig and delivery stages were met on every run that reached them. But one row stood out: the Brief stage had been **recovered on 8 of its first 10 runs**.

Recovered means the run was fine, because the fallback is sound. Without a director brief, the prompt goes to the image model as written, and for avatars a fixed full-body brief keeps the framing. But the director exists to make results better, and it was almost never getting a word in.

The first receipts filed the cause as "The director model did not return a usable brief in time." That turned out to be wrong, and the receipts themselves gave it away: they record how long the stage took, and the director was answering in 5 to 10 seconds, well inside its window. So the replies were arriving. They were being rejected.

We sampled the director live and found two separate reasons:

- **The briefs were too long.** The forge accepts prompts of at most 1,000 characters. The director was writing 1,071 to 1,421. We had asked it for a character budget, and the models simply ignore character counts.
- **A well-formed brief failed our completeness check.** The director prompt tells the model to end on a list of composition rules, for example "... no collage or multi-view grid, no second subject". The models copied that list faithfully and stopped without a full stop. Our guard, which exists to catch genuinely clipped replies, read the missing period as a sentence cut in half. So it rejected exactly the brief we asked for.

Both are our bugs, not the models'. Both were found because a stage wrote down what it expected and what it observed.

## The fix, test first

Every bug fix on three.ws starts with a test that reproduces it and fails for the stated reason, and only then gets a code change. Here, that meant three things.

**A budget the models respect.** The director prompts now say "Keep the whole prompt under 90 words." Models follow word counts far better than character counts, and 90 words of spec prose lands comfortably under 1,000 characters. A test pins that relationship, so nobody can raise the budget past what the forge accepts. We also learned not to ask for "a period" at the end: one model dutifully wrote the word "period".

**A guard that recognises the mandated ending.** A brief ending on "no second subject", "no second character" or "one character only" is now accepted as complete. A reply clipped inside that same list, such as one ending "no second", is still rejected, because a clip is still a clip. The guard is one implementation shared by both forge clients, and a test asserts it stays that way.

**A cause that tells the truth.** The guard no longer answers just yes or no. It names the problem: empty, too long (with the length), unfinished, carried a link, or added nothing to what you typed. The receipt now records that exact reason. "The director's brief ran to 1421 characters; the forge accepts at most 1000, so it was set aside", using the longest reply we sampled, is a cause you can act on. "Did not return in time" was not, and it was false.

## Before and after, on the same prompt

The clearest proof is one prompt, run twice. We sent mesh_forge "a vintage red rotary telephone" once before the fix and once after.

**Before: receipt rr_6LFRktJgzxFnv29MyZuDwz**

- Brief: **recovered** in 7.2 seconds. "The prompt was used as written."
- Mesh: met, standard tier on TRELLIS, 18.7 seconds.
- Geometry: 15,787 triangles, 12,148 vertices, textured, score 0.947.
- Visual check: skipped. The standard tier does not run it, and the receipt says so instead of counting it as a pass.

**After: receipt rr_TFhcAi4mAkHsmBz3oveqJ4**

- Brief: **met** in 7.2 seconds. "The director rewrote the prompt into a 3D specification."
- Mesh: met, standard tier on TRELLIS, 21.7 seconds.
- Geometry: 16,150 triangles, 12,960 vertices, textured, score 0.948.
- Visual check: skipped, for the same stated reason.

Same prompt, same tier, same engine, and the director is back in the loop: about the same time spent on the brief, but now the brief is used. In live sampling after the fix, roughly 7 in 12 director replies were usable, against none before. The rest were rejected for reasons the receipt now names precisely. One appended a note saying "89 words". Another added an aspect-ratio flag. A third still ran long, and one provider returned an empty reply. Each of those falls back safely, and each is recorded as what it was.

We are not claiming the brief is met on every run now. The astronaut receipt above was taken after the fix, and its brief was still recovered, because that particular reply stopped mid-sentence. The receipt says exactly that. A met rate that moves from 0 toward 6 in 10, written down honestly run by run, is more useful to you than a dashboard that says 100.

## The receipt holds us to the edges too

Three more receipts from the same day show the receipt doing the less glamorous parts of its job.

**A refusal that cost nothing.** We sent forge_avatar "a wooden chair". Receipt rr_C6MwpDYHYH9ptoz25RJojy shows Input met, then Subject check **missed**: "The prompt reads as an object or animal, not a character." The cause adds: "Turned away before any GPU time was spent. Use the mesh generator for objects, or set allow_non_humanoid." The whole run took 4 milliseconds. A refusal is a result too, and it gets a receipt.

**A skip that is not hidden.** We gave rig_mesh a brass ship lantern we had just generated. Receipt rr_DkGahG4bFxidgcWu7tR1yS shows the rig met: 52 joints, 52 mapped, torso, arms, legs and hands all driven, in 50.8 seconds. A naive receipt would stop there and look perfect. Ours marks Subject check as **skipped**, and the cause reads: "The rig check verifies the skeleton structure, not that the body it is bound to is a character. A non-humanoid mesh still receives a humanoid skeleton." The summary refuses to round up: "Every stage that ran met its contract. 1 skipped (Subject check)." Skips are never counted as passes.

**A fallback on the free path.** forge_free on that same lantern, receipt rr_B78gKaZTKktWBq8rWXUYrE, delivered 13,574 textured triangles with a geometry score of 0.94 in 24.4 seconds, and its Brief row is recovered. That run predates the fix and is part of the 8 in 10 that started all this. We kept it in the record rather than rerunning it away.

## Signed, so you do not have to trust us

A receipt that we can edit later is a press release. So each finished receipt is serialised to canonical JSON, prefixed with a fixed domain tag, hashed with SHA-256 and signed with ed25519. The production signing key is:

```
Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH
```

The verifier is a single script in the repository. It needs no account and no API key, and it checks the shape, the hash, the signature and the signer:

```bash
node scripts/run-receipt-verify.mjs rr_81qbfUbiZNqSTD6rVmjCoA \
  --signer Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH
```

```
ok    shape: a three-run-receipt/v1 object
ok    hash: sha256 of the canonical receipt matches
ok    signature: ed25519 signature over the tagged canonical bytes
ok    signer: signed by the pinned three.ws key

Verified. Signed by Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH.
```

Then we tried to cheat. We took the astronaut receipt and changed one line, the summary, from the honest "Delivered as expected. 1 carried by a fallback (Brief)." to "Delivered perfectly." Every stage was left untouched. The verifier caught it at once:

```
ok    shape: a three-run-receipt/v1 object
FAIL  hash: sha256 of the canonical receipt matches
FAIL  signature: ed25519 signature over the tagged canonical bytes
ok    signer: signed by the pinned three.ws key

Not verified.
```

It exits with status 1, so you can drop it into any script or CI step that consumes our output. The verifier takes an id, a receipt URL or a saved file. All six receipts in this article ship in the repository as their full signed envelopes, in `data/x-content/runs/run-receipts-article.json`, so you can verify them offline, today, against the key above.

## Making the receipt page honest as well

Building the page that shows receipts turned up two smaller problems, and we fixed those too.

A clean receipt was printing the word "null" where an absent note should have been. That one was cosmetic, but a trust page that prints "null" undermines itself.

The second mattered more. Some studio jobs answer immediately with a job handle while the mesh keeps building. Their receipts are pending, and the page used to suggest that viewing the result would complete them. It will not. Only the caller collecting the job with check_job completes a pending receipt. The server stores a hash of the job handle, not the handle itself, so it cannot collect anyone's job on its own. The page now says exactly that, and a receipt still pending after an hour is labelled as never collected, with the note that every other stage is final. We would rather show an honest gap than a reassuring guess.

## What the numbers say today

The stats endpoint for the last seven days reports 14 runs:

- 8 delivered
- 2 refused before any GPU time
- 4 pending, never collected by their callers

Every run that reached the end delivered a permanent model. The stage rows that reached a verdict are met on every run:

- Mesh: 6 of 6
- Geometry: 6 of 6
- Rig: 4 of 4
- Delivery: 8 of 8

The one honest blemish is the Brief row: 2 of 10 met, and both of those 2 came after the fix. That row is the reason this article exists. It is also the row we will be watching move.

The clean rate, the share of runs where every stage met its contract with no fallback at all, is 0.375. We publish it anyway. A number that can go down is the only kind worth publishing.

## Why we think this matters

Every generative pipeline has fallbacks, and that is good engineering. The problem is that a fallback that works is invisible. The output looks fine, nobody complains, and the stage behind it can quietly stop doing its job for weeks. Ours had. The answer is not fewer fallbacks. It is a system that writes down, every single time, what each stage promised, what it delivered, and why those differ. And it has to be signed, so the record cannot be softened later.

That is what our reader asked for in one line, and it found a real problem on its first day. We are grateful for the push.

## The partners behind the pipeline

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing as it stands. The full map is at [three.ws/partners](https://three.ws/partners).

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. The mesh and rig workers behind every receipt in this article run on NVIDIA GPUs, and NVIDIA-hosted models on NIM serve chat, vision and embeddings elsewhere on the platform.

**Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the site, every API handler and the receipt endpoints, the GPU workers are their own Cloud Run services, Cloud Scheduler runs the jobs, and Vertex AI provides the Gemini and image lanes at the top of the model chain.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free 3D Studio connector that wrote these receipts gives ChatGPT keyless 3D tools, and the same server is listed on the Official MCP Registry, so any MCP client can reach it.

**IBM.** three.ws is an IBM Business Partner. Agents on three.ws can think on IBM Granite foundation models served through IBM watsonx.

**Amazon Web Services.** three.ws is an AWS Partner, with an AWS Marketplace integration built and deployed. We publish engineering write-ups on the AWS Builder Center.

**Alibaba Cloud.** three.ws is listed on the Alibaba Cloud International Marketplace, and Qwen models are lanes in the platform's model router.

**Quicknode.** three.ws is accepted into the Quicknode Startup Program, and Quicknode's RPC endpoints are a rung in the Solana failover chain behind agent wallets.

**HackerNoon.** three.ws has a builder-focused publishing partnership with HackerNoon, whose import picks up our announcements for its developer audience.

## Try it

Every receipt has its own page. Browse recent runs and the seven-day stage stats at [three.ws/runs](https://three.ws/runs), or open the astronaut directly at [three.ws/runs/rr_81qbfUbiZNqSTD6rVmjCoA](https://three.ws/runs/rr_81qbfUbiZNqSTD6rVmjCoA). The full contract, with every stage, every verdict and the envelope format, is documented at [three.ws/docs/run-receipts](https://three.ws/docs/run-receipts). The studio tools that write the receipts, and how to call them from any MCP client with no key, are on the [3D Studio MCP page](https://three.ws/docs/mcp-studio). Every studio result links to its receipt in its text and in `structuredContent.receipt`, so the next model you generate comes with its own record of what went right and what did not.
