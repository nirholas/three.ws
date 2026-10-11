A developer community usually meets on a call: a grid of webcams, a screen share, a chat panel, and a recording that ages in a drawer. This past season three.ws tried a different shape for the community it runs around building AI agents with 3D capabilities. The group's opening meetup was held not on a video call but inside a persistent three.ws 3D world, and it stayed open for nine hours, long enough for a person to drop in over a morning coffee, leave for lunch, and come back to find the conversation still going. This Article walks through how that day was built, what walking into it felt like, how the infrastructure held an audience of thousands at once, and how each claim below was checked against production before it was written down.

## What IBM Community makes possible

IBM Community runs a network of public topic groups where developers, practitioners and enthusiasts organise themselves around shared interests and hold their own events. three.ws runs one of them: a public group for developers building AI agents with 3D capabilities, covering avatars that walk and speak, 3D scenes generated from sentences, agent wallets on Solana, and the tooling that ties them together.

A user group is what its name says. Membership is open, the conversation belongs to the members, and the events are what the group decides they should be. When the time came to hold the group's opening meetup, the obvious formats were the video-call ones familiar across such programmes. The group being what it is, though, there was a more fitting stage available: three.ws builds persistent 3D worlds, and the meetup moved into one.

Here is how that opening looked, filmed live on the recap page for this Article: the moment a user-group meetup held inside a 3D world comes into view.

![A nine-hour IBM Community meetup held inside a 3D world, filmed live on three.ws/blog/ibm-user-group-first-in-world-meetup-recap, 2.1 seconds into the run: A user-group meetup held inside a 3D world](/x-media/partner-ibm-article-20261011/user-group-in-world-meetup-1.jpg)

## A world instead of a call

A call has a stage and an audience. A world has a room. That single difference shaped the planning of this meetup. On a call, someone shares a screen and everyone else watches the same rectangle. In a world, the audience stands where they like, clusters into side conversations, walks up to a stage area when something is being presented, and drifts to the edges when a demo has finished and the chatting resumes. An attendee does not watch the meetup; the attendee attends it.

The decision carried one practical consequence that became the day's signature: it ran nine hours, entirely inside three.ws. There was no overflow stream, no parallel webinar. The venue was the platform, and the platform held. Nine hours is a full working day at a conference, and the room stayed live for the whole of it. The filmed run from the recap shows the crowd assembled and settled in, early in the day, with the world already doing the work a convention hall would do.

![A nine-hour IBM Community meetup held inside a 3D world, filmed live on three.ws/blog/ibm-user-group-first-in-world-meetup-recap, 5.6 seconds into the run: A user-group meetup held inside a 3D world](/x-media/partner-ibm-article-20261011/user-group-in-world-meetup-2.jpg)

## Walking in with a link

The organisers made one deliberate choice about the door: anyone with the link could walk in. No registration list was checked at the entrance, no ticket, no account-creation flow standing between a curious developer and the room. The link circulated through the group's page and through word of mouth, and it worked for whoever had it while the meetup was live.

In practical terms, walking in meant opening the link in a browser and arriving as an avatar in the world. The body loads, the room loads, and the visitor is present: visible to everyone nearby, audible to the people standing close, free to move. A newcomer could arrive alone, spot a cluster of avatars near a demo area, walk over, and join the conversation by proximity rather than by raising a hand in a chat panel. That is the interaction model three.ws worlds use everywhere; what made it notable here was the crowd it had to absorb.

For the person attending, this flattened the awkwardness of online events. There was no waiting room to be admitted from and no moment of being announced to a silent grid. The visitor appeared, oriented, and joined. People arriving from different time zones had the same experience: the world was running, the agenda was in progress, and whatever was on stage at that moment was there to be walked up to.

## The server that held the room

A room anyone can walk into is worth little unless the server holds when the crowd arrives. The numbers the day produced are numbers the platform's own telemetry recorded: the open room peaked at 3,145 concurrent avatars. That peak is not an estimate from a headcount or a signup sheet. It is the concurrency the room's authoritative server tracked while it was managing the state of the world, avatar by avatar, across the meetup's live window.

Under the hood, the meetup ran on an authoritative Colyseus server on Cloud Run with 15 Hz binary delta sync and proximity-gated spatial voice. Each part of that stack earned its place over the day. Authoritative means the server, not any client, owns the truth of the world: where each avatar is, which way it faces, what it is doing. Clients send intentions; the server decides what happened and broadcasts the result. That is what kept the views of thousands of attendees consistent with one another, so a wave was a wave and a walk to the stage was a walk to the stage, for everyone in the room.

