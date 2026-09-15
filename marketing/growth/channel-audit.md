# Channel and content audit

This audit separates **published**, **automatic**, **prepared**, and **unclaimed** surfaces.
That distinction matters: a finished draft is inventory, not reach; a shipped manifest is a
technical prerequisite, not a listing; a three.ws-owned partner page is not partner validation.

## Current distribution system

| Surface                                                 | Control                               | Current evidence                                                                  | Best use                                                    | Next move                                                                        |
| ------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `three.ws/news`, blog, timeline, and press pages        | Owned                                 | Live site and repo-backed content                                                 | Canonical campaign pages and durable proof                  | Give every anchor campaign one canonical URL                                     |
| Changelog, JSON/XML feeds, and Telegram release channel | Owned, automated                      | 3,000+ changelog entries; deploy-driven Telegram publishing                       | Shipping velocity and holder confidence                     | Summarize into one weekly digest; do not make followers parse every change       |
| `@trythreews` on X                                      | Owned                                 | 214 original archived posts through 2026-08-12; 158 have usable engagement counts | Anchor posts, partner tags, clips, fast community feedback  | Refresh the archive, then measure each new campaign at seven days                |
| three.ws X Community                                    | Owned                                 | Listed in `docs/community.md`                                                     | Creations, event coordination, community prompts            | Give members an artifact or challenge, not a duplicate corporate post            |
| Telegram community                                      | Owned                                 | Listed in `docs/community.md`                                                     | Real-time event and product discussion                      | Pin one weekly roundup with links and next actions                               |
| GitHub repo, Discussions, Issues, Releases              | Owned on GitHub                       | Public Apache-2.0 repo, curated issues, seeded Discussions                        | Contributors, technical authority, release proof            | Use Open Source Friday to convert viewers into claimed issues and PRs            |
| RSS                                                     | Owned, automatic                      | Curated feed at `/rss/announcements.xml`                                          | Syndication and canonical distribution                      | Add every externally published partner article to the curated feed               |
| HackerNoon                                              | Partner/media, automatic draft import | RSS import and live editorial coverage documented                                 | Searchable founder/developer reach                          | Turn only proven anchor stories into HackerNoon drafts; preserve canonical links |
| IBM Community user group                                | Partner-owned, team-operated          | 17 members, 5 blogs, 8 catalogued threads, 2 past events at 2026-09-10 snapshot   | Enterprise discussion, events, IBM employee participation   | Schedule the second event and publish the finished governed-agents post          |
| NVIDIA Developer Forums                                 | Partner-owned, self-serve             | Two published technical posts                                                     | GPU/AI developer proof that NVIDIA teams can safely amplify | Publish the finished browser-digital-human post, then the fleet post             |
| AWS Builder Center                                      | Partner-owned, self-serve             | Two team articles plus one AWS-authored piece documented in the repo              | Practical cloud engineering                                 | Publish article three; reserve launch copy for the Marketplace announcement      |
| OpenAI Developer Community                              | Partner-owned, self-serve             | Two complete drafts in the repo                                                   | Apps SDK, MCP, and spatial-tool implementation              | Publish on a measured cadence around Showcase/directory submission               |
| Hugging Face organization                               | Ecosystem-owned                       | Two articles, an avatar model repo, and an interactive Space                      | Inspectable AI/3D proof                                     | Publish the feedback-loop article and apply for a Space GPU grant if needed      |
| Alibaba Cloud Marketplace/blog                          | Partner-owned                         | Marketplace listing, storefront, and editorial feature documented                 | APAC distribution and Qwen story                            | Pitch a technical follow-up with usage proof rather than another launch post     |
| pump.fun project page                                   | Ecosystem-owned                       | Verified $THREE page and feature article                                          | Canonical token identity and utility education              | Refresh only for a material new utility milestone                                |
| Directories and catalogs                                | Third-party                           | Mixed: some live, some prepared, some only have manifests                         | Search/discovery and procurement                            | Work from `opportunities.csv`; record a live URL, not “submitted”                |

## What actually worked

The X archive is the only cross-post quantitative dataset currently in the repo. Its
strongest repeatable patterns are:

1. **Partner plus community plus visible event.** The IBM in-world meetup announcement was
   the best measured post: 359 engagements and 41 replies.
2. **Third-party verification.** A verification announcement with a partner tag reached 266
   engagements.
3. **Official ecosystem placement.** The official MCP Registry announcement reached 241.
4. **A concrete payment demo with links.** The x402 proof post reached 197.
5. **Explicit anticipation of co-marketing.** “More co-marketing with IBM coming” reached 168
   despite containing no media, showing how strongly the community values the relationship.
6. **A tangible developer inventory.** The npm package roundup reached 111.

The lesson is not “post about partners constantly.” It is that outside validation makes a
technical claim legible. A partner logo without proof will decay quickly; a partner-domain
link, a working demo, and a community event compound.

## What underperformed

- Text-only posts had a median of 11 engagements, below the corpus median.
- Replies had a median of 5; use replies to deepen a live conversation, not as the main
  distribution format.
- Generic questions did not create engagement in the sample. Ask for an action tied to a
  real artifact instead.
