# LiveKit Startups

Program: LiveKit Startups (credits). Companion to the plugin pull request in [../livekit-avatar-plugin.md](../livekit-avatar-plugin.md) (order 938); this file covers only the credits application.
Page last read: 2026-10-23 (<https://livekit.com/startups>). Launch date 2026-09-16 per `docs/partners/prospects.md`.
Tracker row: "LiveKit Agents avatar plugin" in `marketing/growth/opportunities.csv` (target 2026-10-30).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What it grants

Up to USD 23,000: USD 6,000 (one year of the Scale plan, fee waived), USD 10,000 extra LiveKit Cloud credits, USD 7,000 inference credits (USD 1,000 each from AssemblyAI, Deepgram, Fish Audio, Gemma, Gradium, Inworld, Rime). Credits expire 12 months after issuance. Approval yields a promo code entered at checkout; a card on file is required. A BAA needs a separate review.

## Deadline

None stated on the page.

## Eligibility against our facts

| Criterion (quoted from the page) | Status |
|---|---|
| Voice, video or physical AI is core | Met: embodied voice agents with a 3D body, `src/runtime/livekit-voice.js`, plugin `livekit-plugins-threews` |
| Fewer than 50 employees | Owner confirms |
| Under USD 5M raised and pre-Series A | Owner confirms; no funding is recorded in the repo |
| Live website with publicly identifiable founding team | Site is live; team page is owner input |
| Incorporated or actively incorporating | Owner input |
| In production or launching within 6 months | Met: production site, 7,111 finished models in Sep 2026 |
| Net-new projects preferred; teams "already running on LiveKit for a while, or with paying or contracted customers, may be declined" | **Risk.** We already ship a LiveKit voice integration (`api/agents/_id/livekit-token.js`). Say so plainly: the plugin and LiveKit Cloud use are new for the avatar slot, and no LiveKit contract exists. Do not hide existing usage |
| Not YC-backed through the YC offer | Owner confirms |

## Form fields

Only step 1 of 4 ("About you") was visible on 2026-10-23: First name, Last name, Work email, LinkedIn, Role (dropdown), all required. Steps 2 to 4: **not verified on 2026-10-23** (they sit behind the first step). Drafted answers for the likely company questions:

| Question | Draft answer |
|---|---|
| Company, URL | three.ws, `https://three.ws` |
| What are you building | An open-source platform where an AI agent has a 3D body. A visitor talks to the agent in a LiveKit room; the avatar lip-syncs and gestures on the visitor's own device from small data-channel messages, with no server-side video rendering. |
| How will you use LiveKit | `AgentSession` plus our `livekit-plugins-threews` `AvatarSession` for every public voice agent; the `<agent-3d voice="livekit">` element on the client. Verified end to end against a local open-source `livekit-server` with a real browser (order 087). |
| Why LiveKit | The avatar docs page lists only 2D video faces from server-side providers. Ours is the first client-rendered 3D body, following the pattern of the merged client-rendered avatar plugin (livekit/agents PR #5821, 2026-07-20). |
| Traction | Proof brief 2026-10 (31 days to 2026-09-30): 727 agents by 415 owners, 725 with a 3D body; 703 avatars; 412 signups; 7,613 distinct makers; npm 25,312 downloads across 106 `@three-ws` packages; 219 GitHub stars. |
| Funding stage, headcount, founders | Owner input |

## Owner steps

1. Open the plugin pull request first (order 938) so the application can link a real, reviewable contribution.
2. Apply at <https://livekit.com/startups>; complete steps 2 to 4 using the table above; update this file with the fields seen.
3. On approval, redeem the promo code on the Scale plan, wire LiveKit Cloud env vars through the credential playbook, and log the outcome in `opportunities.csv`.
