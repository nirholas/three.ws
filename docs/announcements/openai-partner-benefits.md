# Announcement pack: OpenAI Partner Network 2026 program year

**Surface:** [`/openai`](https://three.ws/openai) · **Stage:** drafted, awaiting approval to post
· **Announced externally:** never · **Internal record:** [openai-partner-benefits-2026.md](../partners/openai-partner-benefits-2026.md)

Written against [the announcement voice](../announce-voice.md). Partner news, so it is long, tags
no one, and links the surface once.

## The claim, and where it is checked

> The OpenAI Partner Network opened our 2026 program year as an OpenAI Select Partner, with a
> dedicated API organization and a ChatGPT workspace with Codex credits, for the full program year.

| Part of the claim | Where it is real |
|---|---|
| OpenAI Select Partner | Partner tier "Select" in the provisioning notice of 2026-10-11; page [`/openai`](https://three.ws/openai) |
| Program year through June 2027 | Notice: 2026-07-01 to 2027-06-30 |
| Dedicated API organization and ChatGPT workspace with Codex credits | Notice: separate API organization and ChatGPT workspace, with API and ChatGPT/Codex credits. Amounts are left out on purpose. |
| Testing and validating the 3D Studio connector, customer proofs of concept, demos | The five permitted activities in the notice; connector is live ([mcp-studio.md](../mcp-studio.md)) |

## Posting rules specific to this pack

- Say "OpenAI Select Partner" exactly. Never "endorsed by", "official OpenAI", or a claim of an
  OpenAI-built product. three.ws is an independent member of the network.
- Do not state credit amounts, the organization ID or the workspace ID.
- Do not say the credits power three.ws production. They are for approved partner activities only.
- Attach the existing card `social-card-announcement.png` (see
  [social copy](../../marketing/openai-select-partner/social-copy.md)), with alt text:
  "three.ws, OpenAI Select Partner, OpenAI Partner Network."
- Tagging @OpenAI is true but turns this into a person-approved post; leave it off unless the owner
  wants it.

## Community variant

Same facts, friendlier opening, for the Discord and Telegram communities:

> Good news for builders: three.ws has started its 2026 program year in the OpenAI Partner Network
> as a Select Partner. That brings a dedicated API organization and a ChatGPT workspace with Codex
> credits, valid for the full program year. We will use them to keep the free 3D Studio connector sharp in
> ChatGPT, build proofs of concept with customers, and demo embodied 3D agents live. Try the
> connector with no key and no account: three.ws/openai

## Ship

```bash
node scripts/post-tweet.mjs --file docs/announcements/openai-partner-benefits.post.txt --dry-run
```