- Video as a category did not outperform in the historical sample, but the sample was only
  six posts. The correct response is better first frames and shorter standalone proof, not
  abandoning video.
- The account published heavily: 64 original posts in June and 56 in July. But the top 10% of
  posts produced 49.4% of engagement. Fewer anchor stories with coordinated distribution are
  a better use of the inventory.

## Reusable campaign inventory

Priority is based on proven audience fit, partner amplification potential, readiness, and
whether the story can carry a real $THREE or community action.

| Priority | Story to push again                    | Existing proof/assets                                                           | New angle                                                            | Partner ask                                                         |
| -------: | -------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
|        1 | GitHub Open Source Friday approval     | Approved issue, full stream plan, announcement pack, curated first issues       | “Claim the convention we will implement and review live”             | Book date; request official social card and live/replay posts       |
|        2 | Second IBM in-world community event    | First event recap, world, spatial voice, event readiness suite, IBM group       | “A user group meeting where the venue is the demo”                   | IBM speaker, event-calendar listing, announcement comment/repost    |
|        3 | OpenAI 3D Studio                       | Select Partner kit, press release, two community drafts, live keyless connector | “Create and manipulate a real 3D object inside the conversation”     | Showcase/directory placement and partner-portal GTM contact         |
|        4 | NVIDIA browser-native digital human    | Finished forum draft, Audio2Face demo, Inception assets                         | “Facial animation streamed to a visitor-generated rig in a browser”  | Forum visibility, Inception reshare, Startup Showcase consideration |
|        5 | $THREE utility series                  | `$THREE` thesis, token page, live utility endpoints                             | One shipped utility and one action each week                         | Applicable integration partner comments on the technical primitive  |
|        6 | AWS procurement launch                 | Marketplace backend, listing kit, three Builder Center articles                 | “Enterprise procurement in front of agent-native pay-per-call usage” | Pre-publication brand review and post-launch AWS repost             |
|        7 | x402 economy proof                     | Milestone videos, public stats, endpoint catalog, receipts                      | “What autonomous agents actually paid for this week”                 | Coinbase Developer Platform showcase / Founders Fuel amplification  |
|        8 | Hugging Face open 3D stack             | Two published articles, model repo, live Space, finished feedback-loop draft    | “Inspect the model, rig, demo, and code in one tab”                  | Community feature or Space GPU-grant review                         |
|        9 | NVIDIA Inception membership            | Complete announcement copy and graphics; never posted                           | Membership as the start of a GPU engineering series                  | Inception social reshare after asset approval                       |
|       10 | Android / Solana Mobile product        | Signed app, launch kit, device captures                                         | “Make an avatar from a phone and take it into a live world”          | Store feature or ecosystem roundup                                  |
|       11 | First 19 weeks / open-source ecosystem | 40+ visual assets, product map, GitHub proof                                    | Quarterly “what shipped” with a contributor call, not a feature dump | GitHub/open-source community amplification                          |
|       12 | Agent embed and 3D utility             | Product demo, `<agent-3d>` examples, Rig Doctor                                 | A partner-specific embedded avatar built live                        | Partner showcases the result on its own site or docs                |

## The unannounced backlog

The [announcement coverage ledger](../../docs/announcement-coverage.md) already did the hard
inventory work. Its snapshot includes:

| Section               |   Pages | Never announced |
| --------------------- | ------: | --------------: |
| Main product surfaces |      51 |              33 |
| Creation/build tools  |      59 |              34 |
| Labs                  |      20 |              16 |
| Agent economy         |     134 |              83 |
| **Total**             | **264** |         **166** |

Do not publish 166 feature posts. Bundle them into twelve audience-shaped stories:

- one avatar from prompt to website;
- the browser-native digital-human pipeline;
- inspect, validate, repair, and animate any rig;
- build a 3D scene with an agent;
- a live world as a community venue;
- accessibility through signed 3D communication;
- agents that discover and pay for tools;
- verifiable agent identity and reputation;
- the $THREE utility stack;
- mobile creation and AR;
- the open-source contributor path;
- the production infrastructure behind free creation.

Each bundle can support a partner-domain article, a demo clip, an event segment, a community
challenge, and an evergreen page without repeating the same body.

## Republish rules

Before reusing any existing piece:

1. Re-run the live proof and update every number and status.
2. Pick a new audience and rewrite the opening for that audience.
3. Preserve one canonical URL and use canonical tags where the venue supports them.
4. Replace “we launched” with the result, lesson, or next capability.
5. Use a new visual cut or current screenshot.
6. Give the partner 48 hours to review any co-branded claim or asset.
7. Record the final live URL and seven-day result in the trackers.

## Gaps to close

- The X dataset ends on 2026-08-12. Refresh it before using absolute engagement targets.
- Several timeline milestones lack `source_url` values, including high-value partner social
  interactions. Recover and archive those links.
- Partner announcements are tracked across several docs, but partner **responses** are not.
  `opportunities.csv` now carries the success evidence for that purpose.
- Telegram has reach but no structured campaign-level measurement. Use tracked links and one
  weekly roundup.
- The IBM catalog snapshot contains a partial fifth blog entry. Complete the URL, author,
  date, and activity record before citing it in outreach.

Last audited: **2026-09-15**.