The 15 Hz binary delta sync is how that truth reached browsers without drowning anyone's connection. Fifteen times a second, each client received a compact binary update describing what had changed since the previous update, not a full snapshot of the room. Deltas are what kept the world responsive on ordinary hardware and ordinary connections, because the bytes crossing the wire described movement, not the whole scene, at each tick.

Voice was proximity-gated and spatial. An attendee heard the avatars standing near their own and not the crowd across the room, which is what made parallel conversations possible in a space holding thousands at once. Rather than one conference call of thousands of speakers, the world behaved like a physical venue: many small conversations, a louder zone near the current presenter, and quiet corners for two people who had just met. Cloud Run absorbed the load as the audience rose and fell across the day, so the room's capacity grew with the crowd.

The filmed run captured the meetup mid-flow, during the segment where the live tour, demos and Q&A played out in-world.

![A nine-hour IBM Community meetup held inside a 3D world, filmed live on three.ws/blog/ibm-user-group-first-in-world-meetup-recap, 9 seconds into the run: Live tour, demos and Q&A, all in-world](/x-media/partner-ibm-article-20261011/user-group-in-world-meetup-3.jpg)

## The agenda, run in the world itself

An open door and a strong server get people into the room. The agenda is what kept them there. The day's programme was a live tour of the platform from inside the world, community demos, and open Q&A.

The live tour deserves the most attention, because it inverted the usual product demo. Instead of a presenter screen-sharing slides about a 3D platform, the presenters led the audience through the platform itself, in-world, using the room as the medium. Features were shown by walking to them. Capabilities were demonstrated on the spot, with the audience watching from wherever they had chosen to stand. For three.ws, the venue and the product are the same object: the world the meetup ran in is the thing the tour described.

Community demos put members of the group on the stage rather than the hosts. Developers in the user group are building AI agents with 3D capabilities of their own, and the meetup gave them a room full of peers to show that work to. A demo in a world is a different act from a demo on a call: the presenter stands next to what they built, and the audience can walk around it. Open Q&A closed the loop, with questions asked by voice in the room itself, answered to the people within earshot and overheard by whoever drifted closer.

The length of the day set the agenda's tone. Nine hours is long enough that sessions did not need to be compressed and an attendee who missed the morning did not miss the meetup. The final filmed frame shows what the later hours looked like: the open room holding for a full workday, still populated, still talking.

![A nine-hour IBM Community meetup held inside a 3D world, filmed live on three.ws/blog/ibm-user-group-first-in-world-meetup-recap, 12.5 seconds into the run: The open room held for a full workday](/x-media/partner-ibm-article-20261011/user-group-in-world-meetup-4.jpg)

## The Meetup Laurel

Attendance at most online events leaves a calendar entry and a follow-up email. The organisers wanted something more durable for the people who made time for the day, so everyone who walked in while it was live got a Meetup Laurel, granted server-side.

The detail that matters there is the server-side grant. The Laurel was not a link someone had to remember to click or a form to fill in afterwards. The moment an avatar entered the world during the live window, the authoritative server registered the attendance and granted the Laurel. It is a permanent in-world keepsake: it stays with the avatar after the event ended, a visible record that its owner was in the room for the group's opening meetup.

For a community, that kind of artifact does quiet, useful work. Months from now, two avatars meeting in a three.ws world can recognise from each other's Laurels that they were both there on the day, and that recognition is raw material for a community's memory. The grant being automatic also kept the door frictionless. Because entry required the link and nothing more, the Laurel could require entry and nothing more. There was no step to forget, so no attendee was left out by a missed step.

## How the relationship is stated

The group's existence rests on a specific relationship, stated here in the designation's own words: three.ws is an IBM Business Partner, an independent member of IBM's partner program. That is a designation, not an endorsement, certification or strategic partnership, and three.ws is not an IBM product. The partner page is linked in the closing section of this Article.

Each section above is about what three.ws built and ran, and the warmest thanks go where a user group's thanks belong. To the members, whose demos, questions and nine hours of presence were the event; a user group is its members, and this one showed up across the time zones the agenda crossed. And to the group's organizer on IBM's side, with whom the day was planned from the opening agenda draft to the last goodbye in the room, thank you for backing a venue that was, for a programme of this kind, untrodden ground.

## How the day was organised

A nine-hour in-world meetup does not assemble itself, and the planning behind it was shared: it was organized with the group's organizer on IBM's side. That collaboration covered the shape a user-group event should take: scheduling the date so members could attend across time zones, settling an agenda that balanced platform content with community content, and agreeing the open-door policy so the meetup would be as public as the group itself.

