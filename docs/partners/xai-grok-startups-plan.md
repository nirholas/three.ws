# Grok for Startups: what we build and how we get amplified

**Stage:** mapped 2026-11-20, the day three.ws was admitted to xAI's Grok for Startups program.
**Tracker row:** `xai-grok-for-startups` in [data/partner-programs.json](../../data/partner-programs.json)
(status `member`, credits `claimable`). **Work orders:** the `grok-startups-` campaign,
`prompts/finish/871` to `886`, context in
[prompts/finish/_context/grok-startups-00-CONTEXT.md](../../prompts/finish/_context/grok-startups-00-CONTEXT.md).

This page maps every surface where membership can turn into product, distribution or attention. It
covers xAI (now operating as SpaceXSI, "SpaceX Super Intelligence"), Grok, Grok Bot, Grok Build,
Cursor (which SpaceX is acquiring), X, and Elon Musk's own account. Each route says what we build,
what xAI or X gets out of resharing it, who owns the last step, and how we measure it.

## What membership actually gives us

Verified against the program page, third-party writeups of the program terms, and our acceptance
email (2026-11-20):

| Benefit | Detail | What we do with it |
|---|---|---|
| One credit balance | Shared across the Grok API, Grok, Grok Build and Grok Bot | Fund the Grok lanes we already built and the new ones below |
| Staged release | 20% on approval, 80% after onboarding | Owner completes onboarding (owner action 1 below) |
| Expiry | Credits expire 6 months after issue | Order 878 tracks burn against expiry so none is wasted |
| Direct line to the startups team | Hands-on onboarding and a contact as we grow | Order 882 uses it for the co-marketing ask |
| Co-marketing | **Not a listed benefit.** No source names a showcase, spotlight or marketing perk | We earn it: give xAI's accounts things they want to reshare |

Never publish the credit amount or the team ID (program confidentiality and our own rule).

## The amplification thesis

Partner value for three.ws is social amplification: a reshare from an account with a large,
engaged audience moves attention to the platform (see the partner-value note in the owner's
records: IBM, OpenAI and Microsoft announcements were ranked by logo and engagement). xAI and its
people reshare three kinds of posts:

1. **Their product doing something new.** A Grok model, Grok Imagine, Grok Voice or Grok Bot doing
   a thing nobody has shown yet, with a clip. xAI's developer relations staff publicly repost
   connectors and plugins from the marketplaces they run.
2. **Their marketplaces filling up.** The Grok Bot marketplace (opened 2026-10-14) and the Grok
   Build plugin marketplace (opened 2026-06-11) have no 3D plugin. The first good one is news for
   the people who launched them.
3. **Space and engineering spectacle.** Elon Musk regularly amplifies striking visualizations of
   Starship and Raptor engineering and creative Grok Imagine output. An interactive, accurate,
   beautiful 3D cutaway is the format that travels.

Every build below is chosen to land in one of those three buckets and to leave a measured number
behind, because "Grok did X in Y seconds for Z users" is the sentence that gets reshared.

## Map 1: build lanes

### A. Distribution surfaces (plugins, connectors, marketplaces)

| # | Surface | State today | What to build | Order |
|---|---|---|---|---|
| A1 | **Cursor plugin** `integrations/cursor/three-ws` | v1.1.0 exists, OAuth to `mcp-studio`, skills; not submitted | Pass Cursor's review checklist mechanically (manifest schema, every `${VAR}` declared, logo, open-source standalone repo, reviewer sign-in path), add rules and commands, export a standalone public repo tree | 871 |
| A2 | **Grok Build plugin** `integrations/grok/three-ws` | Exists; README still says "no account", which is wrong since the free lane needs an account | Fix the copy, pass `xai-org/plugin-marketplace` validators, add an agent and hooks, a GROK.md harness file, live install test with the open-source Grok Build CLI | 872 |
| A3 | **Official Grok Bot marketplace** (x.ai/bot/marketplace/submit-a-plugin) | **Missing from our listings plan.** The form lists a plugin or MCP server for Grok Bot, Cursor and (soon) Grok | Full submission package: 1:1 logo, org handle, testing instructions with a working reviewer sign-in, plus Grok Bot task templates and the grok.com custom-connector path | 873 |
| A4 | Third-party directories (13 rows) | Prepared, awaiting owner approval | Nothing new: order 929 owns it | 929 |
| A5 | **three.js craft pack for Grok Build** | Nothing; the marketplace has no 3D or three.js category entry | A second, account-free Grok Build plugin of three.js, GLB and WebGL skills that routes heavy work to three.ws. Widest adoption, zero sign-in friction | 885 |

