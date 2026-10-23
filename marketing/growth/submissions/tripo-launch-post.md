# Tripo x three.ws joint launch post: DRAFT FOR THE OWNER

**Status: draft only. Not sent, not agreed with Tripo.** Do not publish until (1) Tripo has
replied and agreed to co-market, (2) `TRIPO_API_KEY` is on the `three-ws-api` service, and
(3) a production Tripo house-lane job has completed. As of 2026-10-23 none of those is true:
no `TRIPO*` variable exists on the service, and the only paid-lane jobs in the last 30 days
were 2 finished jobs on users' own keys. Sending or posting is the owner's step.

Written only from facts checked on 2026-10-23. Sources are in
[docs/partners/tripo.md](../../../docs/partners/tripo.md). Bracketed fields are for the owner
to fill from the pilot once it has run; leave a bracketed field out rather than guess it.

## Verified facts this post may use

| Fact | Source |
|---|---|
| three.ws runs Tripo's v3.1 model (`v3.1-20260211`) as a Forge lane on the v3 API with signed webhooks | `api/_providers/tripo.js`, `api/forge/webhook/tripo.js` |
| TripoSG runs self-hosted for sketch-to-3D and as the last photo failover rung; TripoSR is a rung in the free chain. Both are MIT licensed | `workers/model-triposg`, `workers/model-triposr`, Tripo's repos |
| Last 30 days: 134 TripoSG jobs finished and 92 failed; 2 Tripo API jobs, both finished | `forge_creations`, internal jobs excluded, read 2026-10-23 |
| Forge took 12,373 generation and rigging requests in September 2026 | audited figure, [proof brief](../../../docs/partners/proof-brief-2026-10.md) |
| MCP servers handled 13,898 tool calls in September at 99.4% handler success from 13 distinct clients | proof brief |
| Tripo API prices: text to 3D 10 to 20 credits, image to 3D 20 to 30, auto-rig 25, retarget 10 per animation, at USD 0.01 per credit | developers.tripo3d.ai, 2026-10-23 |

Do not use: Tripo's user or funding figures (press or Tripo's own claims, unverified), any
completion-rate or latency comparison between Tripo and other engines (no such data has been
produced), or any deal term (none agreed).

## Post draft

**Title:** Tripo is now a built-in engine in the three.ws Forge

Tripo already ran in three places inside three.ws: the v3.1 model as a Forge lane, TripoSG
behind our sketch-to-3D tool, and TripoSR in the free photo-to-3D chain. Until now the v3.1
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

We also keep running TripoSG and TripoSR in production, and we are glad to credit the Tripo
research team for releasing both under MIT.

[Pilot result, from the order 084 report: N jobs, completion rate X%, median time Y seconds.
Fill from `forge_creations` after the pilot; omit if the pilot has not produced it.]

Try it: [link to the Forge with the Tripo engine selected].

## Notes for Tripo's review

- Ask Tripo how they want the name written in the engine picker and in exports (call question
  5 in the brief) before publishing.
- Each bracketed sentence describes something that is true only after the key lands. If the
  key does not land, publish nothing.