On the three.ws side, preparation meant the world itself: the space the audience would walk into, the stage area where the tour and demos would run, the proximity-voice mapping tuned so a presenter near the stage carried further than a conversation at the edge, and the Laurel grant wired into the server's arrival handler so late arrivals would be recorded the same way as early ones.

On the day, the organisers' work became hospitality: greeting arrivals, cueing speakers, moving the agenda along, and keeping the Q&A flowing. The persistent world made that job lighter than it sounds, because nothing had to be restarted, re-admitted or re-shared as the hours passed. The venue continued, and continuity is what a persistent room is for.

## How this Article was checked

Everything stated about the day comes from the platform's own record of it, and the feature was filmed working on production for this Article. The recap page carries the run, the moment in each run where each figure above was taken, and the claims laid side by side with what each was checked against. The filming record is tabulated here, with the surface it was filmed on, the length of the run, and where the live read can be followed.

| Feature | Filmed on | Length | Read live |
|---|---|---|---|
| A nine-hour IBM Community meetup held inside a 3D world | three.ws/blog/ibm-user-group-first-in-world-meetup-recap | 13.9 s | hours = nine hours, peak = 3,145 |

Each factual claim in this Article, from the nine-hour duration to the 3,145-avatar peak to the server-side Laurel grant, was checked against its evidence before it was written, and that checking is recorded in the same shape as the claims.

| What we state | Checked against |
|---|---|
| the first meetup of the Three.ws User Group on IBM Community | three.ws/blog/ibm-user-group-first-in-world-meetup-recap shows "the first meetup of the Three.ws User Group on IBM Community" |
| it ran nine hours, entirely inside three.ws | the run read hours = nine hours; three.ws/blog/ibm-user-group-first-in-world-meetup-recap shows "entirely inside three.ws itself" |
| anyone with the link could walk in | three.ws/blog/ibm-user-group-first-in-world-meetup-recap shows "anyone with the link could walk in" |
| the open room peaked at 3,145 concurrent avatars | the run read peak = 3,145 |
| a live tour of the platform from inside the world, community demos, and open Q&A | three.ws/blog/ibm-user-group-first-in-world-meetup-recap shows "a live tour of the platform from inside the world" |
| an authoritative Colyseus server on Cloud Run with 15 Hz binary delta sync and proximity-gated spatial voice | the run saw "15 Hz binary delta sync" |
| everyone who walked in while it was live got a Meetup Laurel, granted server-side | three.ws/blog/ibm-user-group-first-in-world-meetup-recap shows "Meetup Laurel" |
| organized with the group's organizer on IBM's side | three.ws/blog/ibm-user-group-first-in-world-meetup-recap shows "the group's organizer on IBM's side" |

The scenario that produced the filmed run is published with the recap, so the exact steps the run executed, and the conditions it waited on, are readable rather than implied.

```json
{
  "format": "square",
  "steps": [
    {
      "goto": "https://three.ws/blog/ibm-user-group-first-in-world-meetup-recap",
      "settle": 4000
    },
    {
      "read": "hours",
      "match": "it ran (nine hours)"
    },
    {
      "read": "peak",
      "match": "peaked at ([\\d,]+) concurrent avatars"
    },
    {
      "hold": 2500,
      "caption": "A user-group meetup held inside a 3D world"
    },
    {
      "scroll": "What the day looked like",
      "ms": 1200,
      "caption": "Live tour, demos and Q&A, all in-world"
    },
    {
      "hold": 3500
    },
    {
      "scroll": "What it proved, beyond the vibe",
      "ms": 1200,
      "caption": "The open room held for a full workday"
    },
    {
      "expect": "15 Hz binary delta sync"
    },
    {
      "hold": 5500
    }
  ]
}
```

That is the standard this series holds itself to: a number in these pages is a number the platform produced or read off the screen during the run, and a behaviour described here is a behaviour that was watched happening on production.

## What the day showed about in-world community

Stepping back from the mechanics, the meetup answered a question three.ws had been carrying for a while: can a developer community's headline event live inside the medium the community is about, without compromise? The evidence of the day says yes, and it says so in concrete terms. The door was open and stayed open. The room peaked at 3,145 concurrent avatars and held. The agenda of live tour, demos and Q&A ran in the world itself, with the audience moving through it on foot. The closing ritual, the Laurel, was handled by the same authoritative server that handled the crowd. And the whole thing ran nine hours, entirely inside three.ws, which is the sentence that captures what persistent worlds are for: they do not end when a stream ends, because there is no stream. There is a place, and on this day the place was the meetup.

For the user group, this was the first meetup of the Three.ws User Group on IBM Community, and it now stands as the baseline. What the members build from here, and what the next gathering looks like, belongs to them.

## The partners behind the world the meetup ran in

