# Grok showcase and tools: demos worth filming, tools worth giving away

Second research pass, 2026-11-26. The first pass, [grok-ecosystem-opportunities.md](grok-ecosystem-opportunities.md), ranked the strategic moves (Grok on Vertex, phone numbers for agents, the forge critic loop, cited X token intel, the research council, the plugin marketplace). This pass goes after three other things:

- **Showcase demos** that make someone stop scrolling, and that only a platform with 3D, agents and Solana can make.
- **Tools for other ecosystems:** free, useful things for xAI developers, Grok and X users, three.js developers, Solana builders and creators, which bring their users to us.
- **Daily features** that give our own users a reason to come back.

Three research passes fed it. One mapped 55 existing three.ws building blocks with file paths and combined them. One collected the demos that spread in 2025 and 2026 across every model provider. One mined GitHub issues, forums and npm for evidenced unmet needs. Numbers marked as verified were read from `gh api` or the npm download API on 2026-11-26; everything else is marked.

Nothing here repeats the first pass. Where an idea builds on one of its items, it says so.

## The insight: four shared engines unlock almost everything

Most of the 60-plus ideas collected reduce to the same four engines. Build these once, then each demo is a thin page on top.

1. **Scene-to-clip.** Any three.js scene (an anatomy cutaway, an avatar doing a move, a diorama) rendered server-side into a 10 to 15 second MP4 plus a share card. This is half built: [api/_lib/render-clip.js](../api/_lib/render-clip.js) already boots headless Chromium and renders a GLB with a pose and camera orbit to PNG, and [api/_lib/x-content/reel.js](../api/_lib/x-content/reel.js) already films live product runs. What is missing is a camera-path timeline and frame-sequence encoding. Every X-native idea below needs it, because a video reply spreads where a text reply does not.
2. **Verified spec writer.** Grok structured outputs write a strict JSON spec (anatomy, diorama, garment, CAD, workflow graph), then Grok code execution checks the numbers before anything renders: balances conserve, gears mesh, parts fit. The anatomy writer ([api/_lib/anatomy/writer.js](../api/_lib/anatomy/writer.js)) and the diorama schema ([src/diorama/schema.js](../src/diorama/schema.js)) are the first two targets. The check step is what turns "AI made a picture" into "AI made a correct picture", which is the credibility point for every education and crypto demo.
3. **Face for Grok Voice.** One package that takes a Grok realtime voice stream and drives an `<agent-3d>`: visemes, mood and gestures from the speech-tag stream, barge-in from a local VAD. We use it everywhere internally, and we publish it for the outside ecosystem (see tool 1). Base: [api/_lib/grok-voice.js](../api/_lib/grok-voice.js).
4. **3D-to-reference renderer.** Turn any avatar or GLB into a consistent reference sheet (front, three-quarter, profile, expressions, props) for Grok Imagine's reference-to-video, which takes up to 14 references on `grok-imagine-video-1.5` (docs.x.ai, reference-to-video). Our 3D assets give pixel-consistent references that hand-drawn sheets cannot, and they fix Imagine's best-known weakness: the character drifting between clips. Same headless renderer as engine 1.

Sequenced this way, engines 1 and 2 ship the first two flagship demos, engine 3 ships the first outside tool, and engine 4 ships the Imagine work.

## Flagship showcase demos

These are the ones to film. Each is shareable by link, renders a clip, and is something no single-modality competitor can do.

### 1. Zoom to the atom

