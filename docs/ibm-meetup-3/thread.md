# Back Inside the World Next Friday: Community Meetup on the $THREE Server, Sponsored by IBM Community

_Posted by the three.ws team. In August this group held its first meetup inside three.ws instead of on a video call. Next Friday, November 6, we do it again, with IBM Community sponsoring the session. This post covers how to join, the run of show, what has changed in the venue since August, and (for those who want the long read) the platform and technology behind it._

## The event

|  |  |
| --- | --- |
| **When** | Friday, November 6, 2026, 8:00 AM to 9:00 AM Pacific Time (11:00 AM to 12:00 PM Eastern, 16:00 to 17:00 UTC) |
| **Your time** | 8 AM San Francisco · 11 AM New York · 4 PM London · 5 PM Berlin · 9:30 PM Mumbai · midnight Singapore/Hong Kong (into Saturday) · 1 AM Saturday Tokyo |
| **Where** | [three.ws/play](https://three.ws/play), in the $THREE home town (pinned at the top of the world list). Countdown and add-to-calendar at [three.ws/event](https://three.ws/event). |
| **Cost** | Free |
| **What you need** | A modern browser. No download, no install, no account required. |
| **Early doors** | 7:45 AM PT. We will be at the spawn point getting first-timers walking and talking. |

US daylight saving time ends on November 1, so outside the US this lands an hour later on your clock than the August meetup did. The table already accounts for it.

## How to join, in three steps

1.  **Open [three.ws/play](https://three.ws/play)** at the event time and click the pinned $THREE world, or open [three.ws/event](https://three.ws/event) and use the button there.
2.  **Pick an avatar.** Guests get one automatically, but the better move is to build your own 3D AI agent beforehand at [three.ws/create](https://three.ws/create) from a text prompt or a selfie; it follows you into the world.
3.  **Walk up to people and talk.** Voice chat is spatial: you hear the people near you, from the direction they stand, and they fade as you walk away. Text chat works too.

## The run of show

The world runs the schedule this time: a countdown appears in the home town the day before, and each segment announces itself in the world when it starts.

| Time (PT) | Segment |
| --- | --- |
| 8:00 | **Doors open in the plaza.** Welcome from IBM Community and the team. |
| 8:06 | **One sentence to a rigged 3D agent.** A text prompt becomes a rigged, animated avatar in about a minute, then we wear it. |
| 8:14 | **Video to motion.** A phone clip becomes an animation (GLB, BVH or FBX) for any humanoid avatar. |
| 8:20 | **Forge into the world.** Type `/forge` and a sentence in chat; a generated 3D object lands in the world for everyone standing there. |
| 8:27 | **An agent pays for a tool.** At the Agent Exchange, an agent hits an HTTP 402, settles a micropayment, gets its answer, and leaves a receipt anyone can open. |
| 8:33 | **Community showcase.** Bring your avatars, embeds, MCP integrations and agents. |
| 8:43 | **Open Q&A and what ships next.** The skeptical questions are the most useful ones. |
| 8:55 | **Group photo at the totem,** then fireworks close the hour. |

Everyone in the world during the hour is granted the **Meetup Orbit Crown**, a free commemorative wearable that is never sold and never granted again after this session.

## What changed in the venue since August

-   **Events are part of the world now:** the countdown, an in-world agenda that knows what is on now and next, segment banners, a synchronized fireworks finale computed from a shared clock (no network traffic), and server-granted souvenirs.
-   **A better world to stand in:** a phone-sized world for phones, a photo mode that hands you the photo, a drivable car on every road, a lobby that shows which worlds people are actually in, and Coin Wars as a door inside your world.
-   **More to walk through:** the campus is a real place with real agents who talk back ([three.ws/?world=1](https://three.ws/?world=1)), The Grid is a room where every app is a live surface ([three.ws/?world=grid](https://three.ws/?world=grid)), and Flappin UFO is back at [three.ws/play/ufo](https://three.ws/play/ufo) with a verified leaderboard.

## About the venue, for newcomers

three.ws/play is Coin Communities: a persistent multiplayer 3D world that runs entirely in the browser. Every world is a real place, with terrain, buildings, NPCs, a day-night cycle, a working in-game economy, and the other people who are there with you. Three things make it a practical event venue:

-   **It is a URL.** No client, no launcher, no account wall. If you can open a web page, you can attend.
-   **Every world is a shareable link.** A community's world is `three.ws/play?coin=<mint>`. Post the link anywhere and everyone who clicks it lands in the same world, together. Links unfurl as a live preview of the world on platforms that read oEmbed.
-   **Worlds are persistent.** There is a collaborative, block-building layer saved server-side per world. What a community builds is still there tomorrow.

And it is not just our venue. **Every Solana token already has a world**, derived from its mint address. Any community that wants to hold its own meetup can do exactly what we are doing next Friday: take its mint, share the link, show up. Creators can optionally token-gate their world's Holders tier, verified server-side against real on-chain balances, while the general tier stays open. The event listing in this group's Events tab carries the full guide, including the URL parameters and APIs behind it.

## The platform behind the venue

/play is one surface of a larger platform. The short tour of what is live today:

### 1\. Creation: from words to 3D assets

-   **A free text-to-3D generator.** Describe anything and get a downloadable, textured 3D model in about a minute at [three.ws/create](https://three.ws/create). No key, no account.
-   **Selfie to 3D avatar** and **prompt to avatar**: one photo or one sentence becomes a rigged, animation-ready character.
-   **Universal rigging and animation.** Any humanoid GLB or VRM animates with the shared library of 2,800+ animations: a canonicalizer maps Mixamo, Avaturn, VRM/VRoid, Daz, MakeHuman, Unreal and other conventions onto one skeleton. The Rig Doctor tells you in seconds whether a model will animate, and why.
-   **[Video to Motion](https://three.ws/video-to-motion)**, new since August: any short video becomes a downloadable GLB, BVH or FBX animation.
-   **Provenance by default:** every generated and purchased model ships with a signed provenance credential, free.

### 2\. Distribution: creations go everywhere

-   **The `<agent-3d>` web component:** one script tag embeds a live, animated avatar in any website, with animations, moods and speech drivable from page code. New since August: one-paste embeds for WordPress, Framer and Webflow.
-   **A Discord Activity** brings a shared Forge room into any voice channel, and a three.ws avatar can be the lipsyncing face of a LiveKit Agents or Pipecat voice pipeline.
-   **oEmbed support:** world and creation links unfurl as interactive 3D embeds on WordPress, Ghost, Discord, dev.to and Notion.

### 3\. The agent economy

-   **x402 pay-per-call:** APIs charge per request in a dollar stablecoin, settled on-chain on Solana. An agent gets a 402 Payment Required, pays, retries, gets its answer. No API keys, no subscriptions.
-   A fabric of 1,000,000+ individually priced data endpoints, a unified service catalog, and buyer-side purchase receipts.
-   Agent-to-agent commerce with invoices and signed fulfillment records that feed reputation and pricing, owner-signed spend caps that verify offline, and a complete REST API for agents with signed webhooks.

### 4\. The developer platform

-   **93 published npm packages under `@three-ws`, 41 of them MCP servers:** 3D generation, avatars, scenes, spatial responses, market intel, payments and more, usable from Claude, Cursor, or any MCP-capable client.
-   Two are IBM-specific and belong in this community's toolbox: `@three-ws/ibm-watsonx-mcp` (watsonx.ai chat, generation, embeddings, tokenization and forecasting, on your own IBM Cloud account and credentials) and `@three-ws/ibm-x402-mcp` (IBM Granite tools exposed over MCP with per-call x402 billing). Both are community-built and open source; IBM does not operate them.
-   Docs with runnable samples, a cookbook, an examples gallery, and machine-readable surfaces (`openapi.json`, `llms.txt`, `.well-known/mcp.json`).

## The technology stack

-   **Frontend:** vanilla JavaScript modules with Vite, Three.js for rendering, Rapier (WebAssembly) physics, meshopt-compressed assets. No framework, which is what keeps pages fast and embeds lightweight.
-   **3D generation:** a GPU worker fleet on Google Cloud Run running open models for text-to-3D, image-to-3D, rigging, texturing, text-to-motion and video-to-motion. Every lane has a failover chain, and workers scale to zero when idle.
-   **Multiplayer:** an authoritative Colyseus server on Cloud Run. One room definition filtered by coin mint and access tier gives every community an isolated world on shared infrastructure: **100 players per room instance** with automatic spillover, 15 Hz binary delta sync (about 40 KB/s down per client in a completely full room), server-side validation on every message, and per-world persistence. The event souvenir is granted server-side from the same public config the countdown reads, once per account, only inside the window. Voice is a proximity-gated WebRTC mesh with positional audio; the server only relays signaling.
-   **Backend:** a single container on Cloud Run serves the static frontend and every API handler, with 151 scheduled jobs on Cloud Scheduler, Cloud Build deploys, a global load balancer and CDN, and Postgres.
-   **AI and chain:** Vertex AI (Gemini and Imagen) behind a multi-provider LLM failover chain, the same failover discipline on Solana RPC. Solana is the home chain; $THREE lives there and the x402 rail settles there.

## What we are building next

-   **Events any community can run without us.** The event layer this meetup uses (schedule, agenda, fireworks, souvenir), opened up so a community schedules its own session in its own world.
-   **Effortless first visits** on every device, so a first-timer is walking and talking in under a minute.
-   **Deeper agent autonomy:** more payable services, more MCP surface, better tooling for agents that earn and spend within limits their owners sign.
-   **Scale-out:** the room architecture already shards; cluster-aware matchmaking across machines is a configuration change on the current stack, planned for when sustained concurrency demands it.

## See you next Friday

**Friday, November 6, 8 AM PT / 11 AM ET (4 PM London, 5 PM Berlin), on the $THREE server at [three.ws/play](https://three.ws/play).** Show up as an avatar, watch the live builds, demo what you have made, and ask us anything. Details on this group's Events tab; a countdown and calendar file at [three.ws/event](https://three.ws/event).

Thank you to IBM Community for sponsoring the session. three.ws is an IBM Business Partner; IBM does not endorse three.ws, and three.ws is not an IBM product.

## Links

-   The venue: [three.ws/play](https://three.ws/play) · countdown: [three.ws/event](https://three.ws/event)
-   Free text-to-3D: [three.ws/create](https://three.ws/create)
-   Video to Motion: [three.ws/video-to-motion](https://three.ws/video-to-motion)
-   Live economy reference: [three.ws/play/economy](https://three.ws/play/economy)
-   Docs: [three.ws/docs](https://three.ws/docs)
-   Blog: [three.ws/blog](https://three.ws/blog) · Changelog: [three.ws/changelog](https://three.ws/changelog)
-   GitHub: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws)
-   X: [@trythreews](https://x.com/trythreews)
-   How the first meetup went: [three.ws/blog/ibm-user-group-first-in-world-meetup-recap](https://three.ws/blog/ibm-user-group-first-in-world-meetup-recap)

_Questions, skepticism, and feature requests all welcome below. The skeptical ones are the most useful._
