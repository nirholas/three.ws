# OpenAI "Share your story" submission

**Target:** OpenAI Stories (the form feeds the "Discover other stories" collection on openai.com)
**Verified intake:** https://openai.com/form/share-your-story/ (rendered in a real browser 2026-09-16;
plain HTTP clients get a 403, so open it in a normal browser)
**Deadline:** none on the form. Pipeline target is **2026-10-09**, after the Showcase and App Directory
submissions ([opportunities.csv](../growth/opportunities.csv)).
**Owner's one step:** after the ChatGPT App Directory review returns (submitted 2026-09-12, version
1.0.0, status Review per [TRACKER.md](../../prompts/store-submissions/_generated/TRACKER.md)), fill in
first name, last name, email, city and state, paste the four answers below, and submit.

**Why wait for the review outcome:** the form asks how OpenAI products "helped". The strongest honest
answer is a live directory listing plus usage that came through it, and neither exists yet (see
"What cannot be measured yet").

---

## What the form asks (read live 2026-09-16)

Intro: "We're collecting real stories from people using OpenAI products - what you're building,
learning, or figuring out along the way."

| Field | Required | Limit |
|---|---|---|
| First name, Last name, Email, City, State | Yes | |
| Is this story about: You / Someone you know | Yes | |
| Tell us about yourself or the person this is about | Yes | 1000 characters |
| How do you/they use OpenAI products? | Yes | 1000 characters |
| How has using OpenAI products helped you/them? | Yes | 1000 characters |
| What makes your/their story special? | Yes | 1000 characters |
| Any links you'd like to share? | No | |
| Consent: contacted by OpenAI, submission used under its Privacy Policy | By submitting | |

This is a **personal** story form, not a company case-study intake. Write it as the founder's story.
The City and State fields assume a US location; the founder's location is not recorded in the repo.

---

## The answers (each checked under 1000 characters)

**Is this story about:** You

**Tell us about yourself or the person this is about** (528 characters)

> I build three.ws, an open-source platform that gives AI a body. You type a sentence and get a
> textured, rigged 3D character you can animate, place in your room in AR, or embed on any web page
> with one tag. Making a 3D asset has traditionally meant specialist software and skills, while AI
> assistants mostly answer in flat text. I want anyone who can describe a thing to be able to hold it,
> move it, and share it. The platform is free to try with no account or API key, and the viewer,
> runtime, and web component are open source.

**How do you/they use OpenAI products?** (676 characters)

> Two ways. First, as a distribution surface: we built a free 3D Studio connector for ChatGPT on the
> Apps SDK and MCP. It gives ChatGPT eleven keyless tools that generate a 3D model from a prompt,
> inspect it, rig and animate a character, and hand it off to AR, with an interactive viewer rendered
> inline in the conversation. The same capability ships as a custom GPT in the GPT Store. We are an
> OpenAI Select Partner in the OpenAI Partner Network, and the connector is in App Directory review.
> Second, inside the product: OpenAI models are lanes in our model router for agent chat and
> embeddings, and OpenAI voices are one of the text-to-speech options an avatar can speak with.

**How has using OpenAI products helped you/them?** (668 characters)

> It changed who can reach 3D. Before the connector, making a model meant finding our site and
> learning an interface. Inside ChatGPT, someone describes an object in the conversation they are
> already having, turns it in their hands a couple of minutes later, and can place it on their desk in
> AR from their phone. Across all our surfaces, people have started 39,675 generations since June
> 2026 and 33,941 of them finished as downloadable 3D models. Building to the Apps SDK review bar also
> made the product better everywhere: we wrote honest loading, error, and timeout states, removed
> anything that needed a key or a wallet from the free path, and documented every tool.

**What makes your/their story special?** (569 characters)

> 3D is usually the last thing people expect a chat assistant to do, and the hardest to do well:
> meshes, textures, skeletons, and animation all have to work, not just look right in a thumbnail. We
> made it free and keyless on purpose so that a student, a teacher, or a small shop owner can try it
> without a card or an account. We also published the open response shape the connector uses, Spatial
> MCP, under CC0 so any assistant can render 3D results the same way. The goal is not a demo: it is
> making "describe it, then hold it" an ordinary thing to do in a conversation.

