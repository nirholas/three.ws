# Reply to the "14 free GitHub repos" Grok toolkit post (2026-11-27)

A reply from @trythreews to @akarixbt's post of 2026-11-27, which lists 14 free GitHub repositories that take a Grok user from a prompt to a shipped product. Not posted yet. Posting is an owner step.

The page the reply links to is [docs/grok-toolkit.md](../grok-toolkit.md). It is live at `https://three.ws/docs/grok-toolkit` only after the next production deploy, so the reply goes out after that deploy, not before.

## The post we are replying to

> 14 free GitHub repos that turn your Grok Bot into a whole dev company.
>
> Brain → build → fleet → company → shipped.

The list: xai-org/grok-prompts, xai-org/grok-build, xai-org/plugin-marketplace, xai-org/xai-sdk-python, xai-org/xai-sdk-ts, xai-org/xai-cookbook, xai-org/grok-build-plugin-cc, stablyai/orca, slopus/happy, milind-soni/OpenMausBot, Anil-matcha/suparagent, FoundationAgents/MetaGPT, OpenHands/OpenHands, BerriAI/litellm.

## The reply

**Recommended (opening fits 280 characters, one link):**

> We spent today on this list with one question: what does each of the 14 need to get 3D?
>
> One free MCP server covers all of them. A Grok Build plugin. Examples on both xAI SDKs. A cookbook recipe. An Orca plugin. An mcp.toml for Happy. A LiteLLM gateway config. A three-role MetaGPT team where Grok looks at the render and sends it back.
>
> What ran, what didn't, and the command for each: https://three.ws/docs/grok-toolkit?utm_source=x&utm_campaign=grok-toolkit&utm_content=reply

**Short alternate (no link, for speed and reach):**

> We went down this list today and gave every repo on it 3D: a Grok Build plugin, examples on both xAI SDKs, an Orca plugin, a LiteLLM gateway config and a MetaGPT team where Grok reviews the render.
>
> One free MCP server behind all of it: three.ws/api/mcp-studio

## Media

Attach the reel. It is a real render, not a mock-up: the chair is the catalog model Grok returned in the recorded runs through xAI's TypeScript SDK and through the LiteLLM proxy, and every frame of the turntable came from the public production render endpoint.

- Video: [public/x-media/grok-toolkit/reel.mp4](../../public/x-media/grok-toolkit/reel.mp4) (1920x1080, H.264, about 10 seconds, no sound).
- Still, if a video cannot be attached: [public/x-media/grok-toolkit/card.png](../../public/x-media/grok-toolkit/card.png).
- Rebuild both: `node scripts/grok-toolkit-reply-media.mjs`.

The card carries the three.ws lockup only. It does not use the Grok or SpaceXSI marks: this is a reply under a third party's post, not program material.

## Tags

None in the reply. It already sits under the author's post, and tagging @grok would start a Grok answer under ours. If a tag is wanted, tag a company account for a project on the list, never a person, and check the handle on X first. No handle was checked for this draft.

## Follow-up when the listings land

Reply to our own reply once each of these is public, one post per item, each with its own link:

1. The plugin in xAI's plugin marketplace (`grok plugin install three-ws`).
2. The recipe in the xAI cookbook.
3. The Suparagent community listing.

## Facts this rests on

All from [docs/grok-toolkit.md](../grok-toolkit.md), checked on 2026-11-27:

- The 14 repositories exist (GitHub API).
- `grok plugin validate` accepts the Grok Build plugin, and xAI's marketplace scripts accept the catalog entry on a fresh clone. The entry is not submitted.
- The Python and TypeScript SDK examples, the LiteLLM gateway and the MetaGPT team each made a full Grok run against production and returned a real model. `npm run grok:examples-smoke -- --all` repeats it.
- The MetaGPT Reviewer judged four rendered views of the model through `look_at_model`, signed in to a free account.
- The cookbook's own builder accepts the recipe. The pull request is not open.
- The Orca manifest, the Happy `mcp.toml` and the Suparagent listing pass each project's own parser or validator. None of those apps was launched, and neither was OpenMausBot or OpenHands.

## Wording rules

- "Gave every repo 3D" and "covers all of them" mean a three.ws file, example or entry exists for each and was checked. Do not say "integrated with", "listed in", "merged" or "available in" for the marketplace, the cookbook or any directory until that listing is public.
- Do not say any of these projects works with us, endorses us or partnered with us. Do not mention the Grok for Startups program in this reply.
- Never tag @bot or @grok. No hashtags, no emoji, no dashes. Never mention any coin, contract address, price or trading.
- Making, rigging or rendering views of a model needs a free three.ws account. "Free" is true; "no account" is true only for catalog search and the docs.
