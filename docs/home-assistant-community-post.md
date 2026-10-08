---
venue: Home Assistant Community (community.home-assistant.io), category "Share your Projects!"
account: three.ws (official) / nichxbt
description: "Forum post introducing the three.ws Home Assistant integration: a HACS custom integration that dials out over one WebSocket so a LAN-only install can be reached, an MCP server that keeps door-opening for surfaces where a person can approve it, five household roles enforced server-side, a voice loop with a confirmation grammar built for real rooms, and a 3D agent that stands in a live model of your house."
tags: [custom-integration, hacs, mcp, voice, presence]
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# I gave my Home Assistant a face, and made the front door its best-guarded part

_Forum post for the [Home Assistant Community](https://community.home-assistant.io), category "Share your Projects!". Written first person for people who run HA._

Hi all! I build [three.ws](https://three.ws), an open-source (Apache-2.0) platform for 3D AI agents. The short version for anyone new to it: you describe a character in a sentence, and you get a rigged, animated 3D body that can talk, listen, and be embedded on any web page.

A few months ago I connected one of those characters to my Home Assistant, and it turned out to be the most fun and the most carefully engineered thing I have built all year. Now my house has a friendly face. It stands in a live 3D model of my home, the bedroom lamp in the scene dims when the real one does, and I can ask it "good night" and watch it run the Bedtime scene my household already set up.

This post walks through what it does, how to try it, and the design choices I am proudest of, especially around locks.

**In one paragraph:** a HACS integration connects even a LAN-only Home Assistant to a 3D agent that lives in a model of your home and talks with you. A published MCP server lets **any** assistant (Claude, Cursor, your own) read and drive your house too. Physical actions that open the house, like unlocking a door, run only where a real person can see and approve them.

## What you get, at a glance

- **A face for your house.** A 3D character standing in a live scene built from your own rooms, reacting as state changes.
- **Voice, hands-free.** A wake word that runs on your device, barge-in so you can interrupt, and spoken confirmation designed for real, noisy rooms.
- **Your scenes, understood.** Say "good night" and the agent finds the scene your household already built, even when it is called "Bedtime".
- **Sharing that matches real households.** Five roles, from the person who owns the house down to a wall display, each enforced on the server.
- **Privacy you can see.** One page shows everything a connected home stores, with export and delete buttons.
- **Any assistant you like.** The MCP server works with Claude, Cursor, or anything else that speaks Model Context Protocol.

## Built on what Home Assistant already does brilliantly

I wrote zero device code. Zigbee, Z-Wave, Matter, Thread, BLE, and the 1,500-plus integrations are Home Assistant's strength, and leaning on them is the reason this took weeks rather than years. Since the `mcp_server` integration, HA also speaks Model Context Protocol natively, and three.ws already speaks MCP across around forty packages, so the two halves met cleanly with no new protocol in between.

The platform also respects the control HA already gives you. Writes are scoped to exactly what you exposed to the LLM API in Home Assistant itself, so the outer boundary lives in HA's own exposure settings, where you already manage it. Your scenes and scripts are the macros: "good night" and "I'm leaving" resolve to `scene.turn_on` and `script.turn_on` on things you already built, and the agent only composes individual calls when no scene fits.

What I added is the **face**: a real-time 3D presence that stands in a live model of your home, reacts to it, and speaks.

## Designed for LAN-only installs: the house dials out

Most HA installs live on a home network with no forwarded port and no public address, and that is the default I designed for.

So: **the house dials three.ws, and three.ws never dials the house.**

One integration from HACS opens a single outgoing WebSocket and keeps it open.

- Nothing listens on your network.
- No port is forwarded and no firewall rule changes.
- No tunnel daemon, no third-party service, no account anywhere else.
- **three.ws never receives a Home Assistant token.** The integration signs in to HA on your own machine with a credential it creates for itself, and that credential stays in the house.

The relay in the middle is small on purpose. It holds no database (ownership is proved by the signature on the install token the house presents), it holds no Home Assistant credential, and it forwards only the message types the protocol permits, in the direction it permits them. The integration enforces the same allowlist again at the house end, so each side checks the other.

Install path, if you want to try it:

1. On three.ws, open `/smart-home`, choose **Connect a home that is only on my network**, and press **show me a code**. The code is single use and has a ten-minute countdown.
2. In HACS, add `https://github.com/nirholas/three-ws-home-assistant` as a custom repository, category **Integration**.
3. Install **three.ws**, restart HA.
4. **Settings, Devices and services, Add integration, three.ws.** Paste the pairing code.

If your HA already has a remote https address (Nabu Casa, or your own reverse proxy), you can skip all of that and connect with a long-lived token instead. Both paths lead to the same experience.

The relay threat model is written down and published. Writing it shaped two of the properties above, and I recommend the exercise to anyone building on the home network.

## The part I am proudest of: locks

Turning on a light and unlocking a door are different classes of action, so I designed them differently from the first line. My guiding principle: **a refusal belongs in code, where no conversation can talk it round.**

The guards live on the server, in four layers.

**1. The physical-action gate.** Anything that opens the house passes through one gate with one implementation, shared between the bridge and the MCP server so the two can never drift apart. Locks, garage doors, alarm panels, and anything HA marks as a security entity need explicit confirmation every time, until you grant a standing allowance for that one entity. Locking up never prompts.

One detail I found while building it, and it is a nice illustration of why the gate works on real targets rather than tool names: Home Assistant's Assist tool for turning things off documents that, for a lock, it performs an unlock. So the gate resolves every call to the real entities it touches and the service each one would actually perform, before anything runs. I confirmed this against a live instance with a lock exposed to Assist: the gate stopped the call, and with a real confirmation the door unlocked as intended.

**2. Over stdio, door-opening stays on surfaces with a person.** The published MCP server, `@three-ws/home-mcp`, gives any assistant five tools: read the house, list entities, list the scenes your household already built, run one, and call a service. Point it at your HA:

```bash
claude mcp add home \
  -e HOME_ASSISTANT_URL=https://example.ui.nabu.casa \
  -e HOME_ASSISTANT_TOKEN=... \
  -- npx -y @three-ws/home-mcp
```

Ask it to unlock a door and it will politely explain that this action lives on a surface where you can approve it. A stdio MCP server has no screen of its own and no session, so a real approval belongs on a surface where a real person sees a real prompt. If you want your own assistant to open one specific door, you grant that entity explicitly with `HOME_ALLOWED_ENTITIES`, and the allowance applies to exactly that entity and nothing else. I tested this by spawning the server as a child process and speaking MCP to it: an unlock with no allowance stayed locked, `{confirmed:true}` smuggled into service data stayed locked in all three variants I tried, an allowance for the kitchen door did not open the front door, and an allowance for the front door opened it and re-locked it.

**3. Household roles, enforced server-side.** A house has more than one person in it. There are five roles, and each one states in plain words at the moment you pick it what it can do:

| Role | Who it is for | What it can do |
|---|---|---|
| `owner` | The person who connected the house (exactly one per home) | Everything, including disconnecting |
| `admin` | Whoever runs the household | Everything except taking the house off the platform |
| `member` | Somebody who lives there | Act, confirm a guarded action, arrange the layout |
| `guest` | A visitor or house sitter | Lights and other ungated actions within their scope |
| `viewer` | A wall display or monitoring seat | Read their scope |

A few properties I especially like:

- A guest can turn the lights on and approving an unlock belongs to residents only. That rule is enforced on the server, so every client gets it for free.
- A guest or viewer can be scoped to just the kitchen, or just three devices, and **the rooms you did not give them are removed from what they receive**, not merely hidden on screen. Their app only ever learns about the rooms they were given.
- Invitations work once, expire after a week, and can be withdrawn before anyone uses them.
- Removing somebody takes back every standing allowance they ever approved in the same instant.
- Every action in the home log is attributed to the person who took it, so "who did what" always has a clear answer.

**4. Voice, built for real rooms.** Hands-free is the interface that works when you are carrying groceries, so I gave it the most careful design of all. When a turn produces a guarded action, the agent speaks the whole action first ("This will unlock the Front Door. Say confirm to continue, or cancel to leave it alone"), shows the entity on screen with a countdown, and accepts one deliberate word: `confirm` and its close relatives. General affirmatives like "yeah" or "sure" are deliberately not part of the grammar, because those are the words a recognizer hears from conversations elsewhere in the room, and the token has to stand on its own rather than inside a longer sentence. The action itself was frozen on the server when the confirmation was minted, so a confirmation for one lock can only ever open that lock. On a device with no screen, the agent offers your phone for the approval.

## The voice loop, in a little more depth

For the people here who enjoy the plumbing:

- **One microphone, opened once.** Voice activity detection is silero-vad (MIT) at 512-sample frames and 16 kHz, and the wake word is openWakeWord (Apache-2.0) running in the browser on onnxruntime-web.
- **The wake word stays on your device.** Only the utterance after the wake word is uploaded, and only to be transcribed. The sound of your voice is never stored.
- **Four pre-trained wake phrases ship:** Hey Jarvis (the default, and the one that does best in a noisy kitchen), Hey Mycroft, Alexa, and Hey Rhasspy (the smallest model of the four).
- **A voice satellite face.** The avatar also speaks the Wyoming protocol, so if you run an HA voice assistant, it can wear the agent's face in a room instead of being a speaker grille.

## Verified against a real house

Every claim above was checked against a real Home Assistant running in Docker, seeded with 122 entities across four areas, four locks, and two user scenes named "Bedtime" and "Away Mode":

- The bridge client test suite passes end to end against that instance (37 tests, 7 of them live).
- `mcp_server` exposed 29 real tools, and a tool call turned on a real light.
- Saying "good night" in a house with no scene of that name resolved to `scene.bedtime` at 0.95 confidence, and the bedroom went dark in the 3D scene too (brightness 0.157, a warm `[255, 164, 82]`).
- A phrase with no matching scene runs nothing at all.
- The relay end-to-end test drove a house on a network the caller had no route to: 10 of 10 checks, including a real light toggled, a real door unlocked through the gate, and four allowlist checks holding.

The registry snapshot from that instance is checked in as a test fixture, so a Home Assistant registry change shows up as a test result long before it reaches anyone's house.

## Explored and documented: the agent as a Matter device

I prototyped presenting a three.ws agent as a Matter device using matter.js, and it commissioned into a real Home Assistant in 744 ms. I wrote the whole experiment up with its measurements, so anyone curious about the agent-as-a-device direction can start from data. The write-up is in the smart-home docs linked below.

## Everything else that ships today

- **A live 3D scene of your home** that the agent stands in, reacting to state as it changes. An agent that is *somewhere* in a house is a warmer thing to talk to than a text box.
- **A floorplan editor.** Draw a top-down plan, and the 3D scene follows it. A tray creates rooms and files devices into them in your own HA registry.
- **Privacy as a page.** See, export, and delete everything a connected home stores, on one screen. Room names, device names, and device states are never stored: they are read live and held in memory only while the connection is open. The action log defaults to 90 days and is yours to adjust, from one day up to ten years.
- **A clear status page.** It tells you whether your house is offline at your end or everything is running smoothly on ours, and every home's connection is isolated from every other home's.
- **Language and units.** The whole surface reads in your language, in your units, at a touch size that works on a wall tablet, and the wall display stays awake.
- **The car.** Same design, on the road: three.ws Drive is a voice-first agent that can reach your house from the car, with an Android Auto app built and compiled and a CarPlay scene built into the iOS app. "Turn the porch light on" from the driveway is the whole point.

## Who we build with

three.ws takes part in eight partner programmes, and several of them touch this project directly:

- **Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. The platform and the relay your house dials into both run on Cloud Run.
- **NVIDIA Inception.** three.ws is an NVIDIA Inception member. Voice transcription in the home loop runs through NVIDIA Riva, and the 3D generation that builds the agent's body runs on NVIDIA GPUs.
- **OpenAI Select Partner.** Our free 3D Studio connector brings three.ws 3D tools into ChatGPT over MCP, and the same MCP approach is what makes `@three-ws/home-mcp` work with any assistant you choose.
- **Alibaba Cloud and IBM.** Qwen models are first-class lanes in the platform's model router, reached through Alibaba Cloud, and three.ws is an IBM Business Partner whose agents can think on IBM Granite models through watsonx.ai with your own IBM Cloud credentials.
- **AWS, HackerNoon, and Quicknode** round out the eight, covering cloud, developer publishing, and infrastructure.

These are programme designations, and the opinions in this post are my own. The full list is at [three.ws/partners](https://three.ws/partners).

## What I would love from this forum

1. **Your take on the stdio design.** My reasoning is that approval belongs where a person can see it, with per-entity allowances for owners who want their own assistant to open a specific door. I would love to hear how you would shape it for your setup.
2. **Roles in your household.** Five covers residents, admins, guests, house sitters, and wall displays. If your household has a shape I have not covered, I would like to add it.
3. **Your list of things an agent should always ask about.** Mine starts with unlocking and with changing another person's access. I would love your additions.

Everything is Apache-2.0. The integration is at [github.com/nirholas/three-ws-home-assistant](https://github.com/nirholas/three-ws-home-assistant), the MCP server is `@three-ws/home-mcp` on npm, the platform is at [three.ws/smart-home](https://three.ws/smart-home), and the docs (including the relay threat model and the Matter write-up) are at [three.ws/docs/smart-home](https://three.ws/docs/smart-home).

Happy to answer anything, including why a 3D avatar belongs in a house. I have a real answer for that one: a home has rooms and objects, and an assistant that can be *somewhere* in it is easier and more pleasant to talk to.
