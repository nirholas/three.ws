# IBM Community Goes Back Inside three.ws: Meetup #3 Is Live Now on the $THREE Server

Right now, on [three.ws/play](https://three.ws/play), the Three.ws User Group on IBM Community is holding its third meetup, and its second inside the product itself. It is not a webinar or a call. It is a persistent 3D world that anyone can walk into from a browser tab, and this time IBM Community is sponsoring the session.

**Friday, November 6, 2026, from 8 AM Pacific (11 AM ET, 16:00 UTC), in the $THREE home town, the flagship world pinned at the top of the /play lobby.**

## The first one was supposed to last an hour

The group's first in-world meetup on August 7 was booked for one hour. People stayed for nine, from 8 AM to 5 PM Pacific. Concurrent avatars passed a thousand early in the morning, and the world peaked at **3,145 avatars at once**. No webinar link has ever seated that many people. The server held for the whole workday.

Most of that day didn't look like a corporate event. It looked like people spending time somewhere together: fishing, cooking the catch, driving around the map, building in the plaza, and asking the team about IBM watsonx and Granite in between. The team's account of the day is at [three.ws/blog/ibm-user-group-first-in-world-meetup-recap](https://three.ws/blog/ibm-user-group-first-in-world-meetup-recap).

The group's IBM organizer, Jessica Swanson, wrote her own recap on IBM Community, [The First Three.ws User Group Meetup: How It Actually Went](https://community.ibm.com/community/user/blogs/jessica-swanson/2026/08/08/the-first-threews-user-group-meetup-ibm). One passage from it has stuck with the community since:

> "I was never really into crypto before this partnership. I'm not going to soften that for the sake of the group. three.ws is what changed it for me, and it didn't happen through a pitch. It happened through spending real time in and around what they've built."

Today is round two, and IBM Community chose to sponsor it.

## Why this matters

Plenty of crypto projects claim an enterprise partnership. Very few can point to a dedicated user group on that enterprise's own community platform. Fewer still can say the enterprise came back to sponsor a second event held inside the product, after watching the first one run for nine hours.

three.ws is an [IBM Business Partner](https://three.ws/ibm/hello), and the partnership has been covered by [Business Insider](https://markets.businessinsider.com/news/stocks/three-ws-and-ibm-announce-strategic-partnership-to-advance-ai-powered-3d-agent-technology-1036222181) and [Yahoo Finance](https://finance.yahoo.com/sectors/technology/articles/ibm-extends-ai-narrative-three-010650764.html). The meetups are what that partnership looks like in practice: an engineering community choosing to gather inside a browser-native 3D world built on generative AI and Solana.

## What is happening in the world today

The world runs the schedule itself. A countdown chip has been running in the home town since yesterday, and each segment announces itself with a banner when it starts:

| Time (PT) | Segment |
| --- | --- |
| 8:00 | Doors open in the plaza. Welcome from IBM Community and the three.ws team |
| 8:06 | Live build: one sentence becomes a rigged 3D agent, then the team wears it |
| 8:14 | [Video to motion](https://three.ws/video-to-motion): a phone clip becomes an animation for any humanoid avatar |
| 8:20 | Forge into the world: type `/forge` and a sentence in chat, and a generated 3D object lands in the world for everyone standing there |
| 8:27 | An AI agent pays for a tool on its own at the Agent Exchange and leaves a receipt anyone can open |
| 8:33 | Community showcase: members show the avatars, embeds, MCP integrations and agents they built |
| 8:43 | Open Q&A and what ships next |
| 8:49 | Dance-off on the floor, judged by crowd reactions |
| 8:55 | Group photo at the totem, then a synchronized fireworks finale |

Everyone in the world during the hour gets the **Meetup Orbit Crown**, a gold circlet with three pearls, one for each "three" in three.ws. It is free, it is never sold, and it is never granted again after today. The server grants it once per account, only inside the event window, only in the event's world.

## What changed since August

The venue has had three months of shipping since the first meetup:

- **Live events are built into the world:** a countdown, an agenda that knows what is on now and next, segment banners, and a fireworks finale that every attendee sees at the same moment. It is computed from a shared clock, so it costs no network traffic.
- **Event souvenirs:** wearables that exist only for the people who were there.
- **Video to Motion:** upload any short video and download its motion as GLB, BVH or FBX.
- **A better world to stand in:** a world sized for phones, a photo mode that hands you the photo, a drivable car on every road, and a lobby that shows which worlds people are actually in.
- **Provenance by default:** every generated and purchased model now ships with a signed provenance credential.
- **Agents that do business with each other:** signed fulfillment records for agent-to-agent hires, owner-signed spend caps, and a REST API for agents with signed webhooks.

## Built to hold a crowd

A crowd of thousands is a live stress test, and the stack is built for it. The multiplayer layer is an authoritative Colyseus server on Google Cloud Run. Each room instance holds 100 players, and a new instance of the same world spins up automatically when one fills. State syncs at 15 Hz with binary delta encoding, which comes to about 40 KB/s per client in a completely full room. That is why it runs on a phone connection. Voice is a proximity-gated WebRTC mesh with true spatial audio, and the game server never carries the audio itself.

For the IBM side of the stack, two open-source connectors are installable today: `@three-ws/ibm-watsonx-mcp` (watsonx.ai on your own IBM Cloud account) and `@three-ws/ibm-x402-mcp` (pay-per-use IBM Granite over x402). There is a live browser demo at [three.ws/ibm/x402-demo](https://three.ws/ibm/x402-demo).

## Walk in

Anyone can drop in right now:

1. Open [three.ws/play](https://three.ws/play)
2. Click the $THREE world pinned at the top of the lobby
3. You land as a 3D avatar in about ten seconds. Walk up to people and talk. Voice is spatial.

No download, no account, no wallet needed. To arrive as yourself, build an avatar at [three.ws/create](https://three.ws/create) from a selfie or one sentence, and it follows you in.

The official event thread, with live help for anyone who gets stuck, is on IBM Community: [three.ws Community Meetup #3: Live on the $THREE Server](https://community.ibm.com/community/user/discussion/three-ws-community-meetup-3-live-on-the-three-server-three-ws-play).

## The paper trail

- Today's official thread: [IBM Community discussion](https://community.ibm.com/community/user/discussion/three-ws-community-meetup-3-live-on-the-three-server-three-ws-play)
- Today's event listing: [Community Meetup #3 on IBM Community](https://community.ibm.com/community/user/events/event-description?CalendarEventKey=40070ea4-ea38-4513-8fac-01a18e7e6a7b&CommunityKey=e71510cc-d953-408f-9a1c-019f5c0a7016)
- The announcement on three.ws: [three.ws/blog/ibm-user-group-meetup-3](https://three.ws/blog/ibm-user-group-meetup-3)
- How August went, from IBM's organizer: [The First Three.ws User Group Meetup: How It Actually Went](https://community.ibm.com/community/user/blogs/jessica-swanson/2026/08/08/the-first-threews-user-group-meetup-ibm)
- How August went, from the team: [three.ws/blog/ibm-user-group-first-in-world-meetup-recap](https://three.ws/blog/ibm-user-group-first-in-world-meetup-recap)
- The group's launch post from July: [Welcome to the Three.ws User Group](https://community.ibm.com/community/user/blogs/jessica-swanson/2026/07/14/welcome-to-the-threews-user-group-building-ai-agen)
- The partnership, independently reported: [Business Insider](https://markets.businessinsider.com/news/stocks/three-ws-and-ibm-announce-strategic-partnership-to-advance-ai-powered-3d-agent-technology-1036222181), [Yahoo Finance](https://finance.yahoo.com/sectors/technology/articles/ibm-extends-ai-narrative-three-010650764.html)
- The IBM integration pages: [three.ws/ibm/hello](https://three.ws/ibm/hello), [three.ws/ibm/x402-demo](https://three.ws/ibm/x402-demo)
- Our August coverage on CoinMarketCap: [Inside IBM's First In-World Community Meetup on three.ws](https://coinmarketcap.com/community/articles/6a764209be2055673e8e5c1f/)
- The platform: [three.ws](https://three.ws), [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), [@trythreews](https://x.com/trythreews) on X

A full recap with today's headcount and the best moments follows once the doors close.

_three.ws is an open-source, browser-native platform for 3D AI agents and on-chain communities. three.ws is an IBM Business Partner. IBM does not endorse three.ws, and three.ws is not an IBM product._
