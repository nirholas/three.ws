# Tripo x three.ws joint launch post: DRAFT FOR THE OWNER

**Status: draft only. Not sent, not agreed with Tripo.** Do not publish until (1) Tripo has
replied and agreed to co-market, (2) `TRIPO_API_KEY` is on the `three-ws-api` service, and
(3) a production Tripo house-lane job has completed. As of 2026-11-14 none of those is true:
the reply has not been sent, no `TRIPO*` variable exists on the service, and the paid lane ran
no jobs at all in the last 30 days. Sending or posting is the owner's step.

Written only from facts checked on 2026-11-14. Sources are in
[docs/partners/tripo.md](../../../docs/partners/tripo.md). Bracketed fields are for the owner
to fill from the pilot once it has run; leave a bracketed field out rather than guess it.

## Verified facts this post may use

| Fact | Source |
|---|---|
| three.ws runs Tripo's v3.1 model (`v3.1-20260211`) as a Forge lane on the v3 API with signed webhooks | `api/_providers/tripo.js`, `api/forge/webhook/tripo.js` |
| TripoSG runs self-hosted for sketch-to-3D and as the last photo failover rung; TripoSR is a rung in the free chain; TripoSplat runs self-hosted behind the image-to-splat lane since 2026-11-03. All three are MIT licensed | `workers/model-triposg`, `workers/model-triposr`, `workers/model-triposplat`, Tripo's repos |
| Last 30 days (to 2026-11-14): 490 TripoSG jobs finished and 95 failed; 0 Tripo API jobs | `forge_creations`, internal and seeder jobs excluded, read 2026-11-14 |
| Forge took 20,158 generation and rigging requests from makers in September and October 2026 (12,373 plus 7,785) | audited September figure in the [proof brief](../../../docs/partners/proof-brief-2026-10.md), October from `scripts/partner-proof-brief.mjs` (see the 2026-11-14 refresh in the Tripo brief) |
| MCP servers handled 25,446 tool calls in September and October (13,898 plus 11,548) | same two sources |
| Tripo API prices: text to 3D 10 to 20 credits, image to 3D 20 to 30, auto-rig 25, retarget 10 per animation, at USD 0.01 per credit | developers.tripo3d.ai, 2026-11-14 |

Do not use: Tripo's user or funding figures (press or Tripo's own claims, unverified), any
completion-rate or latency comparison between Tripo and other engines (no such data has been
produced), or any deal term (none agreed).

## Post draft

**Title:** Tripo is now a built-in engine in the three.ws Forge

Tripo already ran in four places inside three.ws: the v3.1 model as a Forge lane, TripoSG
behind our sketch-to-3D tool, TripoSR in the free photo-to-3D chain, and TripoSplat behind
image-to-splat. Until now the v3.1
lane only worked if you pasted your own Tripo API key.

[Today it is a built-in engine on the High tier, and you can pick it by name. No key needed;
it bills to your three.ws credits like our other engines.]

What you get:

- Text and image to 3D on Tripo's latest model, delivered through the v3 API with signed
  webhooks, so jobs finish the moment Tripo says they are done.
- [Auto-rigging with Tripo's rig endpoint: the output drives our universal retargeter, so any
  Tripo character can play the animation library.]
- The same engine through MCP, so agents in ChatGPT, Claude, Cursor and other clients can ask
  for a Tripo model in a single tool call.

We also keep running TripoSG, TripoSR and TripoSplat in production, and we are glad to
credit the Tripo research team for releasing all three under MIT.

[Pilot result, from the order 084 report: N jobs, completion rate X%, median time Y seconds.
Fill from `forge_creations` after the pilot; omit if the pilot has not produced it.]

Try it: [link to the Forge with the Tripo engine selected].

## Notes for Tripo's review

- Ask Tripo how they want the name written in the engine picker and in exports (call question
  5 in the brief) before publishing.
- Each bracketed sentence describes something that is true only after the key lands. If the
  key does not land, publish nothing.
