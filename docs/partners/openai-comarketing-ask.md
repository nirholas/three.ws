# OpenAI co-marketing ask

**Stage:** drafted 2026-11-11, awaiting owner send · **To:** the OpenAI Partner Network contact on the
provisioning thread (or the OPN portal's partner support form)
· **Context:** [openai-partner-benefits-2026.md](./openai-partner-benefits-2026.md)

Why this exists: the Select Partner announcement alone (2026-07-15) moved meaningful $THREE volume
with no help from OpenAI. Co-marketing is a stated Select tier benefit, and we have never asked for it.
OpenAI's social team shares builder stories that make their platform look good, so the ask gives them
one, tied to a concrete milestone, rather than asking for a post.

## Sequence

1. Accept the OPN invitations. **Done** (on or before 2026-11-11).
2. Create `OPENAI_PARTNER_API_KEY` in the partner API organization. Keep it separate from production
   `OPENAI_API_KEY` (usage rule in the benefits page).
3. Resubmit the ChatGPT app as v1.0.1. The 40-second call-budget fix is in production, and
   `https://three.ws/api/mcp-chatgpt` answered `initialize` and listed 8 tools on 2026-11-11 (it still
   reports 1.0.0, so bump the version). Steps: [owner-day-2026-10-09.md](./owner-day-2026-10-09.md),
   record in `prompts/store-submissions/_generated/openai-submission.md` section 0.
4. Submit the Showcase at https://openai.com/form/showcase-submission/ with
   `prompts/store-submissions/_generated/openai-showcase-submission.md`.
5. Send the email below the same day as step 3 or 4, so the ask carries a fresh milestone.
6. Post [the partner benefits announcement](../announcements/openai-partner-benefits.md) once OpenAI
   replies, so their reshare (if they agree) lands on a new post. If no reply in a week, post anyway.

## Email

> **Subject:** three.ws (Select Partner): co-marketing on our ChatGPT 3D Studio launch
>
> Hi,
>
> Thanks for provisioning our 2026 program-year benefits. We have accepted both invitations.
>
> We are about to relaunch the three.ws 3D Studio app for ChatGPT: you type a sentence in ChatGPT and
> get back a textured, downloadable 3D model in an interactive viewer, free, no key and no account.
> It runs on a public OAuth 2.1 MCP server that is already live at three.ws/api/mcp.
>
> We would like to use the Select tier co-marketing benefit around this launch. Concretely:
>
> 1. A reshare or quote from an OpenAI account (OpenAI Developers fits best) when the app is live.
>    We will send the post and a 15-second clip in advance for review.
> 2. Consideration for the Developer Showcase, which we have submitted.
> 3. Anything the Partner Network runs for Select partners: a partner spotlight, a newsletter
>    slot, or a customer story once we have 30 days of usage numbers.
>
> We describe the relationship as "OpenAI Select Partner" everywhere and never imply endorsement.
> Happy to follow whatever review process your team uses for partner content.
>
> Thanks,
> three.ws team · support@three.ws
