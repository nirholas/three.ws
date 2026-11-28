# Backlinks and Ahrefs DR4

Ahrefs moved Domain Rating to a new model (DR4) in 2026. three.ws scored 35 on the old model (DR3) and scores 7 on DR4. This page explains the drop, what the codebase now does about it, and the ranked list of link work that still needs a person.

## Why the score fell

DR is Ahrefs' 0 to 100 estimate of a domain's backlink strength. Google does not use it, so the drop changed no rankings by itself. It matters because partners, journalists and link buyers read it as shorthand for authority, and because DR4 was built to track Google ranking positions more closely than DR3 did.

What DR4 changed ([Ahrefs announcement](https://ahrefs.com/blog/domain-rating-dr4/)):

- Links from sites with estimated organic search traffic carry the weight. About half the domains that had a DR3 score have no DR4 score, so a much smaller pool of sites can move anyone's DR.
- Domains Ahrefs labels as spam (a machine-learning classifier since January 2026) lost the most. Non-spam domains moved by close to zero at the median.
- Subdomains are scored on their own links and no longer inherit their root's DR.

A 28-point drop on a site with no spam label means most of what held three.ws at 35 came from domains DR4 no longer counts: directories, aggregators, scraped and mirror pages, and sites without search traffic. The links from real, trafficked sites were worth about a 7.

To see the score yourself, use the [detailed.com DR4 demo](https://detailed.com/dr-v4/) or Ahrefs' free Domain Rating API with `version=dr4`. Ahrefs blocks automated calls to both, so check them in a browser.

## What the codebase does

### Every embed snippet carries a credit link

three.ws hands out copy-paste embed code from about 30 surfaces (Forge, agent share and embed panels, avatar pages, the marketplace, dashboards, widgets, the editor, and the `get_embed_code` MCP tool). Until 2026-11-28 none of it linked back. An `<iframe>` credits the framed page, not the host site, and `<agent-3d>` and `<model-viewer>` carry no anchor, so every embed on a real site counted for nothing.

Every snippet now ends with one visible credit line in the host page's normal flow:

```html
<p style="margin:8px 0 0;font-size:13px;line-height:1.4"><a href="https://three.ws/forge/embed?src=...">Red dragon</a>, forged on <a href="https://three.ws/forge">three.ws</a></p>
```

- One builder owns it: `buildEmbedCredit` in [api/_lib/embed.js](../../api/_lib/embed.js). Model snippets go through `buildModelCredit` ([src/forge-embed-snippets.js](../../src/forge-embed-snippets.js)), agent snippets through `buildAgentCredit` ([src/share-panel-builders.js](../../src/share-panel-builders.js)).
- The anchors are the subject's own name and the brand. Never keywords: Google's link-spam policy names keyword-rich links hidden in widgets, and a branded, visible, removable credit is the pattern CodePen, Sketchfab and Spotify ship.
- The links are followed (no `rel`). The person pasting the code can edit or delete the line.
- oEmbed responses (`/api/oembed`, `/api/play-oembed`, `/api/widgets/oembed`) stay iframe-only. Consumers size the block from the declared height, and WordPress strips anything but the iframe from discovered providers.
- Tests: [tests/embed-credit.test.js](../../tests/embed-credit.test.js) and the per-surface suites beside it.

This compounds. Each creator who embeds a model on a site with traffic adds a referring domain that DR4 counts.

### The backlink readout

```bash
npm run seo:backlinks            # human readout
npm run seo:backlinks -- --json  # machine readable
npm run seo:backlinks -- --url https://example.com/post   # one page
```

[scripts/check-backlinks.mjs](../../scripts/check-backlinks.mjs) fetches every page in [marketing/growth/backlink-placements.json](../../marketing/growth/backlink-placements.json) and sorts it into followed, nofollow, unlinked mention, gone, or blocked. Add a placement to the JSON the day it goes live, then run the readout to confirm the link is followed.

Readout on 2026-11-28:

- **Followed (4 hosts):** marketplace.microsoft.com, community.ibm.com (two blog posts and a discussion), vibehackers.io, claudemarketplaces.com (one followed link out of four).
- **Unlinked:** runtimewire.com published a full article about three.ws with no link to it.
- **Nofollow, no DR value:** HackerNoon, GitHub, Devpost.
- **Blocked to scripts:** Product Hunt, npm, Devpost (on a second run). Product Hunt and npm mark outbound links nofollow, so they would not count anyway.

## Link work that needs a person

Ranked by DR4 value per hour. Every item that sends a message or posts somewhere is owner-gated (CLAUDE.md gate 2), so each one is drafted here, ready to send.

1. **Reclaim the runtimewire mention.** The article is already written and indexed. One email asking for the link turns an unlinked mention into a followed editorial link. Draft:

   > Subject: Link for your three.ws article
   >
   > Hi, thanks for writing up three.ws ("three.ws documents its open-source stack for 3D agents with wallets"). The piece names us throughout but has no link, so readers have to search for us. Could you link the first mention to https://three.ws/ and the open-source stack mention to https://github.com/nirholas/three.ws? Happy to send updated screenshots or numbers if useful.

2. **Land the OpenAI Cookbook PR.** [openai/openai-cookbook#2874](https://github.com/openai/openai-cookbook/pull/2874) is open, still needs a maintainer review, and was last active 2026-11-20. Once merged, the example publishes on developers.openai.com with attribution: the single highest-traffic placement in reach. Run `npm run seo:backlinks -- --url <published page>` on publish day to confirm the link is followed.

3. **Turn partnerships into links on the partners' main sites.** IBM Community already links (followed). Ask for the partner-directory or case-study pages on ibm.com, microsoft.com (beyond the Marketplace listing), Google Cloud and AWS, where three.ws already has partner status. Packets live in [marketing/partner-packets/](../../marketing/partner-packets/). One link from a high-traffic partner domain is worth more than every directory listing combined.

4. **Earn links with the explainers.** `/anatomy` cutaways, Forge tutorials and the open-source SDK docs are what other writers cite. Pitch them to people who write about three.js, WebXR and AI agents, and link the deep page, not the homepage.

What will not move DR4, so do not spend time on it for that reason: directory and launch-site submissions, review-site listings (fine for discovery, see [marketing/review-sites/](../../marketing/review-sites/)), profile links on GitHub, npm, Product Hunt, HackerNoon and Devpost (all nofollow), and anything bought.

## Related

- [docs/seo.md](../seo.md): how pages are served to crawlers
- [docs/ops/seo-keyword-plan.md](./seo-keyword-plan.md): which searches to target
- [docs/ops/bing-and-indexnow.md](./bing-and-indexnow.md): Bing and IndexNow submission
