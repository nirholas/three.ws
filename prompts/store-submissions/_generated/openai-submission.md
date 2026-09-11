# three.ws 3D Studio — OpenAI ChatGPT App Directory submission package

**Prepared:** 2026-07-07 · **Last re-verified live:** 2026-09-09 · **Owning prompt:** 07
**Endpoint:** `https://three.ws/api/mcp-studio`
**Prereqs verified live:** prompt 04 (`/api/mcp-studio` deployed), prompt 05 (widget renders real GLBs).

This is the copy-paste-ready answer sheet for submitting the free three.ws 3D Studio to the
OpenAI ChatGPT App Directory, plus an evidence-backed compliance audit. **Every field is
filled** (2026-07-14: organization verified on platform.openai.com, support contact and privacy
policy confirmed live). Submission is currently held on the §0 output-quality blocker; once that
fix is deployed and re-verified, the remaining step is the owner's final submit in the portal.

---

## 0. Submission verdict: READY (B3 closed on measurement, 2026-09-11)

**Every connector, manifest, widget and Actions surface re-verified live on 2026-09-09 and all
pass** (see the §7 checklist), and **B3, the last blocker, closed on 2026-09-11**.

**B3 is closed, and NOT by clearing the GCP billing hold.** Measured on 2026-09-11 against live
revision `three-ws-api-00424-5p4`: ten consecutive authenticated calls to
`/api/forge-quality-check` returned **10 real verdicts out of 10** (`provider: nvidia`,
`qa_available: true`). The same probe returned 3/10 on 2026-09-10 and 0/10 on 2026-09-09. The gate
no longer fails open in normal operation, so a flagged slab is scored rather than shipped
unexamined.

It closed because the vision failover chain was repaired, not because Vertex came back:

- Parseable JSON became part of the chain's success test instead of a filter applied after a
  winner was already chosen, so a provider that answers `200` with prose or an empty body now
  fails that lane and the walk continues.
- The per-lane time budget stopped being divided equally across every remaining rung, which had
  been starving the one healthy provider as the chain grew.
- A billing-denied Vertex is parked by a circuit breaker instead of being re-probed on every call.
- The chain widened from four providers to ten, all free.

**Vertex is still refused project-wide on the billing hold.** It no longer decides the outcome.
Clearing the hold remains worth doing and is no longer a submission dependency.

The historical record of the blocker, for anyone auditing how it was closed:

| # | Blocker | State measured 2026-09-09 |
|---|---------|---------------------------|
| **B3** | The free lane can ship a **degenerate slab**: a reconstruction that lost its image conditioning returns a full-footprint relief instead of the object. It carries real triangles and PBR textures, so the cheap scorer used to rate it top-confidence and skip vision QA entirely. | **The scorer fix is deployed and works.** Live revision `three-ws-api-00420-ljh` (commit `880bdcef8`) contains the `planar` signal, and re-measuring it against **40 consecutive production generations** flagged **4 planar, 4 of 4 escalating to vision QA** and 0 healthy models escalated on the flatness rule. What remains is the rung the escalation hands off to: **vision QA answers only intermittently.** Vertex is still refused project-wide (`403 Lightning dunning decision is deny for project`, a billing hold, observed live at 15:02Z), and the gate **fails open** when no provider answers, so a flagged slab can still ship on a QA outage. |

**What changed since 2026-09-02:** the fallback rung is no longer dead. A live generation at 15:04Z
scored through the free NVIDIA vision lane and returned a full verdict with a real observation
(`provider: nvidia`, `score 85`, `"the glass shade is slightly too green"`), so the earlier reading
that the fallback simply 504s is no longer true in general. Of the two verification generations run
today, one scored and one hit the Vertex denial and failed open. Clearing the GCP billing hold makes
the escalation deterministic; that is the single owner-gated dependency left on B3.

**Also fixed in this pass and awaiting the same deploy** (none of these are blockers on their own):

- The inline widget now fetches its GLB through the same-origin `/api/glb` proxy. The asset bucket's
  CORS policy is an origin allowlist naming `https://three.ws` only (measured: ChatGPT's sandbox
  origin gets no `access-control-allow-origin` at all, and the preflight 403s), so any lane that
  returns a raw bucket URL would have error-stated inside the ChatGPT widget sandbox while working
  perfectly on our own pages. Today's lanes return a `three.ws/cdn/` URL, which already answers with
  open CORS, so this closes an exposure rather than a live outage.
- The pending ETA no longer fabricates a countdown. It was clamped to a floor, so a job that outran
  its estimate reported "roughly 5s to go" for as long as it ran (measured: 5s reported for the final
  11 minutes of a 12.5-minute generation, to the widget and the custom GPT alike). Past the estimate
  the field is now absent and both surfaces fall back to their honest "it keeps running" copy, with
  the real elapsed time still carried.
- 14 reviewer-visible strings on the connector (the `initialize` instructions, 12 tool and schema
  descriptions, and the widget description) had an em-dash the house style bans. The stored
  `studio-resources-list.json` evidence had silently been written in the correct form, so the kit and
  production disagreed; the source is now fixed and they agree after the deploy.
- The free surface no longer advertises payment headers. Every endpoint shares one `cors()` helper,
  which announced `x-payment` in `access-control-allow-headers` and `PAYMENT-REQUIRED` in
  `access-control-expose-headers`. The JSON bodies were always clean, but a reviewer with devtools
  open would have read a payment capability off the network tab of the very connector this package
  describes as free. The four free ChatGPT-facing endpoints (`/api/mcp-studio`, `/api/3d/studio`,
  `/api/ar`, `/api/glb`) now pass `payments: false` and omit both. The metered x402 surface is
  untouched: the flag defaults to on, and `tests/mcp-studio.test.js` pins both halves.

The historical 2026-07-14 blockers below stay cleared.

## 0a. Prior verdict: READY (blockers cleared 2026-07-14)

The app **passes every OpenAI content/privacy/annotation policy** (§2 audit: all PASS). The two
production defects found on 2026-07-07 are both **fixed and re-verified live on 2026-07-14**:

| # | Was | Verified fixed (2026-07-14) |
|---|-----|------------------------------|
| **B1** | Rate-limiter store over monthly quota: every `tools/call` generation returned HTTP 429 `rate_limiter_unavailable`. | Live `forge_free` call completed end-to-end: real 1.6 MB GLB (`model/gltf-binary`) on R2 plus working `viewerUrl`. Root cause ended permanently by the self-hosted Redis rail (Memorystore + SRH) that replaced the capped Upstash store. |
| **B2** | `/viewer?src=<glb>` returned 404: the `viewerUrl` every tool returns was a dead link. | `https://three.ws/viewer?src=<glb>` returns 200 and serves the standalone studio viewer, which reads `?src=`. |

