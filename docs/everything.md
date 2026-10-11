# /everything: browse every feature by goal

three.ws has about 340 product pages. The nav shows roughly 30 of them to a first-time visitor on purpose (see [onboarding-tier.md](onboarding-tier.md)), and `/sitemap` lists all of them by section. Neither answers the question a visitor actually has: "I want to animate my avatar, where do I go?"

`/everything` answers it. Every product page is assigned one **goal** (a job), and the page is a searchable directory of those goals.

## What a visitor gets

- **Twelve goals**, each with a one-line promise, a "Start here" button and its pages: make a 3D model or avatar, animate and perform, build an AI agent, put it on your site, sell and earn, launch a token, trade and track markets, wallets and on-chain identity, worlds/AR/play, discover, developer tools, your account.
- **Search** across title, path, description and tags. Press `/` anywhere on the page to focus it. `?q=wallet` deep-links a search, `#launch` deep-links a goal.
- **Goal chips** with live counts. They filter in place and update the URL hash.
- **Pins**: the star on any row pins it to a "Pinned" block at the top. **Recently opened** tracks the last six pages opened from here. Both live in `localStorage` only (`tws:fav`, `tws:recent`); nothing is sent to a server.
- **New this month**: pages whose `added` date in `data/pages.json` is within 45 days.
- Designed states: skeleton while loading, a retry panel (with a `/sitemap` fallback) if `features.json` fails, an empty-search panel that suggests how to rephrase.

## Where the data comes from

```
data/pages.json ──┐
                  ├─ scripts/build-page-index.mjs ──> public/features.json
scripts/lib/feature-jobs.mjs ─┘                       (pages[].job, jobs[])
                                                          │
                      pages/everything.html + src/everything.js (the page)
                      public/search.js (⌘K labels each result with its goal)
```

`scripts/lib/feature-jobs.mjs` is the single classification. A page gets its job from, in order: an exact-path pin in `OVERRIDES`, the first matching regex in `RULES`, then its `pages.json` section default. A new page therefore shows up on `/everything` with no extra step; if the rules put it in the wrong goal, pin it in `OVERRIDES`. Each goal also lists `featured` flagship paths that lead its card.

`tests/feature-jobs.test.js` fails if a product page resolves to no goal, a goal is empty, an override or featured path does not exist, or a core journey (`/forge`, `/create-agent`, `/widgets`, ...) lands under the wrong goal.

## Other discovery surfaces added with it

- **Nav**: "Browse by goal" leads Discover > Start here, and "Everything" is a top-level link. Both are in the lite tier (the lite menu stays at or under 30 links; `/pocket` moved to the advanced tier to make room).
- **⌘K palette**: a "Browse by goal" quick action and suggestion, and every page result is labelled with its goal instead of its site section.
- **What next? strip** (`public/next-steps.js`, loaded by `nav.js`): under a dozen tool pages (`/forge`, `/image-to-3d`, `/create/*`, `/animations`, `/widgets`, `/marketplace`, `/launch`, ...) a short strip suggests the natural next steps, dismissible per session. Opt a page out with `<html data-next-steps="off">`. `tests/next-steps.test.js` checks every link resolves to a real page. It complements `public/feature-discovery.js`, which fires its own card after a `tws:feature-done` event.
- **/sitemap** links to `/everything` in its header.

`/everything` used to be a guessable alias that 308'd to `/sitemap`; that alias was removed from `vercel.json` and `vite.config.js`.