### B. xAI API capabilities we have not used yet

| # | Capability | Fact (re-verify before building) | Build | Order |
|---|---|---|---|---|
| B1 | **Grok Imagine image** | Image 2.0 serves the image slugs since 2026-11-02 | A Grok Imagine reference-image lane for text-to-3D, evaluated head to head against the current Gemini lane, promoted only where it wins | 874 |
| B2 | **Grok Imagine Video 1.5** | GA as `grok-imagine-video-1.5` and `-lite`; reference-to-video with up to 14 reference images; edit and extend endpoints | Cinematic hero clips of a forged model from its real renders, for model pages and X posts | 875 |
| B3 | **Grok Voice 3.0** | Speech-to-speech realtime; `grok-voice-latest` points to 3.0 since the week of 2026-11-09 | A talking 3D avatar on Grok Voice with real lip sync, as an `<agent-3d>` voice provider and a demo page; plus LiveKit and Pipecat options | 876 |
| B4 | **Responses API remote MCP** | `server_url` and `server_label`; built-in `x_search` tool | Already wired; the live proof waits on the key (order 941). Examples in every major language reuse it | 877 |
| B5 | **Grok 4.7 as a brain** | Flagship for agentic and tool work | Evaluate Grok against our current lanes on real three.ws tasks and route by evidence; publish the eval | 879 |
| B6 | **Credits and usage** | 6-month expiry, staged release | A usage ledger for every xAI call, a burn plan, and expiry alerts, so credits fund quality instead of expiring | 878 |

### C. Apps, examples and owned pages

| # | Build | Why it gets reshared | Order |
|---|---|---|---|
| C1 | **Examples pack**: Python `xai-sdk`, Node, curl and agent-framework examples that drive three.ws from Grok, each runnable and smoke-tested | Developer relations reshares clean, working examples of their API | 877 |
| C2 | **/grok hub** upgraded into the single co-marketing landing page: every Grok surface, install buttons, live usage numbers, approved membership wording | Gives every post and every email one link that proves breadth | 881 |
| C3 | **Share to X with @grok** on every model, avatar and cutaway page, with the player card link | Users post their creations and tag @grok; Grok answers in the thread, in public, on X | 884 |
| C4 | **Rocket engine anatomy**: an accurate interactive cutaway of a full-flow staged-combustion methalox engine and a two-stage super-heavy launch stack, narrated by Grok | Built for the space-engineering audience on X and timed to launch windows, the audience most likely to carry it to SpaceX and Elon Musk's account | 883 |
| C5 | **Connector reliability**: synthetic probe of the Grok-facing MCP surfaces with a public status signal | Marketplace reviewers reject plugins they cannot connect to; uptime numbers make the case study credible | 880 |
| C6 | **Grok 3D starter app**: a forkable, Codespaces-ready app where you chat with Grok, Grok calls three.ws over remote MCP, and the model appears on the page and changes on follow-ups; exported as its own repo like the other satellites | Developer relations reshares something a developer can fork and run in five minutes, not a snippet | 886 |

### D. Co-marketing and asks

The emails, case study, post drafts, asset commands and tracking for this route are in the
[xAI co-marketing kit](./xai-comarketing-kit.md).

| # | Route | Ask | Owner step | Order |
|---|---|---|---|---|
| D1 | Grok for Startups team (direct line) | Reshare from xAI accounts at launch, inclusion in any startup story or showcase, marketplace featuring | Owner sends the prepared email | 882 |
| D2 | xAI developer relations on X | Reshare of the Grok Bot and Grok Build listings once live | Owner posts; tags are nominative | 882, 930 |
| D3 | @grok on X | Users tag @grok on their creations (C3); our own launch thread tags @grok with a question it can answer | Owner posts | 884, 930 |
| D4 | Elon Musk / SpaceX audience | The rocket-engine cutaway posted during a launch window, no ask, no tag spam | Owner posts | 883 |
| D5 | Case study | "How three.ws runs on Grok", with measured numbers from orders 874 to 880 | Owner sends to the startups team once numbers exist | 882 |
| D6 | X platform | Player card approval (931), mention bot (928), X Articles long-form | Owner | 928, 930, 931 |