- **What:** ask any "does X ever really Y" or "what is inside Z" question. You get one continuous camera zoom from the everyday scale down through the layers (skin, cell, protein, atom; or car, engine, piston, crystal lattice), each layer labeled and narrated by an avatar, ending in a 12-second clip and a link.
- **Why this shape:** a Claude-built "do fingers ever touch" zoom took "millions of views" on X in November 2026 (dexerto.com, 2026-11-10; exact count not published). It is one question, one continuous shot, a debate-bait caption. That is our anatomy product with a camera path added.
- **Grok part:** structured outputs write the layer stack; code execution checks the scale numbers (each layer's real size, so the zoom is honest); `web_search` cites the science; Grok voice narrates.
- **Builds on:** anatomy runtime ([src/anatomy/runtime.js](../src/anatomy/runtime.js)), engines 1 and 2.
- **Effort:** M.

### 2. Tx Anatomy: any Solana transaction as a machine

- **What:** paste a transaction signature. Programs become machine blocks, accounts become chambers, token flows become pipes with shader fluid, and an avatar narrates what happened. Famous exploits and whale swaps get a cutaway people post with "here is how that exploit actually worked".
- **Grok part:** structured outputs map parsed instructions into an anatomy spec; code execution recomputes every balance change so no pipe shows a number that does not conserve; `x_search` over the date window pulls cited context ("what people said when this landed").
- **Builds on:** anatomy cutaways, Solana RPC ([api/solana-rpc.js](../api/solana-rpc.js)), engines 1 and 2. A bonding-curve variant uses [api/pump/curve.js](../api/pump/curve.js).
- **Why it is ours:** Solana-native, visual, read-only, and only possible with a cutaway engine. Token and account names are untrusted data and never drive anything.
- **Effort:** M. New: a transaction-to-spec mapper, part libraries for the common programs, a `/tx/:sig` page and share card.

### 3. Speak a machine into existence

- **What:** talk to the tutor: "how does a mechanical watch work... slow it down... take out the mainspring". The cutaway builds and changes live while the avatar explains, and you can interrupt at any point.
- **Grok part:** Grok voice realtime with function calls (`build_anatomy`, `set_exploded`, `cut_section`, `focus_part`), structured outputs for spec patches, vision when you hold up a photo.
- **Builds on:** [src/anatomy/stream.js](../src/anatomy/stream.js) (incremental build), the tutor ([api/tutor/session.js](../api/tutor/session.js)), engine 3.
- **Why film it:** the strongest single demo clip in this document for the Grok Voice audience. It shows voice, tools and 3D working together in one take.
- **Effort:** M.

### 4. Your agent, on-model, in any Imagine template

- **What:** a template gallery (a dance, a reaction, a walk-on, a product unboxing). Your rigged avatar performs the move in three.js, and Grok Imagine uses those frames as first frame and references to produce a polished clip that stays on-model every time.
- **Why this shape:** Imagine templates spread through one-tap remixing (the "Soda Pop dance" template promoted in January 2026), and X Creators ran a prize contest for Imagine videos in February 2026 (reported; prize amounts from press). The weakness everyone hits is character drift; deterministic 3D motion solves it.
- **Builds on:** engine 4, motion library ([src/motion-swap.js](../src/motion-swap.js)), [api/_lib/clip-director.js](../api/_lib/clip-director.js).
- **Effort:** M. Imagine generation spends xAI credits.

### 5. Timeline City: a year on X as a 3D city

- **What:** enter a public handle. Its year becomes a diorama: districts per theme, building height per engagement, a landmark for each big post, and an avatar mayor giving the tour. "X Wrapped, in 3D."
- **Grok part:** `x_search` with a handle filter and monthly date windows is the only legitimate data path; structured outputs cluster themes; code execution computes stats.
- **Builds on:** Diorama ([src/diorama/schema.js](../src/diorama/schema.js)), wrapped share cards ([api/wrapped-share.js](../api/wrapped-share.js)).
- **Guardrails:** public posts only, an opt-out list, topic statistics only, no inferences about the person.
- **Effort:** M.

### 6. Agent Town: the agent economy as a spectator sport

- **What:** a 3D town where marketplace agents live. When one hires another over x402, you see the avatars walk over, hand off, and the receipt float up. Spectators watch a live economy.
- **Why this shape:** a16z-infra/ai-town (10,865 stars, verified, still pushed 2026-11-25) proved people love watching agents live together. None of those towns have real payments. Ours would, and every payment is a visible moment.
- **Builds on:** `/play` world ([pages/play.html](../pages/play.html)), agent hiring ([api/agent-delegate.js](../api/agent-delegate.js)), x402 receipts. Real hiring and payments stay owner-gated; the town only renders what already happened.
- **Effort:** L.

### 7. Prompt to a playable game starring your agent

- **What:** one sentence ("heist in a neon laundromat") becomes a diorama built from catalog and forged assets, win and fail rules, voiced NPCs, and your avatar as the playable character. A link anyone can play.
- **Why this shape:** one-prompt three.js games were the most shared model demos of 2026 (press coverage of Claude Opus 5 and Gemini 3 AI Studio showcases; no per-demo view counts). Starring your own character makes it personal.
- **Grok part:** structured outputs against the diorama and game-rules schemas ([src/diorama/game-rules.js](../src/diorama/game-rules.js)); a vision pass checks the layout is reachable; voice for NPC lines.
- **Effort:** M.

## Tools for other ecosystems

These are free or nearly free tools that put three.ws inside someone else's workflow. Ranked by evidence of demand, then fit.

### 1. A face for any Grok voice agent (`grok-voice-avatar`)

- **Evidence:** `@livekit/agents-plugin-xai` gets 201,835 downloads a week (verified), so Grok voice agents are being built at volume, and none of the frameworks around it have a visual avatar layer. On the Cursor forum, xAI staff confirmed in October 2026 that Grok Bot has no public API for companion apps; developers are hacking around it with Windows UI Automation (forum.cursor.com thread 170985).
- **Tool:** an npm package and web component built on engine 3. Feed it Grok realtime audio and the speech-tag stream; it drives an `<agent-3d>`. Ship templates for LiveKit Agents, Pipecat and a plain browser page, plus a SIP template that pairs with the first pass's phone-number item.
- **Why it brings users:** every developer who uses it gets a three.ws avatar by default and an upgrade path to a custom one.
- **Effort:** S to M.

### 2. Imagine character kit (`character_to_clip`)

- **Evidence:** at least six community MCP servers and CLIs wrap Grok Imagine (for example `grok-imagine-video-mcp-server`); none build reference sheets from 3D (agent's survey, unverified for every wrapper). The docs themselves advise a small cast with one role per reference image.
- **Tool:** an MCP tool and web page on engine 4: give it an avatar, a GLB or a single image (forged to 3D first), get a reference sheet, then consistent Imagine clips and an animated sticker pack. Works in the Grok connector, Claude, and any MCP client.
- **Effort:** S once engine 4 exists.

### 3. Retarget Doctor and VRM Doctor

- **Evidence:** pixiv/three-vrm issue 1176, "Loading Mixamo animation rotates the legs by 90deg", has 10 comments (verified), and `@pixiv/three-vrm` gets 242,003 downloads a week (verified). Retargeting threads recur on the three.js forum. VRoid and VTuber users pay for blendshape and spring-bone fixes on freelance marketplaces (listings, not counted).
- **Tool:** a free web tool and npm package. Drop any GLB or VRM plus any clip set; it maps bones with our canonicalizer ([src/glb-canonicalize.js](../src/glb-canonicalize.js)), fixes the leg and twist problems, checks VRM 0.x vs 1.0, adds ARKit blendshapes, and exports clean files. Grok vision rates the result from rendered frames and explains what changed.
- **Effort:** S. Plain code does most of the work; we already own the mapping.

### 4. Ready Player Me migration kit

- **Evidence:** Ready Player Me's public platform shut down on 2026-01-31; Avatar SDK and others publish migration guides, and developers wrote up rebuilds (dev.to). The size of the affected developer base comes from vendor commentary and is unverified.
- **Tool:** a drop-in endpoint (selfie or text to rigged GLB) plus an `<agent-3d>` loader that accepts old Ready Player Me GLBs unchanged. Grok vision turns a selfie into a style spec. Builds on avatar reconstruction ([workers/avatar-reconstruction](../workers/avatar-reconstruction)).
- **Effort:** M. A motivated, displaced audience.

### 5. A three.js scene MCP, and a public Grok score on 3JSBench

- **Evidence:** ahujasid/blender-mcp has 35,913 stars: people want models driving real 3D tools with screenshot feedback. The browser equivalent barely exists (one devtools MCP at 136 stars). A community benchmark for LLM-written three.js objects, 3JSBench, was posted on the three.js forum. The most-reacted open three.js issue found was the TSL roadmap (22 reactions, verified).
- **Tool:** extend [packages/scene-mcp](../packages/scene-mcp) so any MCP client (Grok first) can inspect a live `<agent-3d>` scene, set materials, move the camera, take a screenshot and fix its own work. Then run and publish a Grok entry on 3JSBench: cheap credibility with the three.js community.
- **Effort:** S to M.

### 6. A maintained Solana tools MCP

- **Evidence:** sendaifun/solana-agent-kit has 98 open issues and no push since 2026-05-14 (verified), 954 npm downloads a week (verified), and an open issue that its MCP adapter advertises optional parameters as required. Agent identity issues there have 31 comments. Solana's own agent guide needs a third-party RPC key to start.
- **Tool:** a keyless, schema-correct Solana read MCP: balances, token snapshot, safety checks, transaction explain (reuses Tx Anatomy's mapper), agent identity lookup. Read-only by design, so it never touches the spend gate. Solana first.
- **Effort:** M. Naming other projects in committed docs or code needs the owner's approval.

### 7. Anatomy for classrooms

- **Evidence:** demand inferred from research prototypes (teachers must source 3D models themselves) and educator pricing at 3D tool vendors; no teacher survey found.
- **Tool:** "explain how X works" from the Grok connector or Claude returns an embeddable cutaway with a five-question quiz, sized for Google Classroom, LMS pages and slides. Grok voice reads it aloud for younger students.
- **Effort:** S. The anatomy engine and its MCP path already exist.

### 8. `grok-plugin-doctor`

- **Evidence:** xai-org/plugin-marketplace has 1,498 open issues (verified), mostly plugin submissions, plus recurring Windows, ARM and MCP OAuth bugs.
- **Tool:** a free CLI that lints a plugin manifest, its MCP tool schemas (the optional-as-required bug), OAuth flows and Windows spawn paths, and writes a pass report submitters attach to their PR. We run hosted MCP servers in production, so we know these failure modes.
- **Why:** goodwill with the xAI team and every plugin author; little direct revenue. Effort S to M.

## Daily features for our own users

Smaller, faster, and aimed at retention.

- **Companion mode, owned and portable.** Grok's own animated companions (July 2025) drew huge attention (view counts reported by press, unverified), and moeru-ai/airi has 51,824 stars as a self-hosted companion. We add what neither has: the character is yours, carries a wallet, embeds anywhere, remembers you, and earns from its skills. Keep it SFW as the brand position. Builds on engine 3 and agent memory ([api/agent-memory.js](../api/agent-memory.js)).
- **Casting Director.** Every forged character is born with a name, persona, a picked voice and a three-line voiced intro card. Grok vision looks at the model and writes the persona; Grok TTS speaks it. Effort S, and it lands at the moment of creation, when users decide whether to come back.
- **Steal the Move.** Paste an X post with a dance or sports clip. Grok video understanding names the move and picks the usable segment; video-to-motion ([src/video-to-motion.js](../src/video-to-motion.js)) extracts it and retargets to your rig. A weekly "Move of the Week" picks trending clips with `x_search`. Personal use; posting is gated.
- **Imagine to Motion.** Prompt a movement, Imagine renders it from your avatar's references, video-to-motion turns it into a reusable animation clip. A/B it against the existing text-to-motion worker and promote only if it wins.
- **Say and point.** In Scene Studio, click an object and say "make this brass and move it left". Voice tool calls plus a screenshot and object-id buffer. Base: [src/scene-studio/agent-tab.js](../src/scene-studio/agent-tab.js).
- **Stage reads the room.** A Living Stage host ([api/stage/host.js](../api/stage/host.js)) reacts live to what X is saying about an event, quoting real posts with attribution over a five-minute rolling `x_search` window. Tips stay gated.
- **Daily Forge with trending themes and Grok judges.** The daily theme comes from X trends; three judge personas score entries with written reasons beside community votes. Base: [api/forge-off](../api/forge-off).
- **Docs World you can talk to.** Ask aloud and the camera flies to the right room in [pages/docs-world.html](../pages/docs-world.html), with a cited answer from a Collection of our docs.
- **Sign Bridge.** Speech to a signing avatar timed by Grok STT word timestamps, and webcam signing to Grok TTS. Honest accuracy labels: recognition is alphabet-level today. Base: [packages/sign-language](../packages/sign-language). Strong press and accessibility story.
- **Fix-It Parts.** Photograph a broken clip or knob, give one measurement, get a printable parametric part with clearances checked by code execution and thread tables from a Collection. Base: CAD Forge ([api/cad.js](../api/cad.js)). Print orders gated.

## Crypto research with receipts (Solana first)

Read-only, cited, and measured. Each extends the first pass's X token intel rather than repeating it.

- **Narrative Backtest.** Batch-label the 660k-article crypto archive ([api/news/archive.js](../api/news/archive.js)) by narrative, stance and ticker, then measure forward returns per narrative with code execution. Publish the result as a research page with a per-narrative track record. Batch jobs stay tool-free (see the first pass's Batch caveat).
- **Grok Verify, crypto edition.** Grok's own "is this true?" answers on X are inconsistent and rarely cited (Maldita.es analysis of 2026 World Cup answers, reported; Indicator.media tracks it). Ours starts where we have unique data: a claim or post URL is checked against the archive back to 2017, live headlines and `x_search`, returning stance plus quoted sources, cached per claim so the same question gets the same answer.
- **Logo clone detector.** A launch's logo and claimed X handle are checked for impersonation: vision compares the logo to known marks found by `web_search`, `x_search` checks the account's age and who vouches for it. A badge and a one-line reason on launch pages. Image-based, so distinct from the text intel in the first pass.
- **Forecaster League.** Models forecast open Event Markets in shadow mode, with citations; a public Brier-score board answers "which model forecasts best on live events". Base: [api/oracle/calibration.js](../api/oracle/calibration.js). Staking and payouts gated.
- **Rule-Keeper.** Upload your own trading rules; every paper trade ([api/papertrade.js](../api/papertrade.js)) is checked against them and the avatar debriefs, citing the exact rule. Paper only.

## The X-native loop (tag to get it)

For what renders in the feed itself (video replies, Blinks, polls, Community Notes), with verified X API prices, see [x-timeline-ideas.md](x-timeline-ideas.md).


Design for explicit tags only: replying when asked, never unsolicited keyword replies. All replies render through engine 1, because a clip spreads where text does not. Until the owner turns posting on, every reply is a draft for approval through the existing mention bot ([api/x/mention-bot](../api/x/mention-bot)).

- `cutaway <thing>`: a 10-second looping cutaway clip plus a link.
- `make this 3D` on a post with a photo: a forged GLB and a turntable clip.
- `explain this chart`: Grok vision reads the chart; the avatar narrates in a short voiced clip.
- `unroll as 3D`: a thread becomes a scrollable three.js story page.
- `explain this tx` with a signature: Tx Anatomy's clip.

The first pass's Grok Bot entry ("@bot, make this 3D") covers users who installed our connector; this loop covers everyone else on X.

## Suggested order

1. **Engine 1 (scene-to-clip)** and **engine 2 (verified spec writer)**, then **Zoom to the atom** and **Tx Anatomy** as the first two filmed demos. They reuse the anatomy engine end to end.
2. **Engine 3** and **tool 1 (`grok-voice-avatar`)**, then **Speak a machine into existence** as the voice demo, and companion mode.
3. **Engine 4**, then **tool 2 (Imagine character kit)**, the **Imagine templates** demo and Casting Director.
4. The low-effort outside tools in parallel at any point: Retarget and VRM Doctor, anatomy for classrooms, scene MCP plus 3JSBench.
5. The X-native loop once engine 1 exists; posting stays an owner switch.

## Gated items

Owner yes every time: any X posting or reply (the X loop, Move of the Week, trend themes), Imagine and voice spend once the key is live, staking or payouts (Forecaster League, Event Markets), real trades (Rule-Keeper stays paper), print orders (Fix-It Parts), tips (Stage), and real hiring and payments in Agent Town. Everything else is read-only or draft-only.

## Claims to re-check before public use

- View and visit counts for the "fingers" zoom, Grok companions and Grok Imagine came from press or secondary sources.
- Imagine contest prize amounts and template dates are from press.
- Grok Verify's accuracy figures are from press reports of the Maldita.es study, not the study itself.
- The Ready Player Me affected-developer count is vendor commentary.
- The count and coverage of community Imagine wrappers is the researcher's survey, not exhaustive.
- Verified on 2026-11-26: every GitHub star count, issue count and npm download figure given above as verified.