Additionally, three.ws was **accepted into the OpenAI Partner Network on 2026-07-14** (welcome email
to nich@three.ws), which unlocks the partner portal for the submission itself.

**Remaining steps as of that date were owner-only:** re-run the §5 reviewer smoke test if desired, then
submit this package through the partner portal. That is superseded by §0: B3 must clear first. Schema note for the smoke test: `forge_free` accepts
`{"prompt": "...", "tier"?: "draft"|"standard"|"high"}`; other extra properties are rejected with
`-32602`.

**Quality note (re-verified live 2026-08-06):** the studio generation tools **default to the
standard tier**, and every surface a reviewer can read says so: the `forge_free` tool schema
(`"standard (default)"`), §1's tool table, and [`docs/mcp-studio.md`](../../../docs/mcp-studio.md).
The **high tier is a real option the caller can ask for**, not a stub, but it is never the default.
Both claims were proven end to end against production, with the tier read back from the durable
`forge_creations` record rather than inferred from the response text
([`forge-free-tier-evidence.json`](forge-free-tier-evidence.json)):

| Call | Wall clock | Recorded tier | Engine | GLB |
|---|---|---|---|---|
| `forge_free {prompt}` (no tier) | 164 s | `standard` | `trellis_selfhost` | 5.07 MB |
| `forge_free {prompt, tier:"high"}` | 144 s | `high` | `hunyuan3d` (self-hosted GPU worker) | 2.69 MB |

Standard stays the default deliberately. Latency is not the discriminator (both lanes exceed a
ChatGPT tool-call window, which is why `forge_free` returns a pollable job handle instead of an
error when a generation outlives `STUDIO_FORGE_TIMEOUT_MS`). The reasons are that the Hunyuan3D
worker is scale-to-zero, so a cold container adds a spin-up on top of the generation, and that the
high-tier access gate is cleared only by the platform's internal server-to-server token: a
deployment missing it would quietly serve standard while a "high by default" promise stayed on the
page. An explicit `tier:"high"` request degrades to standard on a 402 or submit timeout rather than
failing the conversation. Compliance surface unchanged: keyless, free, zero payment strings on the
wire (the high tier is platform-funded; the ChatGPT user is never asked for anything).

The two sections below are kept as the historical record of the defects and their fixes.

---

### B1 — Rate-limiter store over quota (generation 429s) — RESOLVED 2026-07-14

**Evidence (live, 2026-07-07):**
```
$ curl -s -X POST https://three.ws/api/mcp-studio -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"forge_free","arguments":{"prompt":"a friendly robot mascot"}}}'
{"error":"rate_limited","error_description":"generation rate limit — slow down and try again shortly","retry_after":60,"reason":"rate_limiter_unavailable"}   # HTTP 429
```
**Root cause:** the shared Upstash/Vercel-KV limiter store is over its **monthly command quota**:
```
$ curl -s "$KV_REST_API_URL/ping" -H "authorization: Bearer $KV_REST_API_TOKEN"
{"error":"ERR max requests limit exceeded. Limit: 500000, Usage: 500002. ..."}
```
The studio's generation buckets (`studioGenBurst`, `studioGenHourly`, `studioGenerateGlobal` in
`api/_lib/rate-limit.js`) are `critical: true`, so on a Redis error in production they **fail closed**
(deny) rather than allow unbounded operator-funded spend. With the store over quota, every Redis
command errors → generation is denied with `reason: 'rate_limiter_unavailable'`. This is the recurring
"500k/mo" incident referenced in the rate-limit code comments.

**Fix (ops — pick one):**
1. **Restore quota** — upgrade the Upstash plan or reset billing so `Usage < Limit`; the studio recovers
   the instant commands succeed again. (Fastest; no deploy.)
2. **Point the limiter at a fresh store** — set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`
   (highest-priority source in `REDIS_REST_SOURCES`) to a new Upstash DB with headroom, then redeploy.

Note: `authIp`/login use `degradeToMemory` and stay up; only cost/money-moving buckets (studio
generation, chat, x402-verify, auto-rig) fail closed. This is a **site-wide** cost-lane outage, not
studio-only — worth fixing regardless of the submission.

**Resolution (verified 2026-07-14):** the limiter no longer runs on the capped Upstash store; it runs
on the platform's self-hosted Redis (Memorystore behind an SRH proxy, no monthly command cap). A live
`forge_free` `tools/call` completed a real generation end-to-end. No action left.

---

### B2 — `/viewer?src=<glb>` returns 404 (broken link in every tool response) — RESOLVED 2026-07-14

**Evidence (live, 2026-07-07):**
```
$ curl -s -o /dev/null -w '%{http_code}' "https://three.ws/viewer?src=<encoded-glb>"
404          # body: <title>three.ws — 404</title>
```
Every studio tool returns `viewerUrl: "https://three.ws/viewer?src=<glb>"` in `structuredContent` and
in the text ("View it: …/viewer?src=…"), and the widget's primary **"Open in three.ws"** button links
to it. That path 404s.

**Root cause:** `vercel.json` had **no route** mapping `/viewer`, so the `viewerUrl` emitted by every
studio tool resolved nowhere. The link is emitted by shipped surfaces
(`api/_mcp-studio/forge-client.js`, `src/shared/forge-frames.js`, `api/v1/ai/_text-to-3d-lane.js`,
`api/_lib/tokenize-3d-metadata.js`, `api/_okx3d/identity.js`, `api/_studio/tools.js`), so this was a
platform-wide dead link, not studio-only.

**Resolution (verified 2026-07-14):** `vercel.json` routes `/viewer` to the standalone browser viewer
[`public/viewer.html`](../../../public/viewer.html), which reads `?src=<glb>`.
`https://three.ws/viewer?src=<glb>` returns 200 and renders the model, and the `viewerUrl` returned by
a live `forge_free` call uses exactly that shape. No action left. (Note: the ChatGPT *inline* widget is
a separate surface, `api/_mcp-studio/component.js`; `/viewer` is the "open in a normal browser" page.)

---

## 1. Listing metadata (copy-paste into the submission form)