## Work orders

All sixteen were independent and ran at the same time in separate chats. Every agent-side line is
built and verified, and the orders were archived on 2026-11-21. The steps only the owner can take
(the xAI key, the deploy, public repositories, submissions, email and posts) are tracked row by row
in [prompts/finish/_context/grok-OWNER-ACTIONS.md](../../prompts/finish/_context/grok-OWNER-ACTIONS.md).

| Order | Work order | Routes |
|---|---|---|
| 871 | [Cursor plugin passes Marketplace review](../../prompts/archive/871-grok-startups-01-cursor-plugin-marketplace-ready.md) | A1 |
| 872 | [Grok Build plugin, correct and installable](../../prompts/archive/872-grok-startups-02-grok-build-plugin.md) | A2 |
| 873 | [Official Grok Bot marketplace package, templates, grok.com connector](../../prompts/archive/873-grok-startups-03-official-grok-bot-marketplace.md) | A3 |
| 874 | [Grok Imagine reference-image lane with head-to-head eval](../../prompts/archive/874-grok-startups-04-imagine-reference-image-lane.md) | B1 |
| 875 | [Grok Imagine Video hero clips from real renders](../../prompts/archive/875-grok-startups-05-imagine-video-hero-clips.md) | B2 |
| 876 | [Grok Voice realtime talking avatar, LiveKit and Pipecat](../../prompts/archive/876-grok-startups-06-voice-realtime-avatar.md) | B3 |
| 877 | [Runnable examples pack with smoke test](../../prompts/archive/877-grok-startups-07-examples-pack.md) | B4, C1 |
| 878 | [xAI credit usage ledger, burn and expiry alerts](../../prompts/archive/878-grok-startups-08-credit-usage-ledger.md) | B6 |
| 879 | [Grok 4.7 eval on real tasks, routing by evidence](../../prompts/archive/879-grok-startups-09-grok-eval-and-routing.md) | B5 |
| 880 | [Synthetic connector probe and public uptime](../../prompts/archive/880-grok-startups-10-connector-reliability-probe.md) | C5 |
| 881 | [/grok hub as the campaign landing page](../../prompts/archive/881-grok-startups-11-grok-hub-upgrade.md) | C2 |
| 882 | [Co-marketing kit, startups email, case study, post drafts](../../prompts/archive/882-grok-startups-12-comarketing-kit.md) | D1, D2, D5 |
| 883 | [Rocket engine and launch stack cutaways, Grok narration](../../prompts/archive/883-grok-startups-13-rocket-engine-anatomy.md) | C4, D4 |
| 884 | [Ask @grok share intents on models, avatars, anatomy](../../prompts/archive/884-grok-startups-14-share-to-x-with-grok.md) | C3, D3 |
| 885 | [Account-free three.js craft plugin for Grok Build](../../prompts/archive/885-grok-startups-15-threejs-craft-pack.md) | A5 |
| 886 | [Forkable Grok 3D starter app](../../prompts/archive/886-grok-startups-16-grok-3d-starter-app.md) | C6 |

## Rules that bind every route

- **Approved claim:** "three.ws is a member of xAI's Grok for Startups program." It is a startup
  credit program, not a partnership, investment or endorsement. Never say "partner of xAI",
  "backed by xAI" or "endorsed by SpaceX".
- **xAI-facing copy is token-free.** Plugins, marketplace listings, the email, the case study and the
  cutaway never mention $THREE, a coin, a price or trading. The connectors never expose wallet,
  spend, trade or launch tools (several Grok directories reject crypto-moving tools, and an
  unattended agent must never spend). Our own $THREE posts stay separate from xAI-facing assets.
