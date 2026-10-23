# Uthana partner or design-partner inquiry

Program: no application form. Uthana's site routes everything to `sales@uthana.com` through mailto links, including "Become a design partner" and "Custom dataset inquiry".
Page last read: 2026-10-23 (<https://uthana.com>; `https://www.uthana.com/partners` is a 404). Form fields: none exist. The partners page lists customer logos only (Unity AI, Replicate, Scenario, Sloyd and others) and describes no program terms.
Prospect context: score 12 in `docs/partners/prospects.md`; seed USD 4.3M (2025-03) and "45,000+ characters animated" are vendor claims from the 2026-10-09 sweep.
Nothing has been sent. Shared facts and owner-only inputs: [README.md](./README.md).

## Facts about their product (read today)

One GraphQL API for generating motion, extracting motion from video, retargeting and auto-rigging (docs at `/docs/api`); public Blender and Maya plugins. API access terms, keys and rate limits are not stated on the page. Pricing: **not verified on 2026-10-23** (the page links `/pricing` and shows none).

## The ask

Commercial motion data and a commercial motion lane behind our open-source one, and an integration listing. Our side of the value: we already run open text-to-motion and video-to-motion workers (`workers/model-text2motion`, `workers/model-video2motion`) and a universal retargeter, so Uthana motion would land on any humanoid rig we support.

Licensing note: the public animation library currently carries Mixamo-sourced clips and is under order 085 to move to CC0 and self-generated clips. A licensed Uthana set would help replace them, which is a real reason to ask. This is internal context; the message does not need to mention it.

## Drafted message (to `sales@uthana.com`, owner sends)

Subject: three.ws integration and motion data licensing

> Hello Uthana team. three.ws is an open-source platform for embodied 3D AI agents. Any humanoid avatar on the platform is driven by a clip library through our retargeter, and we run open text-to-motion and video-to-motion workers on our own GPUs. In the 31 days to 30 September 2026 people created 727 agents and 703 avatars on the platform. We would like to add Uthana as a commercial motion lane: licensed clips for the library and Uthana's text-to-motion and retarget APIs behind our open-source ones, with a visible "Powered by Uthana" label. Could you tell us your API access terms and licensing options for redistribution of clips inside an application? We can share usage numbers and a demo. Contact: support@three.ws.

## Owner steps

1. Send the message; add a tracker row (no Uthana row exists today).
2. When terms arrive, check whether clip redistribution inside an app is allowed before wiring anything.
3. Do not onboard a paid API without approval, per CLAUDE.md.