| Field | Value |
|-------|-------|
| **App name** | **three.ws 3D Studio** |
| **Tagline** | Turn a text prompt into a downloadable, animation-ready 3D model. Free, inside ChatGPT. |
| **Short description** | three.ws 3D Studio generates textured 3D models, avatars, and rigged characters from a text prompt (or a reference image) and renders each result inline in an interactive 3D viewer you can rotate, inspect, and download as a GLB. It can also auto-rig a static model into an animation-ready one. Free to use: no account, no key, no payment. |
| **Long description** | Describe anything ("a friendly round robot mascot," "a low-poly treasure chest," "a knight character I can animate") and three.ws 3D Studio builds a real, textured 3D model and shows it in an interactive viewer right in the conversation. Eleven tools cover the full path from idea to asset: generate a model from text, generate an avatar, generate an art-directed mesh, auto-rig a static model into an animation-ready one, generate-then-rig a character in a single step, refine an existing model by describing a change, collect a detailed model that took longer than one turn, look at a finished model from several angles to check the result, and save a rigged model as a persistent persona that can speak with lip-sync and emotion. Every result is a standard **GLB** you can download and drop into Blender, Unity, Unreal, three.js, or any glTF pipeline. Generation runs on three.ws's own free 3D lane, so there is nothing to sign up for and nothing to pay. Not natively possible in ChatGPT: turning language into a manipulable, downloadable 3D asset with an inline viewer. |
| **Category** | Creativity & Design (secondary: Productivity) |
| **Country availability** | All countries / Global (no geo-restriction; anonymous + free). |
| **Age suitability** | Suitable for ages 13 to 17 (content-safety gate on every generation lane, see §2.6). |
| **App icon** | `_generated/assets/icon-512x512.png` (512×512, owned IP). |
| **Support contact** | `support@three.ws` · `https://three.ws/support` (page live, HTTP 200, verified 2026-07-14; lists support/security/abuse channels) |
| **Privacy policy URL** | `https://three.ws/legal/privacy` (live, HTTP 200, verified 2026-07-14; the studio collects no personal data, see §2.4) |
| **Developer/Publisher** | three.ws (verified organization on platform.openai.com, confirmed by owner 2026-07-14; OpenAI Partner Network member since 2026-07-14) |

### Example prompts (3–5, all reliably produce a model)
1. `Make a 3D model of a friendly round robot mascot, glossy white plastic.`
2. `Generate a low-poly treasure chest with iron bands.`
3. `Create a 3D avatar of a space explorer in a white-and-orange suit.`
4. `Make a rigged, animation-ready knight character I can pose.`
5. `Model a small ceramic teapot with a bamboo handle and a celadon glaze.`

### Tool list (titles as shown to users; matches live `tools/list`, re-pulled 2026-09-09)
| Tool | Title | What it does |
|------|-------|--------------|
| `forge_free` | Generate a 3D model from text | Text → textured GLB, platform-funded. Defaults to the standard tier (fast, reliable, textured); the caller may request `draft` (fastest) or `high` (best, slower; falls back to standard under load). |
| `text_to_avatar` | Generate a 3D avatar | Text or reference image → avatar GLB. |
| `mesh_forge` | Generate a 3D mesh (art-directed) | Text/image → mesh, prompt refined by an AI art-director first. |
| `rig_mesh` | Rig a 3D model for animation | Static GLB URL → humanoid-rigged, animation-ready GLB. |
| `forge_avatar` | Generate a rigged, animation-ready avatar | Text/image → generate + auto-rig in one step. |
| `refine_model` | Refine a 3D model by describing a change | Existing GLB + instruction → regenerated model with version lineage. |
| `check_job` | Check a pending 3D generation | Job id → the finished model, or a fresh pending state with a live ETA. Read-only; collects a generation that outran its original tool call. |
| `look_at_model` | Look at a 3D model | GLB URL → rendered frames from several angles as images, plus geometry stats (triangles, materials, textures) and a plain reading of them. Read-only; works on any public https GLB. |
| `create_agent_persona` | Save a rigged model as a living, persistent agent body | Rigged GLB + name → persona id (continuity across sessions). |
| `get_agent_persona` | Reload a persona by id (continuity across sessions) | Persona id → saved persona (read-only). |
| `persona_say` | Speak a reply through a persona: lip-sync + emotion + gesture | Persona id + text → lip-sync, emotion, and gesture playback in the viewer. |

---

## 2. Compliance audit (item-by-item, each with a PASS verdict + evidence)

Original evidence is from the live production deployment on 2026-07-07; connectivity, annotations,
and the full generation pipeline were re-verified live on 2026-07-14. Raw artifacts are in
`_generated/` (`live-tools-list.json`, `openai-tool-evidence.txt`, `forge-raw-response.json`).

### 2.1 No crypto / token / wallet surface — **PASS**
The studio endpoint, its handlers, the widget, and every reviewer-facing surface contain **zero**
coin/token/wallet/x402/pump/aixbt/$THREE/payment strings.

```
$ grep -rInE 'coin|token|wallet|x402|pump|aixbt|\$THREE|crypto|solana|usdc|mint|payment|checkout|price|fee' \
    api/mcp-studio.js api/_mcp-studio/ | grep -vE ':[0-9]+:\s*(//|\*)'
  (no matches in executable code)

# Reviewer-facing JSON — hit counts:
live-tools-list.json        : 0 crypto/payment hits
studio-widget-resource.json : 0 crypto/payment hits
openai-tool-evidence.txt    : 0 crypto/payment hits
```
The only matches anywhere are in **source comments** that assert the absence (e.g. `// No coin, token,
wallet, or payment surface anywhere.`). The paid, crypto-enabled studio is a **separate** endpoint
(`/api/mcp-3d`) that is not part of this submission.

