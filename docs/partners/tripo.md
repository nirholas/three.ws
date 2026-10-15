# Tripo x three.ws: partnership brief

*Drafted 2026-10-09, after Tripo reached out. A working brief for the first call and the
reply, not a status report. Every number about three.ws was read from production on the
drafting date; every number about Tripo is labelled with where it came from, and the ones
Tripo publishes about itself are marked as such.*

**TL;DR.** Tripo is the only 3D generation company whose work already runs in three
separate places inside three.ws: a paid API lane, a self-hosted open-weight worker, and a
hosted failover rung. The open-weight lane is busy and the paid lane is almost unused, for
one reason: the paid lane needs the user's own Tripo key. A partner key closes that gap,
puts Tripo in front of every Forge user instead of the few who bring a key, and gives Tripo
a production surface for the endpoints we have not wired yet (rigging, retargeting,
low-poly, splats, segmentation).

---

## Who Tripo is

| Fact | Value | Source |
|---|---|---|
| Company | VAST, the team behind Tripo, TripoSR and TripoSG | [tripo3d.ai](https://www.tripo3d.ai) |
| Latest round | Series B/B+, about RMB 3B (about USD 446M), 2026-09-01, led by Matrix Partners China with game publishers as strategic investors | Press (36kr, DealStreetAsia), not a filing |
| Earlier 2026 rounds | USD 50M Series A (March), about USD 200M A+/A++ (June), USD 150M A3 (July) | Press |
| Users | 6.5M creators, about 90K developers, about 100M models | Tripo's own figures, not independently verified |
| API | v3 at `openapi.tripo3d.com/v3`, with a published v2-to-v3 migration guide | [developers.tripo3d.com](https://developers.tripo3d.com) |
| API pricing | 1 credit = USD 0.01. Text to 3D 10 (untextured) or 20 (textured); image or multiview 20 or 30; HD texture +10; quad +5; auto-rig 25; retarget 10 per clip; rig check free | developers.tripo3d.com, checked 2026-10-09 |
| Enterprise route | "custom volumes, dedicated support, or SLA guarantees" via **business@tripo3d.ai** | Tripo's official pricing page |
| Affiliate program | 30% recurring for 12 months on Tripo's own terms page; a third-party affiliate network lists different terms | Confirm on the call |

### Their open source, which we already depend on

Star counts from the GitHub API on 2026-10-09:

| Repo | Stars | License | Used by three.ws |
|---|---|---|---|
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) | 7,035 | MIT | Yes: hosted failover rung (Hugging Face Space, Replicate) |
| [TripoSG](https://github.com/VAST-AI-Research/TripoSG) | 1,825 | MIT | Yes: self-hosted worker `workers/model-triposg` |
| [UniRig](https://github.com/VAST-AI-Research/UniRig) | 1,804 | MIT | Planned: non-humanoid rigging, order `069-best3d-03` |
| TripoSplat | 1,365 | MIT | No |
| TripoSF, HoloPart, AniGen, SkinTokens, MIDI-3D | 463 to 952 each | check each LICENSE before use | AniGen and SkinTokens are planned in `069-best3d-03` |

---

## What three.ws already runs on Tripo

Verified in this repository and in production on 2026-10-09.

| Surface | Where | What it does |
|---|---|---|
| Tripo v3.1 API lane, bring-your-own-key or house key | [`api/_providers/tripo.js`](../../api/_providers/tripo.js), tier entry in [`api/_lib/forge-tiers.js`](../../api/_lib/forge-tiers.js) | Text and image to 3D on model `v3.1-20260211`, on the **v3** endpoint `openapi.tripo3d.com/v3`. Runs on a pasted user key, or on `TRIPO_API_KEY` when the platform sets one (a High-tier default and an explicit "Tripo" engine choice, billed to $THREE credits); the BYOK key link in the Forge points at `platform.tripo3d.ai/api-keys` |
| Signed webhook receiver | [`api/forge/webhook/tripo.js`](../../api/forge/webhook/tripo.js) | Verifies `Tripo-Webhook-Signature`, claims `Tripo-Webhook-Delivery` for idempotency, and completes a job the same way polling does; registering the endpoint URL in Tripo's dashboard and setting `TRIPO_WEBHOOK_SECRET` are the owner's last step |
| TripoSG, self-hosted | [`workers/model-triposg`](../../workers/model-triposg/) | The sketch-to-3D lane, and the last automatic failover rung for photo jobs ([forge failover](../forge.md)) |
| TripoSR, self-hosted and hosted | [`workers/model-triposr`](../../workers/model-triposr/) (the fast lane in the avatar pipeline controller), plus a rung in the free Hugging Face Spaces chain ([`api/_providers/huggingface.js`](../../api/_providers/huggingface.js)) | The fast path, at about 3 seconds of GPU time per mesh, and part of the free photo-to-3D failover chain |

### The number that shapes the pitch

Production, last 30 days, internal jobs excluded (`forge_creations`, grouped by `backend`):

| Lane | Jobs | Finished |
|---|---|---|
| TripoSG, self-hosted (open weights) | 197 | 124 |
| Tripo API, user's own key | **2** | 2 |

Tripo-family jobs have grown every month since July (32, 81, 101, then 114 in the first nine
days of October), almost all of it on the open-weight worker. The paid lane is nearly idle
because almost nobody arrives at a 3D tool already holding a Tripo key. That is the gap a
partnership closes: Tripo's best model is one setting away from a Forge that took **12,373** generation and
rigging requests from real makers in September (the audited figure in the proof brief, which
excludes catalog seeders and benchmarks), and the setting is currently "go and sign up somewhere else first".

For the wider evidence (completion rate, makers, MCP traffic), use the
[30-day proof brief](./proof-brief-2026-10.md) and quote its numbers the way it says to.

---

## The proposal

### What we ask Tripo for

1. **A partner-priced platform key**, so Tripo becomes a house lane in the Forge rather than
   a bring-your-own-key option. The natural placement is the High tier, where Tripo competes
   on quality, and an explicit "Tripo" engine choice for users who want it by name.
2. **Raised concurrency** above the published defaults (H-series 10, P-series 5, rig 10),
   sized to the house-lane volume we agree.
3. **Early access** to new H-series and P-series models and to the splat endpoint, so the
   Forge can ship them on Tripo's launch day.
4. **Co-marketing**: a joint launch post when the house lane goes live, and a listing on
   Tripo's integrations or plugins page.
5. **Written confirmation** that we may keep self-hosting TripoSG and TripoSR in production
   with attribution, and say so publicly. Both are MIT, so this is courtesy, not licensing,
   but it makes the joint story clean.
6. **The affiliate or referral terms** that apply to the BYOK key link we already render.

### What we offer Tripo

1. **Migration to the v3 API with signed webhooks**, replacing polling on the legacy v2
   endpoint.
2. **The endpoints we do not use yet, wired as Forge features**: auto-rig and retarget on
   the avatar path (they slot into our universal retargeter, which already drives any
   humanoid rig), P1/P2 low-poly and quad as a game-ready preset, the image-to-splat endpoint
   on the splat stage, and Smart Segmentation on the parts editor.
3. **Agent distribution**: Tripo exposed through our MCP servers (13,898 tool calls in
   September at 99.4% handler success, from 13 distinct MCP clients including ChatGPT,
   Claude and Cursor), through the `<agent-3d>` embed with engine attribution, and through
   our paid per-call agent lane.
4. **Benchmarks**: anonymised per-engine completion, latency and quality-gate verdicts from
   our failover grid, where Tripo runs side by side with TRELLIS and Hunyuan3D on the same
   prompts. No other customer can give them that comparison from live traffic.
5. **Upstream work** on the open repos we run: fixes to TripoSG, UniRig and ComfyUI-Tripo
   as we hit them in production.

### Deal shapes, from smallest to largest

| Shape | What changes | Who pays |
|---|---|---|
| **A. Credits pilot** | Tripo grants credits for a 60-day house-lane pilot; we ship v3 plus webhooks and report the numbers | Tripo (credits) |
| **B. Partner pricing** | A discounted per-credit rate on a committed monthly volume; Tripo becomes a permanent High-tier lane | three.ws, at a partner rate |
| **C. Revenue share** | Tripo jobs sold through our paid lanes carry a margin both sides agree; Tripo lists three.ws as an integration | Shared |

Start the conversation at A. It costs Tripo little, proves volume with real data, and every
engineering item we ship for it is kept whichever way the deal goes.

---

## Questions for the first call

1. Who on their side owns platform partnerships, and is there a partner tier separate from
   enterprise and affiliate?
2. Are credits, a partner rate, or a revenue share the shape they want?
3. Concurrency ceiling for a partner key, and whether webhooks count against it.
4. Their roadmap for the splat and P-series endpoints, and whether early access is possible.
5. Attribution rules: how they want Tripo named in the Forge engine picker and in exports.
6. Whether their own users can generate in Tripo and land straight in a three.ws agent (a
   "send to three.ws" export), which is the reciprocal integration.

---

## Engineering, shipped

The integration work closed as work order 084; see
[the Tripo house lane doc](../forge.md#the-tripo-house-lane) for the live, user-facing
description of what shipped:

- **v3 migration**: done. The provider speaks the v3 REST API end to end (dedicated
  endpoints per capability, the unified `input`/task-id model, the unified error envelope).
- **House key**: done. `TRIPO_API_KEY` makes Tripo a High-tier default and an explicit
  engine choice, billed to $THREE credits like the other house lanes; with the variable
  unset, behavior is unchanged. It does not exist on the production service yet (checked
  2026-10-09), so flipping it on is the owner's decision: it onboards a paid API.
- **Signed webhooks**: done. Polling stays the fallback.
- **Auto-rig**: done. `rig({spec:'mixamo'})` output canonicalizes through
  `glb-canonicalize.js`'s existing Mixamo mapping and drives the universal retargeter,
  the same as any other humanoid rig.
- **Low-poly/quad game-ready preset and Smart Segmentation**: the provider methods exist
  (`decimate()`, `segment()` in `api/_providers/tripo.js`) but are not dispatched from any
  endpoint. Both capabilities already run on self-hosted GCP workers in production
  (`workers/remesh` for game-ready, with FBX export and PBR re-bake Tripo's endpoint does
  not do; `workers/segment` + PartCrafter/HoloPart for parts, order `070-best3d-04`), which
  the owner's standing GCP-first directive prefers over an equivalent paid third-party lane.
  Wiring Tripo here would add a strictly narrower alternative, not new capability; revisit
  if the partnership itself makes Tripo's version the one worth shipping.
- **Splat**: no live Tripo endpoint exists to wire (checked again 2026-10-12). The splat
  stage (`docs/splat.md`) has no Tripo-backed path; this is the "early access" item in the
  proposal above, not something we can build today.

---

## Reply draft

Send from the owner's account to the person who reached out, copying
`business@tripo3d.ai` if the first contact did not come from there.

> Subject: three.ws x Tripo: a house lane for Tripo in the Forge
>
> Hi, thanks for reaching out. Good timing: Tripo already runs in three places inside
> three.ws. Your v3.1 model is a lane in our Forge, TripoSG powers our sketch-to-3D tool and
> sits in our photo failover chain, and TripoSR is a rung in the free tier.
>
> The catch is that the v3.1 lane only works for users who bring their own Tripo key, so
> almost nobody uses it, while the Forge took over 12,000 generation and rigging requests from real makers last month.
> We would like to change that: make Tripo a built-in lane on our top quality tier, move to
> your v3 API with webhooks, and add your rigging, low-poly, splat and segmentation
> endpoints as Forge features. Those would also reach the agents that use three.ws through
> MCP (about 14,000 tool calls last month, from ChatGPT, Claude, Cursor and others).
>
> A simple first step would be a 60-day pilot on partner credits, with us reporting
> completion, latency and quality numbers side by side with the other engines we run.
>
> Are you free for a call next week? Happy to show the Forge live.
>
> Best,
> [owner name], three.ws

---

## Related

- [Partner prospects](./prospects.md): the full list of companies worth approaching, of
  which Tripo is the first.
- [Partnership outreach plan](./outreach-plan.md): how the list is worked, wave by wave.
- [Forge](../forge.md) and [How the Forge works](../how-forge-works.md): the engine grid Tripo
  plugs into.
- [3D landscape, October 2026](../research/3d-landscape-2026-10.md): the open-source sweep
  that put UniRig and the rigging stack on the roadmap.