- **Marks are nominative.** Grok, xAI, SpaceXSI, Cursor, X, Starship and Raptor are named only to
  describe compatibility or a real subject. No xAI, SpaceX or X logo is used unless a published
  brand kit allows it. The rocket cutaway describes the engine cycle generically and cites public
  sources; it is not presented as an official SpaceX asset. The Grok logo the owner approved for
  announcements is `public/marks/grok-full-logomark-light.svg`, and the SpaceXAI wordmark is
  `public/marks/spacexai-wordmark-white-transparent.svg`. Both are unaltered files from the
  `SpaceXAI_Grok_Assets` kit linked at
  [x.ai/legal/brand-guidelines](https://x.ai/legal/brand-guidelines). Those guidelines
  require it exactly as provided, with nothing beside it that reads as a combined mark; the
  announcement card (`node scripts/grok-startups-announce-card.mjs`) follows that.
- **X automation rules.** Reply only when addressed, carry the automated-account label, never
  bulk-tag accounts. A share intent is a user action, never an automated post.
- **Solana first, GCP preferred.** Grok runs where it is the best or the only source; GCP lanes
  remain the default wherever the eval says they are as good.

## Owner actions (in order)

Per-order detail and status: [grok-OWNER-ACTIONS.md](../../prompts/finish/_context/grok-OWNER-ACTIONS.md).

| # | Action | Unblocks | Where |
|---|---|---|---|
| 1 | Complete xAI onboarding in the startups portal | The remaining 80% of credits | Acceptance email |
| 2 | On hold until the spend plan in [docs/grok-roadmap.md](../grok-roadmap.md) is settled (owner decision 2026-11-21). Then create the production API key on the credited team and run `npm run setup:xai-key` | Every live Grok lane (874 to 879), orders 927 and 941 | [order 927](../../prompts/archive/927-x-grok-46-owner-grok-api-key.md) |
| 3 | Record the credit amount and expiry privately: `node scripts/partner-programs.mjs --benefit xai-grok-for-startups --name "Grok API, Grok and Grok Build credits" --state received --note "<expiry only>"` and set the grant amount as a Cloud Run env var (order 878 names it) | Burn tracking | Tracker CLI |
| 4 | Decide the public home for the plugin repos (a GitHub organization reads better to reviewers than a personal account) and push the exported trees | Cursor Marketplace, Grok Bot marketplace, Grok Build PR | Orders 871, 872, 885, 886 |
| 5 | Approve and send the marketplace submissions | Listings | Orders 873, 929 |
| 6 | Send the co-marketing email; approve the X posts | Amplification | Orders 882, 930 |
| 7 | Deploy (`npm run deploy:gcp:full`) once the build orders land | Everything user-facing | Deploy runbook |

## How we measure

| Metric | Source | Target for the case study |
|---|---|---|
| Grok-surface MCP sessions and tool calls per week | `usage_events` filtered on the Grok surfaces | Grows week over week after each listing |
| Marketplace installs | Cursor and Grok Build marketplace counters where shown, plus OAuth sign-ins tagged by client | First 100 |
| Grok Imagine lane win rate | Order 874 eval | Published, whichever way it lands |
| Voice round-trip latency | Order 876 measurement | Published p50 and p95 |
| Credit burn vs expiry | Order 878 ledger | Zero credits expire unused |
| Reshares from xAI, Grok, X or SpaceX-linked accounts | `fetch-x-metrics` cron plus manual log in the tracker | One per launch |
| Connector uptime | Order 880 probe | 99.9% over 30 days |

## Sources

- Program: [Grok for Startups writeup (twitterapi.io)](https://twitterapi.io/blog/grok-for-startups),
  [i10x summary](https://i10x.ai/news/grok-for-startups-xai-credit-program),
  [vandatateam guide](https://vandatateam.com/blog/grok-for-startups)
- Grok Bot marketplace: [submission guide](https://grokbot101.org/learn/submit-to-grok-bot-marketplace/),
  [marketplace explainer](https://grokmag.com/grok-bot/marketplace/)
- Grok Build marketplace: [xAI announcement](https://x.ai/news/grok-plugin-marketplace),
  [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace)
- Cursor: [plugins reference](https://cursor.com/docs/reference/plugins),
  [publisher terms](https://cursor.com/marketplace-publisher-terms)
- xAI API: [video generation docs](https://docs.x.ai/developers/model-capabilities/video/generation),
  [Imagine Video 1.5](https://x.ai/news/grok-imagine-video-1-5), [pricing](https://docs.x.ai/developers/pricing),
  [weekly roundup with Voice 3.0](https://www.bighatgroup.com/blog/xai-weekly-2026-11-09/)
- Company: [SpaceXSI overview](https://theairankings.com/xai/), [SpaceX acquires xAI (Yahoo Finance)](https://finance.yahoo.com/news/factbox-spacex-acquires-xai-key-142912748.html)

Third-party pages were the only readable sources for several lines (x.ai returns 403 to automated
fetches). Every order re-verifies the facts it builds on against `docs.x.ai` in its step 0.