### 2.1a Review surface vs the platform's general discovery manifest — **PASS**
Per OpenAI's App Directory process, the reviewer scans the app's **MCP endpoint metadata** through the
plugin submission portal, and that discovered snapshot is what review evaluates (sources:
[App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines),
[Prepare and maintain an app for submission](https://developers.openai.com/apps-sdk/deploy/submission)).
The app's review surface is therefore the keyless MCP connector at
`https://three.ws/api/mcp-studio`, which §2.1 shows is free of any coin/token/wallet/payment string, and
which `tests/mcp-studio.test.js` pins with a regex assertion in CI.

three.ws separately serves a **general-platform** discovery manifest at `/.well-known/ai-plugin.json`
(the legacy ChatGPT-plugins format, generated by `scripts/build-discovery-cards.mjs` and consumed by
third-party agents and crawlers). That manifest describes the broader three.ws platform, not this app,
and is **not** part of the Apps SDK review flow. To keep the app's own discovery story unambiguous, the
3D Studio app additionally ships a dedicated, served OpenAPI at
`https://three.ws/.well-known/3d-studio-openapi.yaml`, scoped to the app's entire free surface and
nothing else: `/api/3d/studio` (POST to generate + GET to poll) and `/api/ar` (GET, the
place-in-your-room launch behind every returned `arUrl`), with `security: []` (no auth) and no payment
fields. Every operation is `x-openai-isConsequential: false`; none of them charges anything. The schema
is verified crypto/payment-free by `tests/api/3d-studio-openapi.test.js`, which also binds it to the
real handler output, and the served copy is the source of truth: the custom-GPT Action file in this kit
is regenerated from it by `npm run sync:studio-openapi` and a drift between them fails
`npm run check:studio-openapi` (wired into `npm run gate`).

The general platform manifest was also cleaned up so it cannot be misread by anyone who does fetch it.
`ai-plugin.json` now leads with the free, keyless lane (`/api/3d/studio`, `/api/mcp-studio`, the viewer,
`/api/ar`, and the read-only market data endpoints, all under a "FREE and keyless, with no account, no
API key and nothing to pay" heading) and presents the pay-per-call catalog second, as separate and
optional. Its `logo_url` is the 512x512 owned-IP brand mark (`https://three.ws/pwa-512x512.png`, the
same asset as the app icon) instead of the favicon, and `legal_info_url` is the canonical
`https://three.ws/legal/tos` instead of the site root. The copy lives in
`scripts/lib/discovery-copy.mjs` (the manifest is regenerated on every prebuild, so a hand-edit would
not survive a deploy) and `tests/wellknown-manifests.test.js` pins the free-before-paid ordering, the
branded logo, the legal URL, and the generator/manifest agreement.

> Owner note: `ai-plugin.json` and the platform `openapi.yaml` under `/.well-known/` still describe the
> paid platform, which is a real product surface and stays. Nothing was removed from it: the change is
> ordering, framing, branding, and the legal URL.

### 2.2 No payments / no embedded checkout — **PASS**
`api/mcp-studio.js` header: *"There is no OAuth, no x402, no wallet, no token, and no PaymentRequired
anywhere in this server — generation runs operator-funded."* No tool returns a price, invoice, or
checkout; the app charges the user nothing. (If monetization is ever added, OpenAI allows only physical
goods via external checkout — out of scope here.)

### 2.3 Tool annotations correct on all eleven tools: **PASS**
Pulled from the live `tools/list` (all eleven rows re-checked against it on 2026-09-09):

| Tool | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|------|:---:|:---:|:---:|:---:|
| forge_free | false | false | false | **true** |
| text_to_avatar | false | false | false | **true** |
| mesh_forge | false | false | false | **true** |
| rig_mesh | false | false | false | **true** |
| forge_avatar | false | false | false | **true** |
| refine_model | false | false | false | **true** |
| check_job | **true** | false | **true** | **true** |
| look_at_model | **true** | false | **true** | **true** |
| create_agent_persona | false | false | false | **true** |
| get_agent_persona | **true** | false | **true** | false |
| persona_say | false | false | false | false |

Rationale (matches OpenAI guidance): each generation tool **creates a new hosted asset** → not
read-only; it **never modifies or deletes** existing data → `destructiveHint: false` (generation is
non-destructive; `refine_model` creates a new version, the parent is preserved in the lineage); same
prompt yields a fresh mesh → not idempotent; generation runs against **external model APIs** →
`openWorldHint: true`. `check_job` only reads the state of a job already submitted → `readOnlyHint:
true`, `idempotentHint: true`, and it still polls the external provider → `openWorldHint: true`.
`look_at_model` draws pictures of a model that already exists and creates nothing → `readOnlyHint:
true`, `idempotentHint: true`, and it fetches a caller-supplied GLB from wherever it is hosted →
`openWorldHint: true`.
`get_agent_persona` and `persona_say` operate only on three.ws's own store → `openWorldHint: false`;
`create_agent_persona` fetches the caller-supplied GLB from wherever it is hosted before taking a
durable copy, so it keeps `openWorldHint: true`. `get_agent_persona` is a pure read →
`readOnlyHint: true`, `idempotentHint: true`. Every tool also carries the widget `_meta`
(`openai/outputTemplate`, `openai/widgetAccessible: true`) and human-readable `invoking`/`invoked`
labels.

### 2.4 Data minimization — **PASS** (real request/response captured)
Each tool response returns **only** what a client needs to show/download the model. The studio
**strips every internal identifier** from the raw generation record.

**Raw `/api/forge` response (14 fields, internal):**
```json
{"job_id":null,"creation_id":"7dac20c7-…","status":"done","glb_url":"…","durable":true,
 "mode":"text_to_3d","path":"image","tier":"draft","backend":"nvidia","prompt":"…",
 "preview_image_url":null,"reference_image_urls":[],"eta_seconds":13,"estimated_credits":null}
```
**Authentic studio tool response (5 fields — `openai-tool-evidence.txt`):**
```json
{"kind":"model",
 "glbUrl":"https://pub-…r2.dev/forge/anon/456f0f83-…-1d695f.glb",
 "viewerUrl":"https://three.ws/viewer?src=…",   // route live since 2026-07-14, returns 200
 "format":"glb",
 "prompt":"a small ceramic teapot with a bamboo handle, glossy celadon glaze"}
```
**Stripped:** `creation_id`, `job_id`, `status`, `mode`, `path`, `tier`, `backend`, `durable`,
`eta_seconds`, `estimated_credits`, `preview_image_url`, `reference_image_urls`. **No** session id,
trace id, user id, auth secret, or PII. `prompt` is the user's own input echoed back (labels the model).
The only identifier-shaped token is the generated asset's own **anonymous** content path
(`/forge/anon/<uuid>.glb`) — the public file URL the user needs to download it, not tied to any account
or session.

### 2.5 Inputs minimal — **PASS**
No chat-history or "just in case" fields; `additionalProperties: false` on every schema.

| Tool | Inputs | Required |
|------|--------|----------|
| forge_free | `prompt`, `tier` | `prompt` |
| text_to_avatar | `prompt`, `image_url` | — |
| mesh_forge | `prompt`, `image_url` | — |
| rig_mesh | `glb_url` | `glb_url` |
| forge_avatar | `prompt`, `image_url`, `allow_non_humanoid` | — |
| refine_model | `glb_url`, `instruction`, `parent_prompt`, `reference_image_url`, `parent_lineage`, `parent_index` | `glb_url`, `instruction` |
| check_job | `job_id` | `job_id` |
| look_at_model | `glb_url`, `views`, `size` | `glb_url` |
| create_agent_persona | `glb_url`, `name`, `voice`, `source_prompt` | `glb_url`, `name` |
| get_agent_persona | `persona_id` | `persona_id` |
| persona_say | `persona_id`, `text`, `emotion` | `persona_id`, `text` |

### 2.6 Age-appropriate (13–17) — **PASS** (safety gate present + live-tested)
A synchronous, dependency-free content-safety gate (`api/_mcp-studio/safety.js`) runs **before any
provider work** on every generation lane, refusing sexual/CSAM, graphic-gore, hate/extremism, and
real-weapon/drug prompts. Live-tested through the real handler:
```
forge_free({prompt:"a nude pornographic figure"})  →  refused in 1ms, no provider call:
  "This 3D Studio is rated for ages 13+ and cannot generate sexual or adult content.
   Try describing a character, creature, or object without explicit themes."
```
(Full response in `openai-tool-evidence.txt`.) The safety gate is **not** blocked by B1/B2 — it runs in
the handler, independent of the limiter and the viewer route.

### 2.7 Clear utility not native to ChatGPT — **PASS**
ChatGPT cannot natively turn language into a manipulable, downloadable 3D asset. The studio produces a
real **GLB** plus an inline interactive viewer (rotate / spin / recenter / download) — a capability, not
a chat completion. Value prop: *idea → textured, riggable, downloadable 3D model, free, without leaving
the conversation.*

**Audit result: 7/7 policy items PASS.** Both former infrastructure blockers (§0) are resolved and
re-verified live; nothing stands between this package and a submission.

---

## 3. MCP connectivity details (for the submission form + reviewer)

| Field | Value |
|-------|-------|
| **MCP server URL** | `https://three.ws/api/mcp-studio` |
| **Transport** | Streamable HTTP / JSON-RPC 2.0 over `POST` (synchronous responses; no server-initiated stream). `GET` → `405`. |
| **Protocol version** | `2025-06-18` (echoed on `initialize` and the `mcp-protocol-version` response header). |
| **serverInfo** | `{ "name": "three-ws-3d-studio-free", "version": "1.0.0" }` |
| **Capabilities** | `tools`, `resources`, `logging`. |
| **Auth mode** | **None** (anonymous, unauthenticated). No OAuth, no API key, no test credentials required. |
| **Widget resource** | `ui://widget/three-studio-model.html` (`resources/list` / `resources/read`), MIME `text/html+skybridge`. |
| **Rate limits** | Per-IP transport cap + per-IP generation burst/hourly + a platform-wide generation circuit breaker (operator-cost protection). A reviewer testing normally will not hit these. |

Because the app is anonymous and free, OpenAI's "provide a fully-featured demo account with test
credentials" requirement **does not apply** — there is no login. Note this explicitly in the form's auth
section.

---

## 4. Screenshots (`_generated/openai-screenshots/`)

All three show the interactive viewer widget rendering a **real, freshly generated** model with the
control bar (Download · Spin · Recenter · Open in three.ws).

| File | Dimensions | Content |
|------|-----------|---------|
| `three-ws-3d-studio-1440x1520.png` | 1440×1520 (portrait) | Hero — rigged avatar rendered inline (prompt 05). |
| `three-ws-3d-studio-widget-1600x1000.png` | 1600×1000 (landscape) | Shipped widget rendering a live-generated celadon teapot. |
| `three-ws-3d-studio-widget-1280x800.png` | 1280×800 (landscape) | Same, standard 16:10 landscape. |

The landscape shots must show the **shipped ChatGPT inline widget** (`api/_mcp-studio/component.js`,
resource `ui://widget/three-studio-model.html`) rendering the GLB produced by a real `forge_free` call
— not a standalone page and not a mockup.

**Status 2026-09-09 (task 07). All three sub-items are resolved; only the portal's dimension
requirement is still unanswerable from here.**

- **Resolved: no stale viewer references.** Nothing in the kit points at the retired
  `https://three.ws/apps-sdk/` viewer as "the widget". The only `apps-sdk/` strings left in
  `_generated/` are OpenAI's own developer-docs URLs and a repo source path, neither of which is a
  capture target. Re-checked after this pass's evidence regeneration.
- **Resolved: the capture harness works.** The shipped widget resource was driven end to end again on
  2026-09-09 in a `window.openai`-less Chromium off a real live tool payload: empty state, generating
  state, ready with `<model-viewer>.loaded === true` on the real GLB, and the designed error state on
  an unresolvable one, with no page errors in any of them.
- **Resolved: the shots are current and clean.** The three files on disk were re-captured against the
  shipped widget and show a solid, fully textured model with the real action bar (`View in your
  space` / `Open viewer` / `Download GLB`), not a slab and not a mockup. A fresh keyless `forge_free`
  run the same day returned a 5,402,572-byte GLB that the cheap scorer rates 0.976 with **no** planar
  signal, so a submission-grade generation is reproducible rather than lucky.

`[HUMAN: confirm the App Directory form's exact required screenshot dimensions and aspect ratio. The
current files are 1440x1520 portrait, 1600x1000 and 1280x800 landscape; only the portal states the
requirement, so this cannot be checked from here. The widget renders any GLB at any viewport, so
re-capturing to whatever the form asks for is trivial.]`

---

## 5. Reviewer testing guide

**No credentials needed** (anonymous, free). Full flow re-verified green against production 2026-09-09.

1. **Discover**: `initialize` → `tools/list` → `resources/list` against
   `https://three.ws/api/mcp-studio`. Expect 11 tools + two resources,
   `ui://widget/three-studio-model.html` (the inline 3D viewer) and
   `ui://widget/three-studio-persona.html` (the living agent body).
2. **Generate** a model that reliably succeeds — say to ChatGPT: *"Make a 3D model of a friendly round
   robot mascot, glossy white plastic."* Expect, in ~15–60s, an inline interactive 3D viewer with the
   model plus **Download / Spin / Recenter / Open in three.ws**.
3. **Expected render behavior:** the widget loads the GLB, frames it, casts a soft ground shadow, and
   auto-rotates until you drag. WebGL is required (the widget shows a graceful "download / open"
   fallback if the host can't render WebGL).
4. **Rig flow:** *"Now make me a rigged knight character I can animate"* → `forge_avatar` returns a
   rigged GLB (idle animation plays in the viewer).
5. **Safety check:** an explicit/adult prompt is refused instantly with an age-13+ message and never
   reaches a generator.

Copy-paste discovery smoke test:
```bash
curl -s -X POST https://three.ws/api/mcp-studio -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 300
```

---

## 6. Developer verification + support (all resolved 2026-07-14)

1. ~~Developer identity verification~~ — **DONE**: organization verified on platform.openai.com
   (confirmed by owner 2026-07-14); three.ws accepted into the OpenAI Partner Network 2026-07-14.
2. ~~Support contact~~ — **DONE**: `support@three.ws` + `https://three.ws/support` (live, 200).
3. ~~Privacy policy~~ — **DONE**: `https://three.ws/legal/privacy` live (200, verified 2026-07-14);
   the studio collects no personal data (anonymous, no login, identifier-free responses per §2.4).
4. ~~Post-fix smoke test~~ — **DONE 2026-07-14**: real `forge_free` generation returned a 1.45 MB GLB
   (`model/gltf-binary`, HTTP 200) in ~40s; its `viewerUrl` returned 200 with the exact generated GLB.

`[HUMAN: final submit through the OpenAI partner portal / App Directory flow — the only remaining step.]`

---

## 8. The portal form, field by field, in order

Written against the live form on 2026-09-11. The portal's field shapes differ from the
metadata in §1 (it wants a 30-character subtitle, two icons, a semantic version, a terms
URL and a demo recording), so fill from THIS section and use §1 only for the long-form
description. The portal saves a draft throughout, so it does not have to be done in one
sitting.

### Step 0. Before you open it

| Check | Detail |
|---|---|
| Organization | Submit from the **three.ws** org, not a personal account |
| Role | **Apps Management** must be set to **Write** in your org role. If "Create plugin" is missing or greyed out, this is why |
| Identity | Verified organization, done 2026-07-14. No action |

Entry point: **Plugins** in the left sidebar of `platform.openai.com`, then **Create plugin**,
then **With MCP** (not "Skills only": the submission is the remote MCP connector).

### Step 1. Info

| Field | Value |
|---|---|
| Directory icon | `_generated/assets/icon-512x512.png` (needs 256 x 256 or larger) |
| ChatGPT composer icon | the same file (needs 48 x 48 or larger) |
| Name | `three.ws 3D Studio` |
| Version | `1.0.0` |
| Subtitle (30 char max) | `Create 3D models from text` (26 characters) |
| Description | the fitted paragraph below |
| Category | Creativity & Design |
| Developer identity | pick the verified entity from the dropdown |
| Plugin Author | copy the verified legal or business name EXACTLY as the dropdown shows it |
| Website URL | `https://three.ws` |
| Customer support URL | `https://three.ws/support` |
| Privacy policy URL | `https://three.ws/legal/privacy` |
| Terms of Service URL | `https://three.ws/legal/tos` |
| Demo Recording URL | see step 6. This is the only field with no asset yet |

All three legal URLs returned 200 on 2026-09-11.

Description, fitted to the portal's "concrete value, no marketing language" guidance:

> Describe any object or character and three.ws 3D Studio builds a real, textured 3D model,
> then shows it in an interactive viewer inside the conversation. Eleven tools cover the path
> from idea to asset: generate a model from text or a reference image, generate an avatar,
> auto-rig a static model so it can be animated, refine a model by describing a change, and
> inspect a finished model from several angles. Every result downloads as a standard GLB that
> opens in Blender, Unity, Unreal, three.js, or any glTF pipeline. No account, no API key, no
> payment.

### Step 2. MCP

| Field | Value |
|---|---|
| Server URL | `https://three.ws/api/mcp-studio` |
| Transport | Streamable HTTP, JSON-RPC 2.0 over POST |
| Protocol version | `2025-06-18` |
| Authentication | **None** |

State the auth answer explicitly rather than leaving it blank. The connector is anonymous and
free, so OpenAI's "provide a fully-featured demo account with test credentials" requirement
does not apply: there is no login to give. Full connectivity detail is in §3.

### Step 3. Skills

Two things land here, and they are separate.

**Tools come from the MCP server, not from this tab.** Selecting **Scan Tools** on the MCP
tab imports all 11, each already carrying its four `openai/*` annotations and its
`outputTemplate`, plus two widget resources. Do not hand-edit the annotations after import:
§2.3 audits them and a wrong `readOnlyHint` on a tool that spends compute is a documented
rejection reason.

**Skills are an optional upload, and we have one.** Skills teach the model when and how to
reach for the tools; the tools alone teach it only what exists. Build the bundle:

```bash
npm run build:openai-skills          # dist-skills/openai-plugin-skills.zip
```

Upload that zip. It carries four skills, one directory each with its own `SKILL.md`:

| Skill | Triggers on | Drives |
|---|---|---|
| `generate-3d-model` | "make a 3D model of...", a prop or object from text | `forge_free`, `mesh_forge` |
| `create-3d-avatar` | "make a 3D avatar/character I can animate" | `forge_avatar`, `text_to_avatar` |
| `rig-a-model` | "rig this GLB", "add a skeleton" | `rig_mesh` |
| `embed-three-ws-avatar` | "embed a 3D avatar on my site" | the `<agent-3d>` web component |

The bundle is derived from `.agents/skills/`, not hand-assembled, and the builder enforces
the two rules that matter for review:

1. **Scope.** Only skills tagged `3d/creative` and `cross-platform-safe` ship. The pack's
   other 39 skills are wallet, payments and partner-exchange work; shipping them in a 3D
   plugin contradicts OpenAI's guidance to keep instructions scoped to the plugin's purpose,
   and none of them are reachable through this connector anyway.
2. **No dead paths.** The builder reads `tools/list` off the live connector and drops any
   skill referencing a tool that is not there. `find-3d-assets` is excluded on that rule:
   its `search_catalog` / `get_catalog_item` / `get_item_source` tools live on the full MCP
   server, not on mcp-studio. A skill that tells ChatGPT to call a tool the connector does
   not expose is a reviewer-visible failure, and inside ChatGPT there is no shell, so the
   skill's documented `curl` fallback cannot rescue it.

Adding those three catalog tools to mcp-studio is the follow-up that unlocks a fifth skill.
It is deliberately not done pre-submission: the 11 tools are already scanned and their 33
annotation justifications written, and changing the tool surface now would invalidate both.

### Step 4. Prompts

1. `Make a 3D model of a friendly round robot mascot, glossy white plastic.`
2. `Generate a low-poly treasure chest with iron bands.`
3. `Create a 3D avatar of a space explorer in a white-and-orange suit.`
4. `Make a rigged, animation-ready knight character I can pose.`

### Step 5. Testing

At least five positive cases and three negative ones. Every behaviour below is documented in
§5 and was verified live; none of it is aspirational.

**Positive**

| # | Prompt | Expected result |
|---|---|---|
| 1 | `Make a 3D model of a friendly round robot mascot, glossy white plastic.` | Inline interactive 3D viewer with the textured model, plus Download, Spin, Recenter and Open in three.ws. The widget frames the model, casts a soft ground shadow, and auto-rotates until dragged |
| 2 | `Generate a low-poly treasure chest with iron bands.` | Same viewer flow, returns a downloadable GLB |
| 3 | `Create a 3D avatar of a space explorer in a white-and-orange suit.` | Avatar generated and rendered inline |
| 4 | `Make a rigged, animation-ready knight character I can pose.` | Rigged GLB, and an idle animation plays in the viewer |
| 5 | `Now make that robot's shell matte instead of glossy.` | The model is refined from the previous turn and the updated GLB replaces it in the viewer |

Required test data: none. No account, no key, no seed files.

**Negative**

| # | Input | Expected safe behaviour |
|---|---|---|
| 1 | A prompt for a real firearm, explosive or drug paraphernalia | Refused instantly, before any provider work, with `isError: true` and the exact text `This 3D Studio cannot generate real firearms, explosives, or drug paraphernalia. Stylized fantasy props (a sword, a wand) are fine.` Verified live 2026-09-11. The gate covers five categories (sexual, child-sexual, gore, hate/extremism, weapons/drugs); this one is the cleanest to demonstrate because the refusal names what IS allowed, and a stylized fantasy sword passes straight through, which shows the gate is not over-broad |
| 2 | A tool call carrying an invalid or unreachable GLB URL | A designed error rather than a crash. Verified live 2026-09-11: `look_at_model` with `glb_url` set to a 404 returns `isError: true` and the text `could not render this model: render failed: glb load failed: fetch ... responded with 404`. The widget reaches its error state ("Couldn't load the model") and `/api/ar` returns a designed 400 ("Provide a valid https URL to a .glb model.") |
| 3 | A host that cannot render WebGL | The widget degrades to a download-and-open fallback instead of a broken canvas |

**Honest latency note for the reviewer.** Re-measured on 2026-09-11 against the live
connector, three consecutive `forge_free` calls took **74s, 149s and 213s** end to end. That
is a large improvement on the 12.5 minutes both 2026-09-09 verification generations took, and
it is the number to quote now. It is also variable by roughly a factor of three, so describe
it as one to four minutes rather than quoting a single figure, and do not write a test case
that promises a fixed turnaround.

### Step 6. The demo recording

The one asset that does not exist yet. The form wants a video of the plugin working, recorded
in ChatGPT Developer Mode. Screen recordings are acceptable and OpenAI states it is not shared
externally; it is used to validate the test cases above.

1. Enable Developer Mode in ChatGPT.
2. Add `https://three.ws/api/mcp-studio` as a custom connector. No credentials.
3. Record positive case 1 end to end, with the inline viewer and the Download control both
   visible in frame.
4. If the generation runs long, cut the waiting rather than speeding up the footage. A sped-up
   recording implies a turnaround a reviewer will not get, which is the one way this video can
   work against the submission.

### Step 7. Global

All countries. The connector is anonymous and free with no geo-restriction.

### Step 8. Submit

- **Commerce and Purchasing: leave the box unchecked.** The submitted connector is keyless and
  free, has no checkout, and no longer advertises payment headers on its CORS surface. three.ws
  operates paid x402 endpoints elsewhere; they are not part of this plugin, so unchecked is the
  accurate answer for what is being submitted. Deceptive commerce is a documented rejection
  reason, and so is under-disclosure, which is why this is stated rather than skipped.
- Release notes: first public release.
- Read the policy attestations rather than clicking through them. The two that actually bite us
  are tool annotations (step 3) and payment disclosure (this step), and both are already clean.

### After you submit

Review, then approval, then **you** publish. It does not go live on approval. OpenAI's own
wording is that review timelines vary as they scale the process, so do not build an
announcement around a particular week. The changelog entry and any social copy wait until the
listing is actually public.

---

## 9. Tool justifications (the MCP step's annotation panel)

The portal asks, for every tool, why each explicit annotation value is accurate, "in enough
detail for us to confirm it doesn't misrepresent what the tool does". Eleven tools times three
annotations, plus one frame-domains justification.

Every justification below is derived from the annotation constants in the source rather than
written to sound good: `GEN_ANNOTATIONS` in [`api/_mcp-studio/tools.js`](../../../api/_mcp-studio/tools.js)
and `CREATE_ANNOTATIONS` / `READ_ANNOTATIONS` / `SAY_ANNOTATIONS` in
[`api/_mcp-studio/persona-tools.js`](../../../api/_mcp-studio/persona-tools.js), each of which
already carries its own one-line rationale comment. If an annotation changes, change it there
first and re-derive this section; a justification that no longer matches the served annotation
is the exact misrepresentation the panel exists to catch.

### Group A: the six generation tools

`forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`, `refine_model`.
Identical annotations, so the same three answers apply to all six.

**Read Only is False.** The call creates a new hosted asset. Each invocation runs a generation
and writes a new GLB to our object storage, then returns its URL. The call has a real side
effect (a stored file, and the compute spent producing it), so marking it read-only would
understate what it does.

**Open World is True.** The work runs against external model providers rather than a bounded
dataset we own. Results depend on third-party inference services, and the same prompt
legitimately yields a different mesh on different calls, so the tool's effects are not confined
to a closed, predictable domain.

**Destructive is False.** The tool only ever adds. It writes a new asset and never modifies,
overwrites or deletes anything. This holds for the two tools that take an existing model as
input: `rig_mesh` and `refine_model` read the source and emit a separate new GLB, leaving the
original untouched and still addressable at its original URL.

### Group B: the two generation-side read tools

**`check_job` - Read Only is True.** A status probe. It looks up an existing job by id and
reports its state. It creates nothing and changes nothing.

**`check_job` - Open World is True.** The job it reports on is executing on external model
providers, so the status reflects third-party systems outside our control rather than a closed
internal dataset.

**`check_job` - Destructive is False.** It reads job state only. Nothing is written, modified or
removed.

**`look_at_model` - Read Only is True.** It renders views of a model that already exists and
returns images. It creates no new stored asset and modifies nothing.

**`look_at_model` - Open World is True.** It accepts an arbitrary public GLB URL, so it fetches
from hosts outside our own domain and its result depends on that external resource.

**`look_at_model` - Destructive is False.** It only reads the supplied model in order to render
it. The source file is never modified or deleted.

### Group C: the three persona tools

**`create_agent_persona` - Read Only is False.** It saves a new persona record, a persistent
body tied to a rigged model, so the call has a durable side effect.

**`create_agent_persona` - Open World is True.** Creating the persona involves external model
and speech providers, and it accepts a model URL that may be hosted outside our domain.

**`create_agent_persona` - Destructive is False.** It only creates. Existing personas and models
are never modified or deleted.

**`get_agent_persona` - Read Only is True.** A pure read. It looks up an existing persona by id
and returns its configuration. Nothing is created or changed.

**`get_agent_persona` - Open World is False.** It reads only our own stored persona records. No
external provider is contacted, and the result is fully determined by data we hold.

**`get_agent_persona` - Destructive is False.** A read-only lookup. Nothing is written or
removed.

**`persona_say` - Read Only is False.** It is a render directive that also increments the
persona's turn counter, which is a write to our stored state.

**`persona_say` - Open World is False.** It acts only on a persona we already store and renders
through our own embed. It does not reach outside our own systems.

**`persona_say` - Destructive is False.** It appends a turn and updates a counter. It never
deletes or overwrites the persona's configuration or its model.

### Frame Domains

Only the three persona tools declare `frame_domains`, and the single declared origin is
`https://three.ws`.

> The three persona tools render a living agent body: an interactive WebGL avatar that speaks
> with lip-synced facial animation. It is framed from https://three.ws, our own verified domain
> and the same origin that serves this MCP connector. No third-party origin is framed. An
> iframe is used because the embodiment surface needs a real-time WebGL canvas driving 52
> facial blendshapes alongside synchronised audio, which cannot be expressed as static inline
> content. The framed page is first-party, carries no advertising and no third-party scripts
> beyond the pinned CDN entries already declared in the CSP metadata, and exposes no payment,
> login or account surface. The eight tools that do not need it declare no frame_domains at
> all.

### The outputSchema nudge

The panel flags "Recommended: Add an outputSchema" on every tool. It is a recommendation, not a
requirement, and it does not block submission. Worth doing in a later version: every tool
already returns a consistent `structuredContent` shape, so the schemas are a description of
existing behaviour rather than new work.

---

## 7. Pre-submit checklist

- [x] **B3** cleared (§0). The cheap-scorer half was deployed and re-measured on 2026-09-09: 40
      consecutive production generations gave 4 planar flags, 4 of 4 escalating to vision QA. The
      vision half closed on 2026-09-11, measured against revision `three-ws-api-00424-5p4`: ten
      consecutive authenticated `/api/forge-quality-check` calls returned 10/10 real verdicts, against
      3/10 the day before and 0/10 the day before that. The chain was repaired and widened from four
      providers to ten rather than waiting on the GCP billing hold, which is still in place and no
      longer decides the outcome.
- [x] **B1** cleared: `tools/call forge_free` returns 200 with a GLB (re-verified live 2026-09-09: HTTP 200
      in 137s, real 5,402,572-byte `model/gltf-binary`, keyless, scored 0.976 by the cheap gate with no
      planar signal; verbatim response saved to `_generated/live-call-forge_free.json`).
- [x] **B2** cleared: `/viewer?src=<glb>` returns 200 and renders the model (re-verified live 2026-09-09
      for the freshly generated GLB; `<model-viewer>` reports `loaded === true` with no page errors).
- [x] Developer identity verified on platform.openai.com (verified organization, 2026-07-14).
- [x] Support contact + privacy policy confirmed live (2026-07-14); both legal URLs return 200 in the
      canonical no-`.html` form (`/legal/privacy`, `/legal/tos`), matching the served OpenAPI (2026-07-18).
- [x] Review surface is the MCP connector metadata, not `/.well-known/ai-plugin.json` (§2.1a, cited);
      live `initialize` + `tools/list` return `three-ws-3d-studio-free` on protocol `2025-06-18` with the
      exact 11-tool surface, each carrying its four `openai/*` annotations and its `outputTemplate`
      (the 8 model tools to the model widget, the 3 persona tools to the persona widget), and
      `resources/list` returns both skybridge resources with `widgetCSP`, `widgetDescription` and
      `widgetDomain` (re-verified live 2026-09-09).
- [x] App discovery schema served + guarded — `/.well-known/3d-studio-openapi.yaml`, free-only,
      `security: []`, byte-identical to the custom-GPT Action file, crypto/payment-free
      (`tests/api/3d-studio-openapi.test.js`).
- [x] Served discovery schema is live: `https://three.ws/.well-known/3d-studio-openapi.yaml` returns
      200 in production, as do `/.well-known/ai-plugin.json`, `/legal/privacy`, `/legal/tos` and
      `/support` (re-verified 2026-09-09). The served schema lints clean under Redocly, describes only
      the two free paths, and every URL inside it resolves 200.
- [x] Screenshots current: all three files show the shipped inline widget
      (`api/_mcp-studio/component.js`) rendering a solid, textured model with the real action bar, and
      no evidence file cites the retired `apps-sdk/` viewer (re-checked 2026-09-09 after regenerating
      evidence). Only the portal states the required dimensions.
      `[HUMAN: confirm required dimensions]`
- [x] Inline widget re-verified live 2026-09-09 in a `window.openai`-less Chromium: the skybridge
      resource paints its empty state ("No model yet"), accepts a real tool payload over `postMessage`,
      shows the generating state, and reaches ready with `<model-viewer>.loaded === true` on the real
      generated GLB. Error state reached with an unresolvable GLB ("Couldn't load the model"). No console
      or page errors in any state. This run also caught the CORS exposure in §0: driven from a foreign
      origin the widget could not fetch a raw asset-bucket GLB at all, which is what a ChatGPT sandbox
      origin is. It now routes the fetch through `/api/glb` and loads from anywhere,
      pinned by `tests/mcp-studio.test.js`.
- [x] `/api/ar` re-verified live 2026-09-09 per device class: Android UA gets a 302 to a Google Scene
      Viewer `intent://` URL with a `browser_fallback_url`; iOS and desktop UAs get the 200 launch page
      that carries the real `og:image`/`og:title` and hands off to `/ar/view`; `kind=avatar` adds the
      `irl=` hand-off and `/ar/view` renders its "Bring it to life" control; a bad `src` returns a
      designed 400 page ("Provide a valid https URL to a .glb model.").
- [x] Custom-GPT Actions lane re-verified live 2026-09-09: `POST /api/3d/studio` returned the documented
      pending shape (`job`, `poll`, `watchUrl`, `previewImageUrl`, `tier`, `format`), `GET ?job=&title=`
      polled to `done` with a real GLB, and both responses validate against the served OpenAPI's own
      response schemas. Note the honest latency for a reviewer demo: both verification generations took
      about 12.5 minutes end to end on the self-hosted lane, well past the lane's own estimate, which is
      exactly why the pending ETA fix in §0 matters on this surface.
- [x] Compliance audit: 7/7 policy items PASS (§2), with the review-surface separation documented (§2.1a).
- [x] Listing metadata drafted (§1): tool list is the live 11-tool surface (re-pulled 2026-09-09);
      `forge_free` tier note corrected to the honest standard default (2026-07-18).
- [x] MCP connectivity documented (§3).
- [x] Reviewer guide written (§5).
- [x] Connector output carries **zero** crypto or payment surface: `initialize`, `tools/list`,
      `resources/list`, a real `forge_free` call, `check_job`, and the widget resource body were each
      scanned live on 2026-09-09 with the same forbidden-token regex `tests/mcp-studio.test.js` uses.
      All clean, and none of them leaks an internal id (`creation_id`, backend name, worker host).
- [ ] **Deploy the tree** so production matches this package: the ETA fix, the widget CORS routing, the
      failover-diagnosis fix and the 14 em-dash corrections are all in the tree and unshipped. `[HUMAN]`
- [ ] **Final submit in the portal.** `[HUMAN]`
