# Everything three.ws can offer an IBM Community event

A working inventory for planning events with the
[Three.ws User Group on IBM Community](https://community.ibm.com/community/user/usergroup?CommunityKey=e71510cc-d953-408f-9a1c-019f5c0a7016).
It answers one question: across the whole platform, what do we actually have that an IBM
audience would show up for, and which of it works today.

It sits beside two existing documents and does not replace them:

- [ibm-next-event.md](./ibm-next-event.md) argues for one headline format (the Forge-Off Open)
  and carries a 12-idea bank.
- [marketing/growth/events/ibm-event-two.md](../marketing/growth/events/ibm-event-two.md) is
  the paste-ready kit for a one-hour in-world session, and
  [three-world-session.md](../marketing/growth/events/three-world-session.md) is the monthly
  template.

Every status below was checked against the code or the live site on 2026-09-18. Anything
IBM-facing that comes out of this document is read against [ibm.md](./ibm.md) and
[badge-usage.md](../marketing/ibm-partner-plus/badge-usage.md) before it ships.

---

## 1. Where we stand today

| Fact | State | Why it matters |
| --- | --- | --- |
| Meetup #2 is already configured | `public/event.json` holds "$THREE Community Meetup #2", Friday 2026-09-25, 16:00 to 17:00 UTC, souvenir `star-shades-meetup-2`. Committed in `0e184e441`, passes `npm run check:event`. **Not deployed**: the live `/event.json` still answers the no-event state | The date exists in the repo and nowhere else. IBM Community shows 0 upcoming events, and T-7 is today |
| The first meetup | 2026-08-07, nine hours inside `/play`, peak 3,145 concurrent avatars in the open world | The format is proven and the audience is mostly the open world, not the 18 group members |
| Group size | 18 members, 7 blogs, 8 threads, 2 past events | Small. Events should recruit into the group, not assume it |
| Granite Guardian is serving in production; the watsonx.ai lane is not | Measured 2026-11-13: the self-hosted worker `granite-guardian` (europe-west4, one L4, revision `granite-guardian-00001-gtw`, ibm-granite/granite-guardian-3.3-8b on vLLM v0.29.0) is live and wired to `three-ws-api` through `GRANITE_GUARDIAN_URL` (revision `three-ws-api-00534-q8p`). `POST /api/guardian/assess` returns 200: a benign greeting comes back `allow` (top risk jailbreak p=0.0001), a jailbreak plus SOL-drain prompt comes back `block` (jailbreak p=0.9998), every score a real logprob from `provider: self-hosted`. `node scripts/verify-granite-guardian.mjs --require-live` passes, `/api/agents/identity-check` answers `configured: true`, and `/api/healthz` reports `granite_guardian` `ok`. Still dark: `/api/ibm/galaxy` answers `watsonx_not_configured`, because embeddings, Vision, TimeSeries and Orchestrate need the hosted watsonx.ai pair (`WATSONX_API_KEY`, `WATSONX_PROJECT_ID`) | Granite claims are now true for governance (Guardian verdicts, the identity screen, the spend cap). Claims about the galaxy, Vision, the twin or Orchestrate stay off until watsonx.ai is set (section 6) |
| One room holds 100 people | `WALK_ROOM_MAX_CLIENTS` defaults to 100 and is not set on the live service. Past the cap, new joiners land silently in a parallel copy of the world | A crowd above 100 does not see itself as one crowd. Host announcements still reach every copy |
| Moderation | Slur gate and rate limits, plus operator mute, kick and ban (`node scripts/moderate-play.mjs`) and in-world player reports that auto-mute at three distinct reporters | Name a moderator and rehearse the runbook in [LIVE-OPS.md](./event-readiness/LIVE-OPS.md#moderation) |
| In-world stage | `StageRoom`, the show director and `/stage` all work. The plaza landmark `src/game/plaza-stage.js` is never imported by the world, and the show module it lazy-loads does not exist | Living Stage shows run at `/stage` today, not inside `/play`. The event-two kit's tour beat that points at a Plaza Stage marquee will find nothing |
| Host broadcast | `node scripts/announce-play.mjs` raises a banner in every live room, HMAC-signed | This is the host microphone that exists |
| Post-event numbers | Nothing records peak concurrency. `/api/play/population` is instantaneous | Leave `npm run event:watch -- --interval 15` running and keep its output, or the recap has no number |

---

## 2. What we can offer, by who is in the room

IBM Community is not one audience. Each group below gets a different hour.

### Non-technical members (the largest untapped group)

Everything here needs no account and finishes in under five minutes.

| Surface | What they do | Event use |
| --- | --- | --- |
| `/forge`, `/create/prompt` | One sentence becomes a textured model or a rigged avatar | The opening "make one with me" beat |
| `/create/selfie`, `/avatar-studio` | One selfie, or a from-scratch builder for the camera-shy | Everyone arrives as themselves |
| `/daily` | A new creative challenge every day with a streak, no sign-up | The retention layer under any event |
| `/ar`, `/ar/view` | Prompt to model to the table in front of you, QR handoff from desktop | One QR on screen, the whole audience places the same object |
| `/portal` | Paste a web address and walk through the site in 3D | Walk through a site the audience names |
| `/diorama` | Describe a scene and walk around inside it | Audience-directed world building |
| `/holo` | A procedural holographic sticker with your own text, downloadable | The 60-second event badge |
| `/walkthroughs/build-your-first-agent` | Five guided steps to a named agent, before sign-in | The safest guided group exercise we have |
| `/timeline`, `/tour`, `/pitch` | Company history as a walkable scene, a narrated site tour, a slide deck with a live avatar in it | Replaces every slide a host would otherwise make |

### Developers

| Surface | What they do | Event use |
| --- | --- | --- |
| Free 3D Studio MCP (`/docs/mcp-studio`) | No-auth server: connect Claude, ChatGPT or Cursor and generate, rig and edit models from chat | The best hands-on lab we have: two minutes to connect, works on any laptop |
| `npm create @three-ws/agent` | One command, one sentence, a rigged character and a demo page. No key, no account | The whole room types the same command |
| `/3d` and `/docs/3d-api` | Keyless text-to-3D and glTF validation over plain HTTP with live OpenAPI | `curl` from the audience |
| `<agent-3d>` and `/studio` | Web component plus a no-code snippet builder | Everyone leaves with a working embed |
| `/cookbook` | Runnable recipes: text-to-3D CLI, parallel asset packs, an MCP 3D tool, a self-correcting generation loop, a CI quality gate | One recipe per breakout |
| `/embed-doctor`, `/inspect`, `/rig-doctor`, `/diff` | In-browser diagnostics, nothing uploaded | A live clinic on attendees' own files and pages |
| `/tty` | `curl three.ws/tty` and a rigged agent walks in the terminal | The one-liner that gets a room typing |
| `/spatial-mcp` | An open, CC0 standard for returning a live 3D scene as an MCP tool result | A standards talk, and an invitation for others to implement it |
| `@three-ws/ibm-watsonx-mcp` | Five watsonx.ai tools on the caller's own IBM Cloud key | **Works today**, because the attendee brings the credentials. The right IBM-specific lab while our own keys are absent |
| `@three-ws/ibm-x402-mcp`, `/api/ibm-mcp` | Granite chat, code, embeddings, document analysis and forecasting, paid per call, no IBM account | Needs our watsonx credentials restored |

### Enterprise, governance and risk people

This is IBM's home audience and the one we have shown the least.

| Surface | What it shows | Event use |
| --- | --- | --- |
| `/ledger` | Every consequential agent decision, its reasoning, its prediction and the outcome, tamper-evident and independently verifiable | The auditability centerpiece |
| `/autopilot-activity` | Every autonomous action, the memory that motivated it, signed and reversible | Explainable autonomy, shown rather than claimed |
| `/payments`, `/pay/simulator` | Budget-limited sessions with spend caps, allowlists and expiry; dry-run a spend policy against real prices with no money moving | "Give an agent a budget, not a key", demonstrated safely |
| `/docs/agent-runtime` | The seven-layer policy engine that preflights every fund-moving tool call | The security architecture talk |
| `/docs/mcp-safety`, `/api/mcp-policy` | What each tool's safety annotation means, and a ready-to-paste allowlist in three profiles | The answer to "can my IT team approve this" |
| `/guardian` | Threshold-approved, time-locked wallet recovery that never exposes a key | Continuity and key management |
| `/brownout`, `/status`, `/guards` | Every fallback proven by breaking its upstream inside the real request path; 90-day uptime; a repo with no CI held correct by local guards | A reliability engineering session that is genuinely unusual |
| `/smart-home` and its privacy pages | An agent that runs a real house and stops to ask before it unlocks, opens or disarms anything; role scopes; data that is never stored | Physical-world consent, the subject of the governance post published to the group on 2026-09-18 |
| `/api/guardian/assess`, `@three-ws/guardian` | Granite Guardian verdicts plus a hash-chained audit ledger and per-period spend caps | The IBM-native governance demo. Live since 2026-11-13 on the self-hosted Guardian lane |
| `/agent-identities`, `/pill` | A brand brief becomes a rigged mascot with studio renders; the write-up of rigging a flat logo into a 52-bone character | "We can rig your mascot", made concrete |
| `/concierge`, `/assistant`, `/herald`, `/glance` | One-tag site concierge, floating assistant, a character that announces events with an accessible fallback, an agent card on the Windows widgets board or in Slack | The embeds-on-your-site commercial track |
| 85 locales | The site UI is translated and swapped at runtime | A global community can attend in its own language |

### Accessibility and education

| Surface | What it does | Event use |
| --- | --- | --- |
| `/sign-language` | Avatars fingerspell any word, sign chat replies, and read your fingerspelling back by webcam | The flagship accessibility demo |
| `/sign-mirror` | The avatar forms a letter, the camera grades your handshape and names the finger that is off. On-device, no video uploaded | A group drill with a clean privacy story |
| `/asl-alphabet` | Every letter, the look-alikes, and a reading drill | Five-minute learning exercise |
| `/docs/stage` | Living Stage shows carry live captions and late joiners sync | A captioned Q&A format |
| `/glossary`, `/what-is` | Plain-English definitions and introduction | The handout for people new to all of this |

### Camera, microphone and body demos (the "how is that a browser" moments)

| Surface | What happens |
| --- | --- |
| `/sonar` | Hand gestures steer an avatar with no camera, using an inaudible tone and the microphone |
| `/mocap-studio` | Live webcam facial capture onto an avatar |
| `/lipsync/mic` | The avatar's mouth tracks a live voice |
| `/motion-swap` | Upload a video of yourself and get it back with your avatar performing the motion |
| `/capture` | A phone video of a room becomes an explorable point cloud |
| `/voice` | Hundreds of voices, or clone your own from a short recording |
| `/assembly` | A radial engine and a steam locomotive generated from code with solved linkages and exploded views |
| `/stream` | A GLB whose first 50 KB is already a complete avatar, raced against a classic load |

### Inside the world itself

Verified shipped in `/play`: spatial voice, world chat, emotes and a reaction bar, avatar
switching mid-session, `/forge <prompt>` in chat placing a prop for everyone, collaborative
voxel building that persists, fishing, chopping, mining and cooking, vehicles, a store and
bank, the wheel, quests and an event quest line with a server-scored leaderboard
(`/api/play/event-leaderboard`), King of the Totem and tag rounds, a synced dance floor, a
kickable ball, Coin Wars from a portal in the plaza, the Agent Exchange where one agent pays
another with a real on-chain receipt, photo mode that stamps the event name, synchronized
fireworks, the countdown chip and agenda drawer, and a free event-tier souvenir granted
server-side to everyone present.

Specified but not built (each has a prompt pack in
[event-readiness/](./event-readiness/README.md)): a welcome concierge NPC, a hype ticker,
an in-world invite sheet with QR, chat scrollback for late joiners, parties, a projector or
spectator mode, a signature wall, and judged dance-off rounds. A live event-config override
is also unbuilt, so changing the window means a deploy.

---

## 3. The format menu

Grouped by what kind of event it is. "Ready" means it can run on what is deployed today.
The IBM group rule still applies to all of them: one post a week at most, tutorials that
stand alone, and no token or price content on IBM's platform.

### A. In-world gatherings (the format that drew 3,145)

| # | Format | The hour | Ready |
| --- | --- | --- | --- |
| 1 | **Community Meetup, numbered and monthly** | The configured Sep 25 run of show: build, wear it, forge into the world, an agent pays for a tool, showcase, Q&A, photo | Yes, after a deploy |
| 2 | **Build Night** | One landmark, built together with the voxel tools, left standing. Hosted by voice, progress broadcast with the announce script | Yes |
| 3 | **Quest Hour** | The event quest line switched on for the window, the leaderboard on screen, winners named at the close. Prizes settle manually | Yes |
| 4 | **Furnish the Venue** | Every attendee forges one object for a shared room by typing in chat. The room is the group photo | Yes, with one rehearsed prompt. There is no size ceiling on forged props yet, which is the documented way to crash a phone tab |
| 5 | **Office Hours in the plaza** | No agenda. The team stands at spawn for an hour each week and answers anything. Spatial voice makes it a hallway, not a webinar | Yes |
| 6 | **Docs Walk** | `/docs/world` turns the documentation into 14 walkable pavilions. A guided group walk with stops | Yes |
| 7 | **Living Stage show** | An embodied AI host takes typed questions with captions, monthly, with one human guest | Yes at `/stage`. Not reachable from inside `/play` |
| 8 | **Opening Night** | The month's best community creations curated into a built exhibition, creators present beside their work | Yes, needs curation time |

### B. Workshops in IBM's own webinar format (the 2026-06-23 format)

These fit IBM Community's event tooling directly and need nothing from the world.

| # | Format | The hour | Ready |
| --- | --- | --- | --- |
| 9 | **MCP in ten minutes** | Everyone connects the free 3D Studio server to their own assistant and builds a model from chat, then rigs it | Yes |
| 10 | **watsonx from any MCP client** | Attendees install `@three-ws/ibm-watsonx-mcp` with their own IBM Cloud key and call Granite from their editor. Community-built connector, framed that way | Yes, and the only Granite lab that does not depend on our credentials |
| 11 | **Embed clinic** | Attendees bring a page. `/studio` builds the snippet, `/embed-doctor` names the line that breaks it | Yes |
| 12 | **Bring your own model clinic** | Drop a GLB into `/inspect`, `/rig-doctor` and `/diff`. Nothing uploads, so enterprise attendees can use real assets | Yes |
| 13 | **Agents with budgets** | `/pay/simulator` dry-runs a spend policy, `/payments` shows the session limits, `/ledger` shows the audit trail. No money moves | Yes |
| 14 | **When an agent can open your front door** | The smart-home consent model as a governance case study, following the post already published to the group | Yes as a talk. The Granite Guardian live verdicts need Guardian restored |
| 15 | **Sixty-second speedrun** | A timed race from blank prompt to a live embedded agent. A segment, not an event | Yes |
| 16 | **Open source hour** | The seven verified first issues in [open-source-friday-menu.md](../marketing/growth/events/open-source-friday-menu.md), four of which need no 3D knowledge. A rig that did not animate, animating, by the end | Yes |

### C. Programs longer than an hour

| # | Format | Shape | Ready |
| --- | --- | --- | --- |
| 17 | **The Forge-Off Open** | One week, five daily themes, no-login entry and voting, crowned in-world. Full case in [ibm-next-event.md](./ibm-next-event.md) | Needs a landing page and theme copy. The pitch must say the entry screen is an NVIDIA classifier, not Granite Guardian |
| 18 | **30-Day Forge Streak** | `/daily` wrapped in a leaderboard and weekly prizes | Nearly free |
| 19 | **Sign Week** | A letter a day on `/sign-mirror`, closing with a fingerspelled relay in the world | Surfaces ready. Requires deaf collaborators before it is announced, and must be framed as fingerspelling, one narrow slice of ASL |
| 20 | **Mascot Week** | Companies submit a mascot or logo and get back a rigged, talking agent with a one-line embed. Published as a gallery | Ready. The only format that produces embeds on other companies' sites |
| 21 | **Crews Cup** | A team layer over any other format: an office or a chapter enters as a crew and stands in one HQ | Ready |
| 22 | **Remix chain** | `/creations` tracks lineage. Each entrant remixes the previous entry, and the family tree is the artifact | Ready |
| 23 | **Granite Agent Jam** | A two-week builders division for agents that think on Granite | Needs Granite restored, or entrants bring their own keys through format 10 |

### D. Physical and hybrid

| # | Format | Shape | Ready |
| --- | --- | --- | --- |
| 24 | **TechXchange side meetup** | IBM TechXchange runs 2026-10-26 to 10-29 in Atlanta. Speaking is closed. A user-group gathering, in person or as an in-world session that week timed for attendees, is still open to ask for. `/irl` pins and printable `/irl/sign` sheets give a physical room something to scan | Surfaces ready. The ask goes in the same email as the event date |
| 25 | **World Lines hunt** | Agents placed at real coordinates issue a signed proof of presence at roughly one-kilometre granularity. IBM offices as anchor pins, with a virtual twin of each pin in the world so geography locks nobody out | Surfaces ready, coverage is the work |
| 26 | **Two Rooms, One Stage** | A physical room and the world wired together for a finale | About two weeks of new work, and a single point of failure in someone else's wifi |
| 27 | **Printed prize** | `/materialize` turns the winning model into a printed object with a certificate page at `/cert` | Ready, and the payment step is owner-gated |

### E. What Granite unlocks once it is serving again

All of this is code-complete and tested. Since 2026-11-13 the Guardian row is live on the self-hosted lane; the rest needs the hosted watsonx.ai pair and is dark until it is set.

| Surface | The demo |
| --- | --- |
| `/galaxy` | Every public agent placed in 3D by Granite embeddings, searched by meaning |
| `/api/ibm/vision` | Granite Vision reads an avatar image into a full agent identity |
| `/api/ibm/twin` | Granite TimeSeries back-tests itself and runs what-if scenarios |
| `/api/guardian/assess` | Allow, review or block, with a hash-chained ledger and a spend cap that makes an agent refuse |
| Granite as the avatar brain | Provider `watsonx` in the chat proxy, with Guardian inline before any autonomous money action |
| watsonx Orchestrate as the brain | Provider `orchestrate`: a three.ws avatar as the embodied front end of an enterprise Orchestrate agent. For an IBM audience this is the strongest single demo in the repo, and it has never been shown |
| A Granite-hosted Living Stage | The `/stage` host thinking on Granite and taking the community's questions with captions |

Avoid a live model-against-model comparison on any IBM stage. An event where Granite might
place second is not one IBM can co-host.

---

## 4. What we can offer IBM as an institution

Events are one lane. These are the others, and most are already built and waiting on a
single message.

| Offer | State | Blocker |
| --- | --- | --- |
| The 3D Studio MCP server in the watsonx Orchestrate Agent Catalog | Submission pack complete in [agent-connect-listing.md](../marketing/ibm-partner-plus/agent-connect-listing.md), icon built to IBM's spec | One email to `IBMAgentConnect@ibm.com` for the `APP_ID` |
| three.ws framed inside IBM's partner surfaces | Production CSP already allows `*.ibm.com` and `*.seismic.com` to frame the site | Nobody has asked |
| A partner-authored recap on an IBM surface | We supply the recording, screenshots and captured numbers within 24 hours | Part of the event ask |
| A mascot and an in-world home for the user group | `/agent-identities` builds the character, `/crews` gives the group an HQ, `/three` lists branded worlds | Owner decision |
| A souvenir per event | The grant path is server-side and idempotent. Souvenir one was never granted because the world server was on an old build | Redeploy the multiplayer service before every event |
| My Digital Marketing, the Build track Partner Marketing Kit, co-marketing funding, digital badging | Entitled and never requested, per [ibm-partner-plus.md](./partners/ibm-partner-plus.md) | One request |
| IBM Champions self-nomination | Packet written in `marketing/partner-packets/ibm-champions-nomination.md`, waiting on three facts only the nominee can supply. Treat 2026-11-20 as the latest safe date | Owner |
| The two June commitments still open | More co-promotion from IBM, and a page on the IBM domain | The same email as the event date |

---

## 5. A season instead of a single event

One meetup is a spike. The pattern that holds a community is a rhythm, a habit and a
headline, all running at once. Every item below is independently cancellable.

| When | What | Format |
| --- | --- | --- |
| Fri 2026-09-25 | Community Meetup #2, already configured | 1 |
| Weekly from then | Office Hours in the plaza, same hour each week | 5 |
| Early October | MCP in ten minutes, in IBM's webinar format, to recruit developers into the group | 9 |
| Thu 2026-10-15 | The event-two session with an IBM guest, doubling as the Forge-Off Open kickoff | 17 |
| Week of 2026-10-26 | TechXchange week: an in-world session timed for attendees, in person if IBM opens the user-group route | 24 |
| November | "When an agent can open your front door", the governance session, ideally with Guardian live | 14 |
| Tue 2026-11-24 (fallback Nov 17) | Meetup #3, "An agent pays for its own tool", already drafted in the monthly template | 1 |
| Underneath all of it | The 30-Day Forge Streak on `/daily` | 18 |

If only one new thing gets added to a repeat of the meetup, make it a second audience. The
first meetup was a tour. A session for the governance and risk crowd (13 or 14) reaches
the people IBM Community is actually full of, and nobody else can run it inside a product
that does the thing being discussed.

---

## 6. Before Sep 25, in order

1. **Tell IBM.** The date lives only in this repo. Create the event in the IBM Community
   group and send the relationship note. The same message carries the five standing asks
   listed in [ibm-visibility-map.md](./ibm-visibility-map.md).
2. **Deploy.** The event config and the souvenir are committed and not live. The
   multiplayer service needs its own redeploy, or souvenir two repeats souvenir one. Then
   run `node scripts/play-souvenir-conformance.mjs` and `npm run audit:meetup`.
3. **Set the room size.** Decide `WALK_ROOM_MAX_CLIENTS` (ceiling 500) before the doors
   open. One room of several hundred has not been load-tested as a single crowd, so run
   `npm run event:capacity` against the chosen value.
4. **Restore one IBM model.** Done 2026-11-13 for governance: the self-hosted Guardian
   worker is deployed and `GRANITE_GUARDIAN_URL` is set, so Guardian verdicts are a true
   Granite claim. The galaxy, Vision, twin and Orchestrate beats still need a watsonx.ai
   API key and project (`WATSONX_API_KEY`, `WATSONX_PROJECT_ID` on the Cloud Run service);
   until then, no claim or live beat on those surfaces.
5. **Fix the run of show.** The kit's plaza tour points at a Plaza Stage marquee that the
   world never mounts. Cut that stop or mount the landmark.
6. **Plan moderation.** Name a moderator and keep `node scripts/moderate-play.mjs list` open in a
   terminal next to the announce script (runbook: LIVE-OPS.md, Moderation).
7. **Capture the numbers.** Start `npm run event:watch -- --interval 15` before doors and
   keep the log. It is the only source for a headcount.
8. **Refresh the runbook.** [event-readiness/LIVE-OPS.md](./event-readiness/LIVE-OPS.md)
   still carries the first meetup's release SHA and revisions.

Worth building before the October session, smallest first: chat scrollback for late
joiners, a triangle and file-size ceiling on forged props, mounting the
plaza stage, and a projector mode for a physical room.
