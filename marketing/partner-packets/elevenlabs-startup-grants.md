# ElevenLabs Startup Grants

**Target:** ElevenLabs Startup Grants program
**Program page:** https://elevenlabs.io/startup-grants
**Verified intake:** https://elevenlabs.io/grants-application (terms page with an "I agree" checkbox and
"Proceed to application"; read 2026-09-16). The application questions sit behind that checkbox and
were not opened, because ticking it is accepting terms on the company's behalf. The program page says
the application covers "the startup you're building, your team, how you expect to grow".
**Deadline:** rolling. The terms say the program "will remain open for applications for a period of six
(6) months, subject to extension or early termination", with no start date given, so the closing date
cannot be computed. Decisions within about one week. Pipeline target **2026-09-24**.
**Owner's one step:** confirm the employee count is under 25, then tick the terms box and submit the
answers below from a three.ws business email.

---

## Eligibility checklist (from the live grant page and terms, 2026-09-16)

| Requirement (quoted or paraphrased from ElevenLabs) | three.ws position | Verdict |
|---|---|---|
| "fewer than twenty-five (25) employees, determined at the time of application" | Headcount is not recorded anywhere in the repo | **Owner must confirm** |
| "Monetized product use case" with a business or monetization strategy | Voice Lab publishes prices: $0.50 per voice clone and $0.30 per 1,000 spoken characters on the ElevenLabs lane, charged to a prepaid credit balance ([`api/tts/eleven.js`](../../api/tts/eleven.js) meters every platform-key synthesis) | Meets |
| "No short-term or one-off projects" | Platform live since at least June 2026 with public changelog | Meets |
| Valid business email | `partnerships@three.ws` or `nich@three.ws` | Meets |
| "No projects for minors: ... children aged 18 or under" | Not built for children, but the [Terms of Service](https://three.ws/legal/tos) allow users **13 and older** with guardian consent under 18 | **Grey area. Disclose the 13+ policy honestly if asked; do not describe the audience as adults-only** |
| "No agencies or consulting firms" | Product company | Meets |
| Existing enterprise customers ineligible | No ElevenLabs enterprise contract recorded in the repo | Meets as far as the repo shows |
| One application per company; previous grant recipients ineligible | No prior grant recorded | Meets as far as the repo shows |
| Not located in or organized under a sanctioned jurisdiction | Terms of Service are governed by Delaware law | Likely meets; owner confirms entity |
| Use must comply with the ElevenLabs Prohibited Use Policy | Voice cloning is exposed to users; the policy was not reviewed line by line here | Owner reads https://elevenlabs.io/use-policy before applying |

## Two findings the application must not paper over

**1. There is no platform ElevenLabs key in production today.** `GET https://three.ws/api/tts/catalog`
on 2026-09-16 returned the ElevenLabs lane as `available: false`, `byok: true`, reason "Add your own
ElevenLabs key below", and the Cloud Run service carries no `ELEVENLABS_API_KEY`. Voice Lab's header
counted "357 voices across 3 providers" (the free Edge, Gemini, and NVIDIA lanes). So ElevenLabs is fully
integrated in code and usable today only with a user's own key. The grant would directly switch on the
platform lane. Say that; it is a stronger and truer pitch than implying current ElevenLabs volume.

**Side effect to fix separately:** the Voice Lab copy says ElevenLabs calls "on the three.ws account ...
are metered to your credit balance". With no platform key that path cannot run, so the copy overstates
what a visitor can do today.

**2. Demo Day 2026 is already cast.** https://demoday.elevenlabs.io/ shows the "2nd annual Startup Grants
Virtual Demo Day" on **Wednesday 2026-10-21, 6:00 PM CEST**, where "11 grant recipients will showcase".
A grant accepted in late September is very unlikely to present in this edition. Ask to be considered
for the next one; do not promise Demo Day in any announcement.

---

## Application answers

**Company one-liner**

> three.ws turns a text prompt or photo into a rigged 3D AI agent that speaks, gestures, and reacts on
> any web page.

**What are you building?**

> three.ws is an open-source platform for embodied AI agents. A user describes a character, gets a
> textured and rigged 3D avatar, gives it a mind and a voice, and embeds it on any site with one web
> component. ElevenLabs is integrated into that agent flow: speech synthesis through our TTS proxy,
> instant voice cloning from a short recording, the public Voice Library, and per-agent voices, with
> Flash v2.5 as the default model for low latency and Turbo v2.5 and Multilingual v2 selectable. The
> audio drives the visible performance: the avatar's mouth follows the speech in real time through
> viseme lip-sync, so the voice becomes a face and body rather than an audio track beside a character.

**How do you use (or plan to use) ElevenLabs?**

> Today ElevenLabs runs on a bring-your-own-key basis: a user pastes their ElevenLabs key and every
> synthesis and clone runs on their account. The integration is complete in production code (shared
> client, cached voice catalog, cloning through the official SDK, voice deletion, per-agent voice
> keys). The grant would fund the platform lane, so any visitor can hear an ElevenLabs voice on a
> 3D agent without their own account. We would use it for three things: default voices for public
> demo agents, voice cloning for creators, and a public browser demo where a cloned voice drives a
> rigged avatar in real time.

**Business model and growth**

> Voice is already priced: $0.50 per clone and $0.30 per 1,000 characters on the ElevenLabs lane,
> charged to a prepaid credit balance, alongside paid 3D generation and pay-per-call tools for
> agents. Across the platform, 74,846 avatars and 3,817 agents exist and 632 widgets are embedded on
> other sites (public stats, 2026-09-16). Growth comes from embeds: every embedded agent that speaks
> with a premium voice is a metered, repeat use.

**Team:** owner writes (names, roles, and headcount are not in the repo).

**Anything else**

> We would welcome consideration for a future Startup Grants Demo Day with the jump from voice agent
> to visible digital human.

---

## Packet fields

**One-sentence pitch:** ElevenLabs voices that drive a visible 3D body, embeddable on any web page,
from a platform whose integration is finished and waiting on a platform key.

**100-word abstract:** three.ws turns a prompt or photo into a rigged, embeddable 3D AI agent. Its
production code integrates ElevenLabs speech synthesis, instant voice cloning, the Voice Library, and
per-agent voices, defaulting to Flash v2.5 for real-time lip-synced avatars. Today the lane runs only
with a user's own ElevenLabs key, because the platform has no ElevenLabs account of its own. A Startup
Grant would switch on the platform lane for every visitor, power voiced demo agents, and fund a
public browser demo where a cloned voice drives a rigged avatar. Voice is already monetized at $0.30
per 1,000 characters and $0.50 per clone.

**Working link:** https://three.ws/voice (200 on 2026-09-16)

**Screenshot:** [images/voice-lab-elevenlabs.png](images/voice-lab-elevenlabs.png), captured 2026-09-16.
Alt text: "The 'Use Your Own ElevenLabs Key' section of three.ws Voice Lab, listing per-clone and
per-character pricing and an API key field."

**Founder bio:** not in the repo; owner supplies for the Team field.

**Two proposed dates:** not applicable (rolling application, no meeting requested).

**Requested action:** award a Startup Grant to three.ws.

**Approved relationship wording:** there is **no relationship with ElevenLabs**. Say "three.ws integrates
the ElevenLabs API". After acceptance, say "three.ws received an ElevenLabs Startup Grant" and nothing
stronger. Note that the grant terms license ElevenLabs to use the three.ws name and logo for promotion.

## Metrics used

| Metric | Value | Source | Captured |
|---|---|---|---|
| ElevenLabs lane state | `available: false`, BYOK only | `https://three.ws/api/tts/catalog` | 2026-09-16 |
| Voices available without a key | 357 across 3 providers | Voice Lab page header | 2026-09-16 |
| ElevenLabs pricing on platform | $0.50 per clone, $0.30 per 1,000 characters | Voice Lab page copy | 2026-09-16 |
| Avatars / agents / embedded widgets | 74,846 / 3,817 / 632 | `https://three.ws/api/platform/stats` | 2026-09-16T16:02Z |
| ElevenLabs characters synthesized or clones made | **Not measured.** No usage export exists and BYOK calls bill the user's own account | n/a | n/a |