**Any links you'd like to share?**

> https://three.ws/openai
> https://chatgpt.com/g/g-6a563a3b49a88191abf346245491a444-three-ws-3d-studio
> https://three.ws/docs/mcp-studio
> https://github.com/nirholas/three.ws

All four returned 200 on 2026-09-16.

**Before submitting, re-check two sentences:** "the connector is in App Directory review" (change to
"listed in the ChatGPT app directory" with the listing URL once approved, or delete if rejected), and
the generation counts (re-run the query below on submission day).

---

## Metrics, with source and capture date

| Metric | Value | Source | Captured |
|---|---|---|---|
| Generations started, all surfaces | 39,675 since 2026-06-11 | Production database, `select count(*) from forge_creations` (not a public URL) | 2026-09-16 |
| Generations finished as a model | 33,941 (5,732 failed, 2 in progress) | Same table, grouped by `status` | 2026-09-16 |
| Generations in the last 30 days | 22,638 | Same table, `created_at > now() - interval '30 days'` | 2026-09-16 |
| Avatars, agents, embedded widgets | 74,846 avatars, 3,817 agents, 632 widgets | `GET https://three.ws/api/platform/stats` (public) | 2026-09-16T16:02Z |
| Tools in the keyless ChatGPT connector | 11 | [TRACKER.md](../../prompts/store-submissions/_generated/TRACKER.md), live `tools/list` | 2026-09-09 |
| Keyless end-to-end generation through the connector | 5.40 MB GLB in 137 s | Same tracker row | 2026-09-09 |
| Custom GPT publicly reachable | Yes, logged out | `curl` returned 200 | 2026-09-16 |

## What cannot be measured yet

- **ChatGPT-attributed usage.** The connector does not tag creations it starts
  (`api/_mcp-studio/forge-client.js` supports an `x-forge-client` key, but no caller passes it), and a
  Cloud Run log sample of 20,000 `POST /api/mcp-studio` requests between 2026-09-15T23:51Z and
  2026-09-16T16:02Z contained no user agent naming OpenAI or ChatGPT. The 39,675 figure is
  platform-wide and the answer says so. Do not rewrite it as "through ChatGPT".
- **Directory listing outcome.** In review since 2026-09-12.
- Founder name, city, and state are not in the repo.
- **Founder voice.** The answers are written in the first person from repo facts only. The founder
  should add one personal sentence of their own (why they started, or a real user moment) rather than
  accept a motive written for them. If they add a personal use of ChatGPT or Codex, it must be true.

---

## Packet fields

**One-sentence pitch:** a founder who made 3D creation free and keyless inside ChatGPT, so anyone who
can describe an object can hold it, animate it, and place it in their room.

**100-word abstract:** three.ws is an open-source platform that turns a sentence into a textured,
rigged 3D character. Its founder built a free 3D Studio connector for ChatGPT on the Apps SDK and MCP:
eleven keyless tools that generate, inspect, rig, animate, and place models in AR, rendered inline in
the conversation. The same capability runs as a public custom GPT. Across all surfaces, 39,675
generations have started since June 2026 and 33,941 finished as downloadable models. three.ws is an
OpenAI Select Partner and published Spatial MCP, the CC0 response shape the connector uses, so any
assistant can render 3D results.

**Working link:** https://three.ws/openai

**Screenshot:** [images/openai-page.png](images/openai-page.png), captured 2026-09-16. Alt text: "The
three.ws OpenAI page headed '3D, natively, inside ChatGPT' with the OpenAI Select Partner badge and a
'Connect it to ChatGPT' button." The form has no upload field; keep it for the follow-up if OpenAI's
editorial team replies.

**Speaker/founder bio:** the first answer above doubles as the bio.

**Two proposed dates:** not applicable (no meeting requested).

**Requested action:** consider the story for OpenAI's stories collection.

**Approved relationship wording** (from [docs/press-kit.md](../../docs/press-kit.md)): write the status
as "OpenAI Select Partner", never "partnered with OpenAI on" a product. Independence line: three.ws is
an independent member of the OpenAI Partner Network at the Select tier: not an OpenAI product, and not
endorsed by OpenAI beyond the partner designation shown.