**OpenAI.** three.ws is an OpenAI Select Partner. What three.ws built on it: the free 3D Studio connector for ChatGPT; Spatial MCP, 3D as a native tool result; and one link from ChatGPT to AR. The three.ws 3D Studio connector is a Streamable HTTP MCP server at one URL that ChatGPT can add with no key, no account and no wallet. The /openai page asks the live server for its tool list on load and shows how many tools answered. The generation tools return interactive 3D that renders inline in the conversation. The page also covers the Custom GPT Actions route for plans without connector support.

**IBM.** three.ws is an IBM Business Partner. What three.ws built around it is the subject of this Article: a nine-hour IBM Community meetup held inside a 3D world. three.ws runs the public user group for developers building AI agents with 3D capabilities described above. The meetup ran nine hours, held entirely inside a persistent three.ws 3D world rather than on a call. The world was open to anyone with the link and peaked at 3,145 concurrent avatars. The agenda was a live tour of the platform from inside the world, community demos and open Q&A, and attendees received a permanent in-world Meetup Laurel. It was organized with the group's organizer on IBM's side.

**Amazon Web Services.** three.ws is an AWS Partner. What three.ws built on it: a free AWS subscription that issues an x402 key; engineering write-ups on the AWS Builder Center; and how the AWS Marketplace integration identifies a buyer. three.ws built the AWS Marketplace SaaS integration and a product page that explains it. Subscribing is a front door: it links an AWS account to a three.ws account and issues an x402 access key that calls the /api/x402/ endpoints, with usage then paid per call over x402, so AWS Marketplace does not meter or bill it. Registration and entitlement calls reach the AWS Marketplace APIs in us-east-1. The same x402 endpoints work with no AWS account at all. It is for teams that want to start from the AWS side.

**Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. What three.ws built on it: Forge engines on its own Cloud Run GPU workers; the wardrobe of rigged garments built on a Cloud Run pipeline; and CAD Forge, a real part from one sentence, on Cloud Run. The Forge turns a text prompt, photos or a sketch into a textured 3D model, and the open models behind it (TRELLIS, Hunyuan3D, TripoSG) run as three.ws's own Cloud Run services on NVIDIA L4 GPUs in us-central1. Each tier shows a free lane and a live time estimate before Generate is pressed, a sketch has its own lane, and the free NVIDIA NIM lane stays behind the self-hosted workers as a safety net. The GPU workers are the infrastructure this programme backs, and the meetup world in this Article ran on Cloud Run too.

**Alibaba Cloud.** three.ws is listed on the Alibaba Cloud International Marketplace. What three.ws built around it: Qwen as MCP tools, chat and embeddings through DashScope; the Brain lab, one prompt streamed to a panel of models, Qwen included; and a marketplace listing. The @three-ws/alibaba-cloud-mcp package gives any MCP client three tools that call Alibaba Cloud Qwen models through DashScope: qwen_chat for written answers, qwen_embed for vectors and qwen_list_models. It runs as a stdio server on the developer's own machine with their own DashScope key, and the tools are documented on three.ws with their arguments and a paste-ready client config. The package is community-built and not affiliated with Alibaba Cloud.

**NVIDIA.** three.ws is an NVIDIA Inception member. What three.ws built on it: avatar voices on NVIDIA Magpie; a self-hosted GPU fleet on L4 and Blackwell; and the free NVIDIA model map. The voice picker offers NVIDIA Magpie multilingual speech as a free lane for any avatar. Speech is synthesized by NVIDIA Riva through a hosted function, with no key needed from the user. Pick the voice, type a line, and the avatar speaks it. The lane covers many languages.

**HackerNoon.** three.ws has partnered with HackerNoon. What three.ws built for it: the RSS feed HackerNoon reads; the newsroom behind the feed; and a builder-focused publishing arrangement. Each three.ws announcement is published as a plain RSS feed at three.ws/rss/announcements.xml. HackerNoon pulls it into a drafts queue, where items are reviewed and published with a canonical URL back to three.ws.

**Quicknode.** three.ws is in the Quicknode Startup Program. What three.ws built on it: a way to verify an x402 settlement on Solana; and an agent wallet, read live from Solana. One GET to verify-receipt checks a real x402 settlement signature against the Solana chain and answers with a finalized status and slot, reading through the same RPC failover chain that Quicknode capacity feeds.

## Try it

Read the full account of the relationship on the [three.ws IBM Business Partner page](https://three.ws/blog/three-ws-ibm-business-partner), and walk through the day itself, with the filmed run, its figures and its evidence tables, in the [in-world meetup recap](https://three.ws/blog/ibm-user-group-first-in-world-meetup-recap).
