# Ship the free credibility files and crawlable-locale fixes that funding and listing programs check for

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/772-plan-growth-credibility-files-translations-credits.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 30 of 100 inside the tier). **Area:** growth. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

Several open-source funds, directories and curators check for files and signals that cost nothing to add and that three.ws does not have: a `funding.json` manifest (FLOSS/fund requires it), a `.zenodo.json` so a release mints a DOI, a visible "Powered by Pollinations" credit (a stated requirement of the Pollinations app catalog), and locale pages that crawlers can read. The sweep also flagged that the server always sends `<html lang="en">`, so translated text may be invisible to Baidu and Naver. All of this is repo and site work an agent can finish; only the final account connections (Zenodo, OpenSSF badge, FLOSS/fund submission) belong to the owner.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Done already: `CITATION.cff` at the repo root; translated READMEs for zh-CN, ja, ko in `docs/readme/` and linked from `README.md` line 9; OpenRouter attribution shipped.
- Missing: `https://three.ws/funding.json` and `/.well-known/funding-manifest-urls` both return 404; no `.zenodo.json` at the repo root; no "Powered by Pollinations" text anywhere in `src/` or `pages/` (the lane is in `api/_lib/ai-image-lanes.js`, `api/_mcp3d/text-to-image.js`); `.github/FUNDING.yml` lists only `https://three.ws` (the sweep says the Sponsor button target is an owner decision, leave it).
- `curl -sL https://three.ws/zh-CN/` redirects then 404s, and the home HTML for any locale starts with `<html lang="en">`. Locale selection is client-side in `src/i18n.js`, hreflang alternates come from `public/locales/localized-pages.json` via the sitemap (`scripts/build-page-index.mjs`, test `tests/i18n-localized-pages.test.js`).
- 63 locale catalogs exist in `public/locales/`. README translations stop at three languages while the site covers es, pt-BR, hi, ru and more.
- The locale manifest `public/locales/manifest.json` is rewritten by a running `scripts/i18n-translate.mjs`. Never commit it while a translation run is in flight.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls CITATION.cff .zenodo.json funding.json public/funding.json 2>&1
for p in funding.json .well-known/funding-manifest-urls; do curl -s -o /dev/null -w "$p %{http_code}\n" https://three.ws/$p; done
grep -rn -i "powered by pollinations" src pages api | head
ls docs/readme
curl -s "https://three.ws/?lang=ja" | grep -o '<html[^>]*>' | head -1
grep -n "lang" src/i18n.js | sed -n 1,25p
pgrep -af i18n-translate || echo "no translation run in flight"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. `funding.json`. Read the current spec at `https://floss.fund/funding-manifest/` (plain GET) and write `public/funding.json` against it: entity (the project), projects (three.ws, `@three-ws/mcp-server`, the viewer), history, channels, plans. Use only facts that exist in the repo and on production (license, repo URL, package names). Serve it at `/funding.json` and list it in `public/.well-known/funding-manifest-urls` (one URL per line) as the spec requires. Do not list any other crypto project. Test first: `tests/funding-manifest.test.js` validates required keys and that every URL in it returns a non-error status shape (offline: check URL syntax; online check is a Step 0 curl).
2. `.zenodo.json`. Add it at the repo root with title, description, creators, license, keywords and related identifiers taken from `CITATION.cff` so the two never disagree. Add a test that parses both and asserts the title, license and creator names match.
3. Pollinations credit. Where Pollinations-lane output is shown to a user (find the UI that renders image or text results from `api/_lib/ai-image-lanes.js` and `api/_mcp3d/text-to-image.js`, including the response metadata the API already returns), add a small visible "Powered by Pollinations" credit linking to pollinations.ai, shown only when that lane actually produced the result. Add the lane name to the API response if it is not there, and test that the credit renders for that lane and not for others. Hover, focus and contrast states per the house tokens.
4. Crawlable locales. First measure whether any server-rendered path sets `<html lang>` and hreflang per locale. Then make the server (the Cloud Run static/HTML layer that serves `pages/*.html`, see `server/index.mjs`) emit `<html lang="<locale>">` and `rel="alternate" hreflang` links when a request carries `?lang=<supported locale>`, with a canonical that points at the un-parameterized URL. Test first in `tests/` beside `i18n-localized-pages.test.js` using the server's request handler directly. Do not break the existing client-side switch in `src/i18n.js`.
5. README translations. Using the repo's own translation tooling (`scripts/i18n-translate.mjs` or the same model path it uses), produce `docs/readme/README.es.md`, `README.pt-BR.md`, `README.hi.md`, `README.ru.md`, then extend the language line in `README.md`. Keep product names, code blocks and URLs untouched. Add a test that every file linked from the README language line exists and has the same number of top-level headings as the English README.
6. Local evidence runs (read-only, no posting): run the OpenSSF Scorecard CLI against the repo if it can be installed without a GitHub Action (record the score and the failing checks in `docs/security/` or the existing security doc); fix any failing check that is a file or setting inside the repo (for example a missing `SECURITY.md` section or pinned dependencies), and list the ones that are not.
7. Write `docs/ops/credibility-submissions.md` (or extend an existing partners doc) with the exact remaining owner steps and ready-to-paste values: Zenodo GitHub connect then cut a release, Software Heritage "Save Code Now" request, OpenSSF Best Practices badge registration, FLOSS/fund submission at `dir.floss.fund/submit` with the live `funding.json` URL. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test` (or `npx vitest run`) for the new tests passes: funding manifest, zenodo/citation agreement, Pollinations credit, locale head tags, README language line.
- [ ] After deploy (or against the local server before): `curl -s https://three.ws/funding.json | python3 -m json.tool` succeeds and `/.well-known/funding-manifest-urls` returns the URL with 200.
- [ ] `curl -s "https://three.ws/?lang=ja" | grep -o '<html[^>]*>'` shows `lang="ja"`.
- [ ] `python3 -c "import json;json.load(open('.zenodo.json'))"` succeeds.
- [ ] The Pollinations credit is seen in a real browser on a Pollinations-produced result and absent on another lane.
- [ ] `public/locales/manifest.json` is unchanged in the diff, and `git diff --stat` shows nothing unrelated.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The funding-manifest spec changed | Build to the version served at floss.fund today and record the version in the file's comments-free metadata field. |
| A translation run is in flight | Do not touch `public/locales/manifest.json`. Do the README translations through the tool without committing the manifest. |
| Scorecard CLI cannot be installed | Run it as a container image or via `go install`; if neither works, record the failure and list the checks to run manually. |
| Zenodo, OpenSSF and FLOSS/fund need owner accounts | Prepare every file and the paste-ready runbook; those four connections are owner-only and stay in the final report. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/772-plan-growth-credibility-files-translations-credits.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `772-plan-growth-credibility-files-translations-credits.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `marketing/growth/sweep-2026-09-18.md` (whole file)

~~~~markdown
# Wide opportunity sweep, 2026-09-18

A read-only sweep of the open web, GitHub and npm for every place three.ws can be listed,
featured, funded, or partnered, beyond what the
[opportunity register](./opportunities.md), [`opportunities.csv`](./opportunities.csv),
[the submission kit](./submissions/README.md) and
[the partnership pipeline](../../docs/partners/opportunities.md) already track. Nothing here
has been submitted, registered, or posted; every dispatch stays owner-gated.

How to read it:

- Every row was checked live on 2026-09-18 unless marked **(secondary)**, which means the
  vendor's own page blocked automated reads and the figure comes from a third-party write-up.
  Confirm those before paying anything.
- "Not listed" means the site's own search, slug, API, or a `site:` query found no three.ws
  or `nirholas` entry.
- The ranked, dated rows that need an owner action are mirrored into `opportunities.csv`.
  This page keeps the full evidence and the dropped lists, so nobody re-researches them.

Two facts decide which three.ws surface each listing uses:

- `https://three.ws/api/mcp-studio` answers MCP `initialize` with 200 and needs no auth, so
  remote MCP directories get this URL. `https://three.ws/api/mcp` is OAuth-gated.
- `@three-ws/mcp-server` (Apache-2.0) ships the `3d-agent-mcp` bin, so stdio and `npx`
  directories get `npx -y @three-ws/mcp-server`.

---

## Corrections this sweep forced

| Finding | Fix |
| --- | --- |
| Walk Avatar (`extensions/walk-avatar`) is on **no** browser store. Chrome Web Store search and the Firefox add-ons API return nothing for three.ws, the repo holds no store URL, and `extensions/walk-avatar/RELEASE.md` is an unchecked checklist | The two docs that listed the Chrome Web Store as live were corrected in the same change. Shipping it is row A1 below |
| three.ws launched on Product Hunt on 2026-05-28 ([launch post](https://three.ws/news/2059894004771418220)). Product Hunt requires six months between launches from one root domain | The week-3 Product Hunt slot in [the publishing program](../../docs/publishing-program-2026-09.md) now says: on or after 2026-11-28, or earlier only through a relaunch request |
| three.ws has **never** been posted to Hacker News (hn.algolia.com URL search for three.ws: 0 hits) | Show HN is an unused first-launch channel; the short-form kit's slot stands |
| `docs/announcement-coverage.md` and `docs/the-first-19-weeks.md` record a "W3C membership" announcement, but three.ws is not on [w3.org/membership/list](https://www.w3.org/membership/list/) | Owner confirms what that announcement referred to (a Community Group is not membership) before anyone repeats the claim |

---

## Launch platforms

| # | Venue | Submission path and cost | Audience the site states | Listed? | Next action |
| --- | --- | --- | --- | --- | --- |
| L1 | [Show HN](https://news.ycombinator.com/showhn.html) | Free | none stated | Never posted | Use the prepared short-form kit slot |
| L2 | [Peerlist Launchpad](https://help.peerlist.io/individual/launchpad/introduction) | Free; a window opens every Monday; the weekly top 3 get a newsletter and social feature | none stated | No | Launch Forge in a Monday window |
| L3 | [Uneed](https://www.uneed.best/pricing) | Free queue (date up to 5 months out); USD 14.99 fast-track, 29.99 pick-a-date | 90,000 monthly visitors, 22,000 visits sent to products per month | No | Join the free queue now so the date arrives in the campaign window |
| L4 | [SaaSHub](https://www.saashub.com/services/submit) | Free; rejects unreleased and non-English products | 244,758 products, 29,600+ newsletter subscribers | No (`/three-ws` is 404) | Submit, then verify ownership |
| L5 | [AlternativeTo](https://alternativeto.net) | Free; the account must be 7+ days old (secondary) | none stated | No (`/software/three-ws/` is 404) | Create the account today so the 7 days run, then list against the text-to-3D and avatar tools users compare |
| L6 | [OpenAlternative](https://openalternative.co/submit) | Open-source only; free queue is long | 12,000 newsletter subscribers | No | Submit the repo to the free queue |
| L7 | [DevHunt](https://devhunt.org) | Free queue with GitHub login | none stated | No | Submit `@three-ws/mcp-server` as a dev tool |
| L8 | [Microlaunch](https://microlaunch.net) | Free regular launch | 938 daily visitors shown on site | No | Free launch |
| L9 | [Fazier](https://fazier.com) | Free with a backlink badge (listed within 30 days) (secondary) | none stated | No | Free launch with the badge |
| L10 | [Indie Hackers products](https://www.indiehackers.com/products) | Free with an account | none stated | No | Add the product with a founder story |
| L11 | Product Hunt relaunch | Free; early relaunch needs a request | none stated | Launched 2026-05-28 | See Corrections: on or after 2026-11-28 |

## AI and agent directories

| # | Venue | Submission path and cost | Audience | Listed? | Next action |
| --- | --- | --- | --- | --- | --- |
| D1 | [Future Tools](https://futuretools.io/faq) | Free form; over 75% rejected; rejects custom GPTs and waitlist tools | 4,500+ tools; 250,000+ newsletter readers per its About page | No | Submit Forge (free, no account), not the GPT |
| D2 | [The Rundown Supertools](https://www.therundown.ai/submit) | Free directory submission; the newsletter feature is paid | 2,000,000+ readers | No | Submit Forge |
| D3 | [AI Agent Store](https://aiagentstore.ai) | Free listing at `/new-agent` | 1,394 listings | No | List the `<agent-3d>` embodied agent |
| D4 | [AI Tools Directory](https://aitoolsdirectory.com/submit-tool) | Free, 3-5 business-day review (secondary) | none stated | Unverified | Submit Forge |
| D5 | [TopAI.tools](https://topai.tools/submit) | Free, 48-hour review (secondary) | none stated | Unverified | Submit Forge |
| D6 | [AI Agents Directory](https://aiagentsdirectory.com/submit-agent) | Form live; pricing not visible | none stated | No | Owner opens the form and reads the terms |
| D7 | [AI Agents List](https://aiagentslist.com/submit) | USD 29 or 49 after a free eligibility check | 1,500+ newsletter builders | No | Only if the free directories convert |

## MCP marketplaces

| # | Venue | Submission path and cost | Audience | Listed? | Next action |
| --- | --- | --- | --- | --- | --- |
| M1 | [MCP Market](https://mcpmarket.com/submit) | GitHub repo URL; free (4-6 weeks) or USD 29 (24 hours, badge, "Try Now" link) | 1M+ monthly visitors, 35,000+ servers | Only `nirholas/x402-payments-mcp`; no three.ws 3D server | Submit the 3D Studio server |
| M2 | [Cursor Marketplace](https://cursor.com/docs/plugins) | Publish at `cursor.com/marketplace/publish`; manual review; plugin must be open source and may bundle an MCP server | Cursor users | No plugin exists | Build a plugin wrapping `mcp-studio`, then submit |
| M3 | [MCP.Directory](https://mcp.directory/submit) | Free; GitHub URL; review within 24 hours; auto-discovered entries can be claimed | 3,000+ servers | No | Submit, then claim |
| M4 | GitHub MCP Registry (`github.com/mcp`) | Curated; nomination by email to `partnerships@github.com` (secondary) | 252 curated servers (API total) | No | Email the nomination for the no-auth 3D Studio server |
| M5 | [cursor.directory](https://cursor.directory) | Sign in and submit | Repo has 3,990 stars | Unverified (429) | Owner checks in a browser, then submits |
| M6 | Gemini CLI extensions gallery | Automatic from a public repo tagged `gemini-cli-extension` with a `gemini-extension.json` | Ranked by stars | No | Publish the manifest repo and add the topic |

## 3D and creative showcases

| # | Venue | Submission path and cost | Audience | Listed? | Next action |
| --- | --- | --- | --- | --- | --- |
| S1 | [Three.js Resources](https://threejsresources.com/submit) | Free, 7-day review; takes tools, showcases, MCP resources, AI prompts | 200,000+ monthly 3D developers, 280 tools | No | Three separate submissions: the MCP server, `<agent-3d>`, a Forge showcase |
| S2 | [webgpu.com showcase](https://www.webgpu.com/showcase/) | Free Google Form linked on the page | none stated | No | Submit the Forge or `<agent-3d>` demo with a screenshot |
| S3 | [Codrops Creative Hub](https://tympanus.net/codrops/hub/) | "Submit a demo"; articles pitched via the contact form | none stated | No | Submit a demo, then pitch the animation-retargeting story |
| S4 | [Awwwards](https://www.awwwards.com/submit/) | USD 65 per site | none stated | Unverified | Only if `/forge` is award-grade; target the Developer award |
| S5 | 80 Level | Editorial email pitch | Game-art audience | Unverified | Pitch only with the rigging pipeline story |

## Newsletters

| # | Venue | Submission path | Audience | Next action |
| --- | --- | --- | --- | --- |
| N1 | [Console.dev](https://console.dev/selection-criteria) | Email `hello@console.dev`; developer-first, self-serve signup, API or CLI a plus; no sponsored reviews | 30,000+ subscribers | Pitch the MCP server and CLI |
| N2 | JavaScript Weekly, Frontend Focus, Node Weekly (Cooperpress) | Submission form or reply to an issue (secondary) | not stated | `<agent-3d>` to JavaScript Weekly and Frontend Focus; `@three-ws/mcp-server` to Node Weekly |
| N3 | [Changelog News](https://changelog.com/news/submit) | Free with an account; own work allowed; rejects commercial products | not stated | Frame it as the Apache-2.0 open-source project |
| N4 | [Latent Space](https://www.latent.space/about) | Guest-post form and `tips@latent.space` | 200,000 subscribers | Pitch a guest post on running a large MCP server fleet |
| N5 | daily.dev | Company blogs are not sources; start a Squad (review up to 30 days) | none stated | Create a three.ws Squad |
| N6 | TLDR AI / TLDR Dev | No free submission; sponsorship only | 1,100,000 / 470,000 | Earned only, usually via a Show HN that performs |

## Podcasts

| # | Venue | Route | Next action |
| --- | --- | --- | --- |
| P1 | [Changelog](https://changelog.com/request) (Interviews, & Friends) | Episode request form | Request an episode on open-source 3D agents |
| P2 | Latent Space podcast | Mostly invited; `tips@latent.space` | Pitch after the guest post lands |
| P3 | [devtools.fm](https://www.devtools.fm) | Guest application exists; link unconfirmed | Find the form and apply |
| P4 | [Practical AI](https://practicalai.show) | No pitch path shown | Contact through the site |
| P5 | [Syntax](https://syntax.fm/potluck) | Potluck question form only | Ask a Potluck question on 3D web components |

## Guest-post programs

These must be written by the owner personally: Frontend Masters and DZone ban AI-written
articles, and Smashing rejects product walkthroughs by company representatives.

| # | Venue | Terms | Angle |
| --- | --- | --- | --- |
| G1 | [Frontend Masters blog](https://blog.master.dev/guest-writing/) | Paid; full ~600-word how-to draft to `guest_writing@frontendmasters.com` | A lazy-booting 3D custom element from first principles |
| G2 | [Smashing Magazine](https://www.smashingmagazine.com/write-for-us/) | 200-300 word outline; honorarium | A technique article, no product walkthrough |
| G3 | [freeCodeCamp News](https://www.freecodecamp.org/news/how-to-write-for-freecodecamp/) | Apply with 3 writing samples | Use the published Hugging Face and dev.to articles as samples |

---

## App stores and plugin marketplaces

| # | Surface | Intake and cost | Listed? | Fit in the repo | Next action |
| --- | --- | --- | --- | --- | --- |
| A1 | Chrome Web Store | Developer console, one-time registration fee | No | `extensions/walk-avatar/` (MV3, privacy, terms, store assets) | Work through `RELEASE.md`, build the zip, submit |
| A2 | Microsoft Edge Add-ons | Partner dashboard, no registration fee, certification up to 7 business days | No | Same zip | Submit alongside Chrome |
| A3 | Firefox Add-ons | Self-serve, free; source upload for minified code | No | Same | Submit after Chrome |
| A4 | Poe server bot | `creator.poe.com`, self-serve, per-message monetization | No | Forge HTTP API | Wrap the free Forge lane as a server bot |
| A5 | WordPress.org plugins | Free (GPLv2+), reviewed within 14 business days | No | oEmbed (`api/agent-oembed.js`), `docs/share-and-embed.md` | Build a small `<agent-3d>` block and shortcode plugin |
| A6 | Shopify App Store | Partner dashboard; USD 19 one-time; 0% revenue share on the first USD 1M | No | Shopping mode in `docs/concierge.md`, `api/concierge.js` | Wrap the one-tag concierge as a theme app extension with compliance webhooks |
| A7 | Framer Marketplace | Upload `plugin.zip` from the Marketplace dashboard | No | `<agent-3d>`, `packages/react/src/Agent3D.jsx` | Build an insert plugin |
| A8 | Webflow Apps | `developers.webflow.com/submit`; 2FA and a demo video; 10-15 business days | No | Iframe widget, `docs/tutorials/embed-in-30-seconds.md` | Build a Designer Extension that inserts the widget |
| A9 | Raycast Store | `npm run publish` opens a PR to `raycast/extensions`; free | No | Forge free lane | Build a "forge a model" extension |
| A10 | Figma Community | Publish from the desktop app; free; 5-10 business-day review | Unverified | Forge text-to-3D API | Build a render-to-frame plugin |
| A11 | Discord App Directory | Verified app with tag, privacy policy, and terms | No | No Discord app yet | Only after building an Activity |
| A12 | Godot Asset Library / Unity Asset Store | Free manual review / 70% to publisher | No | GLB export and `workers/rig` only | Only after an engine addon exists |
| A13 | Replicate | `cog push` | `replicate.com/nirholas` exists with 0 models | `workers/model-*` | Only if a worker is repackaged with Cog |

Dropped: Slack Marketplace (needs 10+ active workspaces), HubSpot (3+ installs), Telegram
Apps Center (crypto apps must be TON-only (secondary), which conflicts with Solana-first),
fal.ai (no provider listing program; `fal.ai/partners` is 404), Meta Ray-Ban Display (no store;
URL distribution), visionOS (no store needed), Snap Camera Kit (application-gated). Wix,
Zapier, Make, Canva, Adobe Express, Teams, Notion, Obsidian, Roblox, and itch.io are open but
each needs a new build with weak fit.

---

## Events, CFPs, and hackathons (by deadline)

| Deadline | Event | Dates and place | Intake | Fit | Next action |
| --- | --- | --- | --- | --- | --- |
| **2026-09-30, 23:00 PDT** | [Web3D 2026 Competitions](https://web3d.siggraph.org/) (AI and Web3D, Metaverse Tools, HAnim animation) | 2026-10-13 to 15, Doha, hybrid | `easychair.org/conferences/?conf=web3d26` | `<agent-3d>`, Forge, `src/animation-retarget.js` | **Best fit on the list.** Enter the AI and HAnim tracks. Papers closed 2026-06-01 |
| 2026-10-01, 23:59 EDT | AI Native DevCon NYC | 2026-11-03 to 04, Brooklyn | `sessionize.com/ai-native-devcon-nyc-2026` | Running a large MCP fleet | A lessons-learned talk, no product pitch |
| 2026-10-11, 23:59 PT | AI Engineer Code Summit | 2026-11-10 to 12, San Francisco | `sessionize.com/aiecode26`; speakers' travel covered | MCP tooling, VS Code extensions | Submit up to three proposals |
| 2026-10-12 | [Colosseum Crypto World's Fair](https://colosseum.com/worldsfair) (Solana) | Online, 2026-09-14 to 10-12 | Registration on the site | x402 on Solana, agent payments | Register and confirm whether an existing project is eligible |
| 2026-10-23, 12:00 PDT | [Amazon Developer Hackathon](https://amazonappdev2026.devpost.com) (Alexa+ MCP or Agent Skill track) | Online | Devpost | MCP servers; AWS partner | Enter one MCP server |
| 2026-10-30, 10:00 PDT | [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com) | Online | Devpost; must run on Nebius with an NVIDIA open model | NVIDIA Inception story | Optional |
| not stated | [Solana Breakpoint 2026](https://solana.com/breakpoint) | 2026-11-15 to 17, London | Speaker application on the event page | Home chain | Send the speaker application |
| not stated | UnitedXR Europe showcase | 2026-12-07 to 09, Brussels | `unitedxr.eu`; talks and pitch closed | WebXR AR (`pages/ar-studio.html`) | Ask about the expo or showcase |
| 2026-09-28 (early bird) | SIGGRAPH Asia 2026 | 2026-12-01 to 04, Kuala Lumpur | Every submission track is closed | text-to-3D, rigging | Attend only |
| 2026-10-08 (early bird) | AGNTCon + MCPCon North America | 2026-10-22 to 23, San Jose | CFP closed 2026-06-07 | MCP | Attend or sponsor; owner decides on paid tickets |

On the calendar, nothing to submit yet: AI Engineer Europe (2027-02-17 to 19, London) and
World's Fair (2027-06-29 to 07-02); Google Cloud Next 2027 (2027-04-13 to 15, pitch a Cloud
Run and Vertex customer session); AWE USA 2027 (2027-06-14 to 17, call open, deadline not
stated). GitHub Universe (2026-10-28 to 29) has no CFP. Closed or past: JSNation and React
Summit US, MCP Dev Summit Toronto, AI Engineer NYC, GDC 2027, Three.js Conf Paris (2026-09-10
to 11; watch for the 2027 call).

---

## Technology partner programs and standards bodies

| # | Program | Intake and cost | Co-marketing | Fit in the repo | Next action |
| --- | --- | --- | --- | --- | --- |
| T1 | [Khronos glTF File Format Adopter Program](https://www.khronos.org/conformance/adopters/file-format-adopter-program) | Form; free option for any entity | glTF trademark license and the public adopter list | GLB pipeline, meshopt, `gltf-validator` | Submit the form (separate from the tracked Project Explorer listing) |
| T2 | Khronos glTF supporter logo | Email `webservices@khronosgroup.org`; free | Logo on khronos.org/gltf | Same | Send the email |
| T3 | [Claude Partner Network](https://claude.com/partners) | Application; free to join (secondary) | Partner directory, "Powered by Claude" | Many MCP servers, `@ai-sdk/anthropic` | Apply on the technology or MCP track |
| T4 | [Metaverse Standards Forum](https://metaverse-standards.org/join) | Participant membership free | Public roster | 3D Assets and AI x Metaverse groups | Join free, then enter both groups |
| T5 | W3C Community Groups: [AI Agent Protocol](https://www.w3.org/community/agentprotocol/), [Immersive Web](https://www.w3.org/community/immersive-web/) | Free with a W3C account and CLA | Credibility only | Agents; WebXR (`src/ar/webxr.js`) | Join both |
| T6 | [LiveKit startup program](https://livekit.com/startups) | Short form; up to USD 23,000 in credits | Customer stories | `src/runtime/livekit-voice.js` | Apply; separate from the tracked avatar-plugin decision |
| T7 | [Neon open-source program](https://neon.com/programs/open-source) | Contact; up to USD 5,000 per year | Blog, social, case study | `@neondatabase/serverless` in production | Ask whether the Apache-2.0 repo qualifies |
| T8 | Google Cloud Partner Network, Build track | `cloud.google.com/partners/become-a-partner` | Tiered | Production on Cloud Run | Fold into the tracked Google Cloud AI Agents row |
| T9 | Google AI Futures Fund | Rolling form; an equity investment | not stated | Vertex Gemini and Imagen in production | Owner decision: it is investment, not a listing |
| T10 | ElevenLabs commercial partner program | `elevenlabs.io/partner-application` | Not stated; no public integrations directory | `@elevenlabs/elevenlabs-js` | Low priority; the startup grant route is tracked |
| T11 | VRM Consortium | Membership inquiry | not stated | VRM 0.x and 1.0 bone maps in `src/glb-canonicalize.js` | Optional |
| T12 | pmndrs / three.js sponsorship | Open Collective or GitHub Sponsors | No logo perks stated | `three`, `packages/react` | Goodwill only |

Held: Khronos associate membership for the 3D Commerce group (USD 4,000 minimum, weak fit)
and Agentic AI Foundation membership (paid tiers; the free route is MCP community work).
Dropped: Open Metaverse Foundation (domain does not resolve), Cloudflare Workers Launchpad
(cohort closed), Vercel OSS program (not deployed on Vercel), and Meshy, Tripo, Rodin, and Luma
(no partner programs).

---

## Curated and awesome lists (non-crypto)

About 190 GitHub searches returned roughly 1,400 repositories. 114 of them were checked
through the API: stars, last push, whether archived, the latest merged PR from someone other
than the owner (bots excluded), and a README grep for `three.ws|nirholas|three-ws|threews`.
**None of the rows below lists three.ws yet.** Lists already in the kit or on its rejected
list are left out.

The surfaces most entries point at:

- The free Forge API, `POST https://three.ws/api/v1/ai/text-to-3d`: public, CORS-open, no
  key, 10 generations per IP per day ([API reference](../../docs/api-reference.md)).
- The 3D-only skill folder [`public/skills/3d-studio/`](../../public/skills/3d-studio/)
  (generate-3d-model, create-3d-avatar, rig-a-model, embed-three-ws-avatar). Skill lists get
  this folder, not `.agents/skills`, which mixes in wallet and trading skills.
- `/splat`, `/materialize`, and the published npm packages `@three-ws/forge`,
  `@three-ws/home-mcp`, `@three-ws/tty-avatar`, `@three-ws/spatial-mcp`, and `@three-ws/voice`.

The proof PR is the latest merged community PR, or a recent one of the same shape.

| # | List | Stars | Last push | Proof PR | Section | Entry |
| --- | --- | ---: | --- | --- | --- | --- |
| K1 | [public-apis/public-apis](https://github.com/public-apis/public-apis) | 481k | 09-17 | #7401, 09-17 | Machine Learning | Forge API (Auth: No, HTTPS, CORS) |
| K2 | [ripienaar/free-for-dev](https://github.com/ripienaar/free-for-dev) | 138k | 09-17 | #4871, 09-17 | Generative AI | Forge free tier and the no-auth MCP |
| K3 | [sorrycc/awesome-javascript](https://github.com/sorrycc/awesome-javascript) | 35k | 09-08 | #1159, 09-08 | Generative AI | `@three-ws/forge` or `<agent-3d>` |
| K4 | [ellisonleao/magictools](https://github.com/ellisonleao/magictools) | 17.3k | 09-14 | #410, 09-14 (a texture tool) | Graphics > Modeling | Forge text-to-3D |
| K5 | [public-api-lists/public-api-lists](https://github.com/public-api-lists/public-api-lists) | 15.8k | 09-14 | #696, 09-14 | Art & Design | Forge API |
| K6 | [terkelg/awesome-creative-coding](https://github.com/terkelg/awesome-creative-coding) | 15.3k | 07-21 | #224, 06-10 | Machine Learning, Computer Vision, AI | Forge or `<agent-3d>` |
| K7 | [marcelscruz/public-apis](https://github.com/marcelscruz/public-apis) | 9.5k | 09-17 | #1245, 09-17 | AI | Forge API |
| K8 | [MrNeRF/awesome-3D-gaussian-splatting](https://github.com/MrNeRF/awesome-3D-gaussian-splatting) | 8.9k | 09-12 | #441, 09-12 | Viewers > Web Viewers | `/splat` |
| K9 | [frenck/awesome-home-assistant](https://github.com/frenck/awesome-home-assistant) | 8.5k | 09-18 | #717, 05-11 | Tools & Utilities | `@three-ws/home-mcp` |
| K10 | [yzfly/Awesome-MCP-ZH](https://github.com/yzfly/Awesome-MCP-ZH) | 7.7k | 09-07 | #545, 09-07 | Multimedia and content creation | `@three-ws/mcp-server` and the remote |
| K11 | [Kavex/GameDev-Resources](https://github.com/Kavex/GameDev-Resources) | 7.0k | 04-10 | #61, 04-10 | AI | Forge and the avatar generator |
| K12 | [alvinreal/awesome-opensource-ai](https://github.com/alvinreal/awesome-opensource-ai) | 4.7k | 09-18 | #753, 09-17 | Generative Media Tools > 3D & Creative | The Apache-2.0 repo |
| K13 | [killop/anything_about_game](https://github.com/killop/anything_about_game) | 4.1k | 09-14 | #31, 07-13 | Game-Design-Tool > Modeling | Forge |
| K14 | [ad-si/awesome-3d-printing](https://github.com/ad-si/awesome-3d-printing) | 2.0k | 08-11 | #104, 07-13 (a prompt-to-CAD tool) | Online Tools | `/materialize` |
| K15 | [weihaox/awesome-digital-human](https://github.com/weihaox/awesome-digital-human) | 2.0k | 04-18 | #11, 04-18 (a real-time avatar SDK) | Industry Demo or Product | Voice avatars, `<agent-3d>` |
| K16 | [Kedreamix/Awesome-Talking-Head-Synthesis](https://github.com/Kedreamix/Awesome-Talking-Head-Synthesis) | 1.6k | 09-18 | #9, 04-02 | Open-source Projects | Talking 3D avatar with `@three-ws/voice` visemes |
| K17 | [devanshutak25/3d-resources](https://github.com/devanshutak25/3d-resources) | 948 | 09-15 | #11, 08-21 | AI & ML for CG > 3D Generation | Forge, via the repo's `data/` files |
| K18 | [toolleeo/awesome-cli-apps-in-a-csv](https://github.com/toolleeo/awesome-cli-apps-in-a-csv) | 2.6k | 09-14 | #411, 09-14 | Graphics row | `@three-ws/tty-avatar` |
| K19 | [ARUNAGIRINATHAN-K/awesome-ai-agents-2026](https://github.com/ARUNAGIRINATHAN-K/awesome-ai-agents-2026) | 343 | 09-17 | #277, 09-17 | Creative AI Agents > 3D and Design Generation | `<agent-3d>`, via its issue form |
| K20 | [MobinX/awesome-mcp-list](https://github.com/MobinX/awesome-mcp-list) | 881 | 09-18 | #453, 09-18 | Art & Culture | `@three-ws/mcp-server` |
| K21 | [AlexMili/Awesome-MCP](https://github.com/AlexMili/Awesome-MCP) | 146 | 08-31 | #183, 08-31 (into Media & 3D) | Media & 3D | `@three-ws/mcp-server` and the remote |
| K22 | [AIAnytime/Awesome-MCP-Server](https://github.com/AIAnytime/Awesome-MCP-Server) | 68 | 09-16 | #99, 09-16 | Media & generation (http) | `mcp-studio` |
| K23 | [foss42/awesome-generative-ai-apis](https://github.com/foss42/awesome-generative-ai-apis) | 224 | 09-05 | #451, 09-05 | Other API Providers | Forge API |
| K24 | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 75k | 09-18 | #893, 05-22 | Creative & Media | `public/skills/3d-studio` |
| K25 | [BehiSecc/awesome-claude-skills](https://github.com/BehiSecc/awesome-claude-skills) | 10.2k | 08-02 | #141, 06-03 | Media & Content | 3d-studio skills |
| K26 | [JackyST0/awesome-agent-skills](https://github.com/JackyST0/awesome-agent-skills) | 639 | 09-18 | #100, 09-18 | Design | 3d-studio skills |
| K27 | [karanb192/awesome-claude-skills](https://github.com/karanb192/awesome-claude-skills) | 517 | 09-01 | #15, 08-05 | Creative | 3d-studio skills |
| K28 | [kodustech/awesome-agent-skills](https://github.com/kodustech/awesome-agent-skills) | 102 | 08-14 | #68, 08-14 | Frontend Development | embed-three-ws-avatar |
| K29 | [heilcheng/awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills) | 6.2k | 04-05 | #52, 04-05 | Skills Collections | 3d-studio skills |
| K30 | [tankvn/awesome-ai-tools](https://github.com/tankvn/awesome-ai-tools) | 349 | 09-12 | #162, 08-03 | Art Generators > 3D | Forge |
| K31 | [pingan8787/awesome-ai-tools](https://github.com/pingan8787/awesome-ai-tools) | 368 | 06-22 | #157, 06-22 | Avatars & Profile Pics | Avatar creation |
| K32 | [aliammari1/awesome-ai-tools](https://github.com/aliammari1/awesome-ai-tools) | 98 | 09-15 | #120, 07-11 | Creativity & Design | Forge |
| K33 | [punkpeye/awesome-mcp-devtools](https://github.com/punkpeye/awesome-mcp-devtools) | 482 | 08-04 | #240, 08-04 | Testing Tools | `@three-ws/spatial-mcp` validator |
| K34 | [JSONbored/awesome-claude](https://github.com/JSONbored/awesome-claude) | 298 | 08-16 | #5749, 08-16 | MCP Servers | `@three-ws/mcp-server` |
| K35 | [webfuse-com/awesome-claude](https://github.com/webfuse-com/awesome-claude) | 1.7k | 08-10 | #264, 06-12 | Claude Code & MCP | `mcp-studio` |
| K36 | [collabnix/awesome-mcp-lists](https://github.com/collabnix/awesome-mcp-lists) | 34 | 09-14 | #105, 09-06 | Multimedia & Design | `@three-ws/mcp-server` |
| K37 | [Anil-matcha/awesome-agent-apis](https://github.com/Anil-matcha/awesome-agent-apis) | 1.0k | 09-17 | #216, 09-11 | `providers/` | Forge API |
| K38 | [Anil-matcha/awesome-generative-ai-apps](https://github.com/Anil-matcha/awesome-generative-ai-apps) | 3.3k | 09-17 | #353, 07-16 | Open-Source AI Platforms | three.ws |
| K39 | [Anil-matcha/awesome-vibecoded-saas](https://github.com/Anil-matcha/awesome-vibecoded-saas) | 1.0k | 09-17 | #148, 09-17 | AI & Creative | three.ws as an open-source text-to-3D alternative |
| K40 | [wdhdev/free-for-life](https://github.com/wdhdev/free-for-life) | 1.7k | 08-27 | #168, 08-27 | Artificial Intelligence (edit the data source) | Forge free tier |
| K41 | [NipunaRanasinghe/awesome-ai-agents](https://github.com/NipunaRanasinghe/awesome-ai-agents) | 40 | 09-16 | #193, 09-16 | Creative Agents | three.ws |
| K42 | [aloth/awesome-ai-agents](https://github.com/aloth/awesome-ai-agents) | 49 | 09-17 | #77, 09-17 | Agent Skills & Tools | `@three-ws/mcp-server` |
| K43 | [yzfly/awesome-voice-agents](https://github.com/yzfly/awesome-voice-agents) | 54 | 08-30 | #19, 08-30 | Specialized Solutions | Voice avatars |
| K44 | [jim-schwoebel/awesome_ai_agents](https://github.com/jim-schwoebel/awesome_ai_agents) | 2.0k | 03-28 | #146, 03-28 (slowing) | Applications | three.ws |
| K45 | [diegoleme/awesome-open-source-alternatives](https://github.com/diegoleme/awesome-open-source-alternatives) | 489 | 04-10 | #16, 04-10 | A new text-to-3D heading | three.ws |
| K46 | [altstackHQ/altstack-data](https://github.com/altstackHQ/altstack-data) | 323 | 09-18 | #24, 07-29 | `tools.json` AI | three.ws |
| K47 | [beriberikix/awesome-mcp-hardware](https://github.com/beriberikix/awesome-mcp-hardware) | 58 | 04-17 | #1, 04-14 | Smart home | `@three-ws/home-mcp` |
| K48 | [sylviangth/awesome-remote-mcp-servers](https://github.com/sylviangth/awesome-remote-mcp-servers) | 70 | 04-05 | #15, 04-05 | List table | `mcp-studio` |
| K49 | [Lin-jun-xiang/awesome-vscode-extensions](https://github.com/Lin-jun-xiang/awesome-vscode-extensions) | 301 | 04-20 | #7, 04-20 | New extension heading | `vscode-3d` |
| K50 | [ashishpatel26/500-AI-Agents-Projects](https://github.com/ashishpatel26/500-AI-Agents-Projects) | 37.8k | 07-27 | #115, 07-27 | Media and Entertainment use cases | three.ws |
| K51 | [n0shake/Public-APIs](https://github.com/n0shake/Public-APIs) | 23.9k | 05-03 | #606, 05-03 (slow) | Machine Learning | Forge API |
| K52 | [Code-and-Sorts/awesome-copilot-agents](https://github.com/Code-and-Sorts/awesome-copilot-agents) | 572 | 04-29 | #49, 04-29 | MCP | `@three-ws/mcp-server` |

### Conditional

- **[sindresorhus/awesome](https://github.com/sindresorhus/awesome)** (507k stars): needs the
  standalone "Awesome 3D Agents" list published first (`npm run awesome:standalone`), at least
  30 days old and passing awesome-lint, before the PR.
- **[awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data)**
  (feeds the 320k-star list): the first release must be more than four months old. The only
  tag is v1.0.0 of 2026-08-28, so it is eligible after about 2026-12-28, and it will carry the
  proprietary-dependency warning.
- **ccplugins/awesome-claude-code-plugins** and **composio-community/awesome-claude-plugins**:
  the listable artifact is `.claude-plugin/marketplace.json`, whose top-level description
  names other projects; list only the `three-ws-developer` plugin or reword the description first.
- **best-of-ai**: intake is the bestofai.io form (a bot merges), with 3D, 3D Printing, and
  Talking Avatar categories.

### Dropped

No community merge in 12 months: viatsko/awesome-vscode, metorial-index,
slavakurilyak/awesome-ai-agents, PipedreamHQ and ever-works awesome-mcp-servers,
RoggeOhta/awesome-codex-cli, korchasa/awesome-ai-agents, several awesome-ai-tools and
awesome-claude-code forks, libukai/awesome-agent-skills, BunnySoCrazy/Awesome-3D-Generation,
the AI-game lists, and the ComfyUI lists. Stale before 2025-09: M3-org/awesome-metaverse and
every vtuber, avatar, webxr-development, augmented-reality, react-three-fiber, glTF, and
procedural-generation list found. Papers only: the 3D AIGC, 3D diffusion, human-motion, and
sign-language lists. Maintainer-only: ai-collection (use its site form). No fit today:
awesome-ai-vtubers (no streaming surface), awesome-claude-dxt (no `.mcpb` bundle yet; building
one would unlock it), and coding-only, LLM-API-only, or framework-specific lists.
sindresorhus/awesome-nodejs has closed contributions.

---

## Crypto and Solana ecosystem

Committed with the owner's explicit approval of 2026-09-18 under the commit gate for other
crypto projects. $THREE stays the only promoted coin: every entry below pitches the
three.ws product, never another project's token. Rows marked **spend gate** move funds and
need the owner's per-action yes.

### Grants and accelerators

| # | Opportunity | Gives | Intake and dates | Present? | Next action |
| --- | --- | --- | --- | --- | --- |
| C1 | Solana Foundation regional grants on [Superteam Earn](https://superteam.fun/earn/grants) | USD 1 to 10,000 in USDG, milestone-based, decided about monthly | Open; 20+ regional listings. Distinct from the tracked solana.org public-good grant | No | Apply on the listing for the owner's legal region |
| C2 | [Helius Startup Launchpad](https://helius.dev/startup-launchpad) | Eight months of the Business plan, investor intros, partner discounts | Open, no deadline; working product, pre-Series A | No; Helius is already an RPC lane | Apply |
| C3 | Metaplex DAO community grant ([mip.metaplex.foundation](https://mip.metaplex.foundation)) | MPLX grants, locked one year | Request form; no amounts or deadlines published | No | Request framed around the live Agent Registry integration |
| C4 | [Colosseum accelerator](https://colosseum.com/accelerator) | USD 250,000 pre-seed, 12 weeks | Entry through a hackathon; Eternal is paused | No | Enter through the World's Fair (next table) |
| C5 | Base Builder Grants (EVM) | Retroactive ETH | Nomination only | No | Low priority; keep the Base x402 leg visible |
| C6 | [Alchemy for Startups](https://alchemyapi.typeform.com/to/Ll9GdIEa) (EVM) | Three free months when switching, and co-marketing to a 14,000-contact enterprise network (per CloudCredits) | Typeform; pre-seed to Series A | No; Alchemy is the EVM balances fast path in `api/_lib/balances.js` | Apply, framed on the existing integration |

### Hackathons and events

| # | Event | Dates | Prizes | Next action |
| --- | --- | --- | --- | --- |
| H1 | [Colosseum Crypto World's Fair](https://colosseum.com/worldsfair) | Submissions due **2026-10-12** | USD 840,000 pool; Solana track USD 100,000; winners interviewed for the accelerator | Register now; confirm in the rules whether a pre-existing product may enter |
| H2 | [Solana Breakpoint 2026](https://solana.com/breakpoint) | 2026-11-15 to 17, London | Speaker, developer, creator and press forms; no deadlines published | Apply for a speaker slot on 3D agents paying over x402 on Solana |
| H3 | hackathons.solana.com "Agentic Payments" | Not scheduled; seeking sponsors | Sponsor slot | **Spend gate.** Offer a bounty track only with owner approval |
| H4 | ETHGlobal Tokyo (2026-09-25 to 27) and Mumbai (2026-11-05 to 07) (EVM) | In person | Sponsor prizes | Only if someone attends |

### Directories and lists

| # | Surface | Intake | Evidence it works | Present? | Next action |
| --- | --- | --- | --- | --- | --- |
| C7 | [solana-foundation/pay-skills](https://github.com/solana-foundation/pay-skills) (the `pay.sh` registry) | `pay catalog scaffold` a `providers/three-ws/<api>/PAY.md`, `pay catalog check`, PR | Provider PRs merged 2026-07-31 and 2026-08-13; 74 providers | No | Write the PAY.md for the paid 3D APIs with the OpenAPI URL |
| C8 | [solana-foundation/awesome-solana-ai](https://github.com/solana-foundation/awesome-solana-ai) | PR | [#198](https://github.com/solana-foundation/awesome-solana-ai/pull/198) merged 2026-07-15; last merge 2026-08-04 | No | PR under AI Agents or Developer Tools |
| C9 | [StockpileLabs/awesome-solana-oss](https://github.com/StockpileLabs/awesome-solana-oss) | PR | Last merge 2026-08-24 | No | PR the Apache-2.0 repo |
| C10 | [Phantom Portal](https://phantom.com/portal) (Explore tab) | Portal account, app listing, domain verification | Official help article | No | Create the app and verify three.ws |
| C11 | CoinGecko categories for $THREE (`three-ws`) | Token-info update request (separate from the tracked market-addition form) | Live API: $THREE sits in AI, Solana Ecosystem, and AI Agent Launchpad only | Missing from "AI Agents" and "x402 Ecosystem" | Request both categories |
| C12 | CoinMarketCap currency page | New Listing request with a tracked DEX pair | `/currencies/three-ws/` is 404; only a community profile exists | No | File the listing request with the PumpSwap pair |
| C13 | [Metaplex agents marketplace](https://www.metaplex.com/agents) | Self-serve "List your agent" | The page rendered 0 agents on 2026-09-18 | No | List the flagship registry-enrolled agents |
| C14 | [Alchemy Dapp Store](https://www.alchemy.com/dapps/submit) | Form: 400x400 logo, 50-100 word description | "AI agents on Solana" has 13 entries | No (`/dapps/three-ws` is 404) | Submit under Solana, AI agents |
| C15 | 8004market.io and 8004scan (Solana agent registry) | Register agents with the `8004-solana` SDK; the indexer lists them | 8004scan already shows three.ws agents on three EVM chains, none on Solana | No on Solana | **Spend gate** (about 0.009 SOL per agent). Register a flagship set after owner approval |
| C16 | [haoruilee/awesome-agent-native-services](https://github.com/haoruilee/awesome-agent-native-services) (472 stars) | PR or issue passing its five-criteria test | Merges nearly daily; last 2026-09-17 | No | The MCP server under tools, or the x402 APIs under payments |
| C17 | [sudeepb02/awesome-erc8004](https://github.com/sudeepb02/awesome-erc8004) | PR, or an issue the maintainer batches | [#99](https://github.com/sudeepb02/awesome-erc8004/pull/99) merged 2026-08-21 | No | Issue for the ERC-8004 agent registration in `@three-ws/sdk` |
| C18 | [BlockRunAI/awesome-finance-mcp](https://github.com/BlockRunAI/awesome-finance-mcp) (213 stars) | PR to "Blockchain & Web3" | Batch merge 2026-09-05 | No | PR the x402 MCP server |
| C19 | [tsubasakong/awesome-agent-payments-protocol](https://github.com/tsubasakong/awesome-agent-payments-protocol) | `add_resource` issue template | Weekly maintainer scans, last 2026-09-15 | No | Issue for the Solana x402 facilitator |
| C20 | Solana Compass project profile | Requires staking 20 SOL | n/a | No | **Spend gate.** Owner decision only |

### Plugin and agent registries

| # | Registry | Intake | Status | Next action |
| --- | --- | --- | --- | --- |
| R1 | [sendaifun/skills](https://github.com/sendaifun/skills) (Solana skills marketplace) | PR adding a skill | Third-party merges 2026-04-30 and 07-31; some PRs waiting since 2026-09-07 | PR a three.ws skill (embed an avatar, paid 3D over x402) |
| R2 | [ElizaOS plugin registry](https://github.com/elizaOS/eliza) (`packages/registry/entries/third-party/`) | One JSON file plus a PR | [#25865](https://github.com/elizaOS/eliza/pull/25865) merged 2026-08-23; 49 third-party entries, none 3D or avatar | Build `plugin-three-ws` (avatar embodiment plus Forge), then submit |
| R3 | [SendAI solana-agent-kit](https://github.com/sendaifun/solana-agent-kit) | Plugin PR on the v2 branch | [#567](https://github.com/sendaifun/solana-agent-kit/pull/567) merged 2026-05-14; slow since | A three.ws plugin: paid 3D generation on Solana, agent avatar |
| R4 | Virtuals ACP v2 | Register an API-only provider; graduation needs 10 sandbox transactions | Active since April 2026 | Register Forge as a provider; sandbox transactions may hit the spend gate |
| R5 | Olas Mech Marketplace (EVM) | Register a mech | `valory-xyz/mech` merged 2026-09-16/17 | EVM secondary: a text-to-3D mech |
| R6 | [Coinbase AgentKit](https://github.com/coinbase/agentkit) action providers (EVM) | PR | [#982](https://github.com/coinbase/agentkit/pull/982) merged 2026-03-17; sparse since | Low priority, behind the Solana rows |
| R7 | Superteam Earn agent API | Agents register and submit to agent-allowed listings | Live | Optional: let three.ws agents compete for bounties |

### Media

| # | Outlet | Route | Angle |
| --- | --- | --- | --- |
| E1 | Breakpoint press and creator forms | Forms on the Breakpoint page | 3D agents with x402 on Solana |
| E2 | Blockworks Lightspeed | `editorial@blockworks.co` (from a search result, not an official page) | The Solana x402 facilitator and registry numbers |
| E3 | SolanaFloor | Site contact form | A World's Fair entry or a milestone |
| E4 | Decrypt guest opinion | `editor@decrypt.co`; 500-800 words, exclusive, no self-promotion | Agents paying agents on Solana, no product pitch |
| E5 | Metaplex monthly round-up | Metaplex channels | The registry-enrolled avatar count |

Crypto-adjacent, low priority: [tradingview/awesome-tradingview](https://github.com/tradingview/awesome-tradingview)
takes community projects using `lightweight-charts`, but our charts show token data, so the entry would too.

Dropped: Base Batches 004 (closed 2026-09-10), Jupiter DAO and Uplink grants (closed),
Superteam agentic engineering grants (paused), OKX Dev Day (registration closed 2026-09-15),
X Layer AI launch grant (closed 2026-08-21), Arbitrum Trailblazer AI (complete), Optimism
Retro Funding S7 (ended 2026-07-31), helius-labs/solana-awesome (last merge 2026-03-06),
GOAT SDK (last merge 2025-08-19), Daydreams (deprecated), awesome-crypto-mcp-servers forks
with no merges since March 2026, and the solana.com x402 and AI pages and the Base ecosystem
page (no public intake). The Superteam UK agentic grant is for UK founders only.

## Dropped media and directories

agent.ai redirects to a HubSpot add-on. mcp.run redirected to another product. Composio and
Pipedream are vendor-built catalogs with no public listing path; Windsurf's marketplace is
curated. BetaList is paid and pre-launch only. Ben's Bites is paid partnerships only. Hacker
Newsletter is built only from HN front-page links, and Bytes has no submission path. LogRocket's
guest program is "not accepting new applicants" (re-check later). DigitalOcean Write for
DOnations is paused. The New Stack's contributed articles are sponsor-only. JS Party ended
2025-02-13. CGSociety shut down in January 2024. The Three.js Journey Discord needs the paid
course. aitoolsclub's submit page answered 525. There's An AI For That, Futurepedia, Smithery,
mcp.so, Glama, PulseMCP, Sketchfab, dev.to, Hashnode, and HackerNoon are already tracked
elsewhere.

---

## Second pass: the areas the first sweep skipped

Run later on 2026-09-18 over open-source funding, accelerators, awards, credibility
infrastructure, model hubs, agent registries, enterprise marketplaces, non-English markets,
community channels, creators, game jams, education, and vendor showcases. Same rules as above.

### Two cautions found on the way

- **Locale manifest mid-run.** A running `scripts/i18n-translate.mjs` rewrites
  `public/locales/manifest.json` to English only at the start of a bulk run and relists each
  locale once its catalog is complete again. Never commit that file while a translation run is
  in flight, or the next deploy ships a site with one language.
- **Animation clip licensing.** The live `/api/catalog` serves clips with an `mx-` prefix whose
  license was not checked here. Until it is, jam and education material points only at the CC0
  `/objects` library and Forge output.

### Code changes that unlock listings

| # | Change | Where | Unlocks |
| --- | --- | --- | --- |
| X1 | One shared OpenRouter attribution: `X-OpenRouter-Title: three.ws` and `X-OpenRouter-Categories: personal-agent,general-chat`, keeping `HTTP-Referer` | About 18 call sites send differing `X-Title` values today, from `api/_lib/llm.js` and `api/chat.js` to `chat/src/providers.js` | Our [OpenRouter app page](https://openrouter.ai/apps?url=https%3A%2F%2Fthree.ws) already exists (30.3M tokens in 30 days, named "three.ws chat"); one name and categories make it rank as one product |
| X2 | Point the A2A card at the real endpoint: `url` to `https://three.ws/api/agents/a2a-paid`, add `protocolVersion: "0.3.0"` and `preferredTransport: "JSONRPC"`, and exempt one free skill from the required x402 extension | `public/.well-known/agent-card.json` | [A2A Registry](https://a2aregistry.org) (411 agents, live health and `message/send` probes) and [Global A2A Registry](https://www.a2a-registry.org) (DNS-verified); also the tracked Gemini Enterprise work |
| X3 | A visible "Powered by Pollinations" credit where that image or text lane's output appears | `api/_lib/ai-image-lanes.js`, `api/_mcp3d/text-to-image.js` output surfaces | The [Pollinations app catalog](https://github.com/pollinations/pollinations) (issue template; the credit is a stated requirement) |
| X4 | `CITATION.cff` at the repo root | Added in this change | GitHub's "Cite this repository" button; prerequisite for a Zenodo DOI |

### Funding, accelerators, and awards (by deadline)

| Deadline | Opportunity | Gives | Eligibility, stated honestly | Cost | Next action |
| --- | --- | --- | --- | --- | --- |
| 2026-10-02 | Fast Company Most Innovative Companies 2027 | Editorial recognition | Open to companies | USD 995 | Owner decides on the fee |
| 2026-10-12 to 11-01 (priority) | [a16z speedrun SR008](https://speedrun.a16z.com/apply) | Up to USD 1M plus credits | Global; cohort early 2027 | Free | Apply in the priority window on the games and 3D angle |
| 2026-10-30 (early) | [31st Webby Awards](https://www.webbyawards.com) | Award; new AI categories include Coding & Developer Tools and Best Multimodal AI | Work published after October 2025 | USD 525-645 early | Enter /forge in an AI category |
| 2026-11-02, 20:00 PT | [Y Combinator W2027](https://www.ycombinator.com/apply) | The standard deal | Existing startups accepted | Free | Apply |
| 2026-11-13 | [SXSW Pitch 2027](https://www.sxsw.com/pitch) | Live pitch in Austin, March 2027 | Startups | USD 225 | Pick a category and apply |
| 2026-11-18 | Techstars Anywhere, spring 2027 | The Techstars deal | Founders in American time zones | Free | Medium fit; apply if YC and speedrun pass |
| Rolling pitch, proposals 2027-03-04 | [NSF SBIR Phase I](https://seedfund.nsf.gov) | Up to USD 305,000, non-dilutive | US small business; the PI at least 51% employed by it; a Project Pitch and invitation come first | Free | Submit a Project Pitch now |
| Rolling | [GitHub Secure Open Source Fund](https://github.com/open-source/github-secure-open-source-fund) | USD 10,000 plus a security program | Up to two maintainers in a Sponsors region, clear license and governance, community adoption | Free | Apply after the OpenSSF badge below |
| Rolling, quarterly review | [FLOSS/fund](https://floss.fund) | USD 10,000-100,000 a year | Favours widely used projects; needs a `funding.json` | Free | Publish `funding.json`, submit at `dir.floss.fund/submit` |
| Rolling | [Z Fellows](https://www.zfellows.com) | USD 10,000 stipend, optional investment | Any stage | Free | Written form plus a one-minute video |
| Not yet announced | Epic MegaGrants 2027, SXSW Innovation Awards 2027, Betaworks spring camp, AI Grant batch 5, Neo Residency, Google for Startups Accelerator: AI First | Grants and investment | Various | Free | Watch; pre-draft an open-source glTF and rigging pitch for MegaGrants |

Owner decision: `.github/FUNDING.yml` lists only `https://three.ws`, while the founder's GitHub
Sponsors listing is live with zero sponsors. Whether the repo's Sponsor button should point at a
personal account is the owner's call, so the file is unchanged.

### Credibility infrastructure (all free, all missing today)

| Item | Next action |
| --- | --- |
| Zenodo DOI | Connect GitHub on Zenodo, add `.zenodo.json`, cut a release; `CITATION.cff` is now in place |
| Software Heritage | Submit the repo through Save Code Now (the API shows it unarchived) |
| OpenSSF Best Practices badge | Register at bestpractices.dev and complete "passing"; SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, and LICENSE already exist |
| OpenSSF Scorecard | Run the `scorecard` CLI locally (the GitHub Action form is not used in this repo) |
| arXiv technical report | Needs an endorser for a first computer-science submission |
| JOSS | Weak fit for a platform; viable only for an extracted research-grade library, with full AI-assistance disclosure |

### Model hubs, agent registries, and enterprise marketplaces

| # | Surface | Intake and cost | Present? | Next action |
| --- | --- | --- | --- | --- |
| H1 | [awesome-openrouter](https://openrouter.ai/awesome) ("Works with OpenRouter", 65 apps) | PR adding `apps/three-ws/app.yaml` and a logo; requires bring-your-own OpenRouter key, which `docs/assistant-widget.md` documents | No | PR with the `creative` and `chat` tags |
| H2 | llms.txt directories: directory.llmstxt.cloud (3,841 sites), llmstxthub.com (2,645), llmstxt.site | Free forms or PRs | No | Submit `https://three.ws/llms.txt` to all three free tiers |
| H3 | [ModelScope MCP Square](https://www.modelscope.cn/mcp) (12,489 servers) | Sign in, create an MCP service; list `npx @three-ws/mcp-server` as local-only | No 3D server | Create the three.ws 3D Studio entry (bilingual name) |
| H4 | Postman API Network | Public workspace from `public/.well-known/openapi.yaml`, an MCP collection, then email `api-network@postman.com` | No | Create both, then email |
| H5 | Hugging Face MCP Spaces | A Gradio Space with `mcp_server=True` gets the MCP badge and one-click install | The existing Space is static | Build a thin Gradio Space over the free Forge lane |
| H6 | Databricks Marketplace (MCP listing) | Provider sign-up, Unity Catalog workspace; `/api/mcp` already offers dynamic client registration | No | Owner decision |
| H7 | Nanda Town 2 (MIT Project NANDA), GoDaddy Agent Name Service | YAML PR / domain-anchored registration | No | Low priority |

Dropped: Groq, Cerebras, SambaNova, and SiliconFlow showcases (curated, no intake), Kaggle Models
(avatars are not ML models), Civitai 3D (no uploads yet), APIs.guru (stale), RapidAPI (gateway
model conflicts with keyless and x402), agents.json (no registry), Microsoft Agent Store (needs
a Teams app), Snowflake, Atlassian Rovo, Oracle Fusion, ServiceNow, and Zoom (no public catalog
or weak fit).

### Non-English markets

The site already ships 63 locales, including zh-CN, ja, ko, es, pt-BR, hi, and ru, so the
product is ready before the outreach is. Two gaps come first: there is no translated README
(Chinese curators send readers to GitHub), and translation happens in the browser, so the
server's `<html lang="en">` may hide translated text from Baidu and Naver. Test reachability
from mainland China before investing in Chinese venues.

| # | Venue | Intake and rule | Audience | Next action |
| --- | --- | --- | --- | --- |
| I1 | [ruanyf/weekly](https://github.com/ruanyf/weekly) | Issue; own work welcome, competitive (663 self-recommendations since 2026-08-01) | 102.9k repo stars | One Chinese issue pitching free Forge |
| I2 | [HelloGitHub](https://hellogithub.com/periodical) | Self-recommendation on the site; monthly on the 28th | 177.3k repo stars | Submit for the 2026-10-28 issue |
| I3 | [GitHubDaily](https://github.com/GitHubDaily/GitHubDaily/issues) | Self-recommendation issue | 47.9k stars | One issue |
| I4 | [V2EX 分享创造](https://www.v2ex.com/go/create) | "Post your own latest work here" | 36,793 topics | One post after the reachability test |
| I5 | [ai-bot.cn](https://ai-bot.cn) | Email `info@ai-bot.cn`; has an AI 3D model category | 1,000+ tools | Email a listing request for Forge |
| I6 | [GeekNews Show GN](https://news.hada.io/show) (Korea) | Own products under Show; must be directly usable | not stated | One Korean post linking /forge |
| I7 | [Zenn](https://zenn.dev/publications) and Qiita (Japan) | Advertising banned; technical articles fine; free Publication by application | 1,868 publications | One Japanese technical article on retargeting or MCP |
| I8 | [TabNews](https://www.tabnews.com.br/faq) (Brazil) | Own projects if they add value; pitches titled "Pitch:" | not stated | One Portuguese technical post |
| I9 | [AIツールギャラリー](https://ai-gallery.jp/tools) | Vendor page, prices not shown | 702 tools, has a 3D category | Free tier only |
| I10 | Disquiet (Korea), Habr Q&A (Russia) | Maker profile / answer-only with disclosure | not stated | Low priority |

### Community channels and creators

| # | Channel | Rule or intake | Audience | Next action |
| --- | --- | --- | --- | --- |
| Q1 | [three.js Discord](https://discord.gg/56GBJwAnUS) | Showcase channel (read rules on joining) | 18,321 members | One retargeting or `<agent-3d>` clip |
| Q2 | Bluesky `@three.ws` domain handle | No `_atproto` TXT record today; `threews.bsky.social` exists with 0 posts, owner unknown | n/a | Owner confirms that account, adds the TXT record, asks to join the open Creative Coding starter pack |
| Q3 | [AI Tinkerers](https://aitinkerers.org) | "Demos over decks", free chapter events | 261 chapters, 133,274 members | Apply to the nearest chapter with a prompt-to-rig-to-embed demo |
| Q4 | r/SideProject, r/webdev Showoff Saturday, r/ClaudeAI "Built with Claude" | Show-and-tell rules (secondary; Reddit blocks automated reads) | not verified | Owner reads rules in a browser; one post each on separate days |
| Q5 | Hugging Face, Comfy, Blender, WebXR, Latent Space, Poimandres Discords | Showcase channels behind a join | 4k-238k members | Share only after the matching listing is live |
| Q6 | Blender Stack Exchange | Answer-only with disclosure; 60 rigging questions in 90 days | n/a | Answer where the rigging tools genuinely solve it |
| Q7 | [3dprinting.com AI 3D generators guide](https://3dprinting.com/software-guides/ai-3d-model-generators/) | "Tried a tool we should add? Tell us" on its social pages | not stated | Reply with /materialize and its printability report |
| Q8 | [Wawa Sensei](https://wawasensei.dev) | `contact@wawasensei.dev` | 32k YouTube | Pitch a free React Three Fiber collaboration |
| Q9 | AlphaSignal editorial | `editorial@alphasignal.ai` | 180,000+ (secondary) | Pitch the MCP fleet as a technical story |

Paid only, owner decision: Theo (t3.gg sponsorship, price undisclosed), Superhuman AI (USD 3,500
per featured tool). Dropped: the MCP Contributors Discord (bans product marketing), Stack
Overflow (too little three.js and MCP traffic), Lobsters (invite-only, 70-day wait for Show),
Toolify and Juejin (unverifiable), CSDN, SegmentFault, OSChina (no intake), Fireship and Bruno
Simon (no intake).

### Game jams, education, and vendor showcases

Prizes would be Pro time: an admin can grant the `pro` tier today (`api/_lib/account-tier.js`),
but there is no promo-code path, so each winner is granted by hand.

| When | Opportunity | Intake | Next action |
| --- | --- | --- | --- |
| 2026-09-28 to 30 | [Slapjam AI #1](https://itch.io/jam/slapjam-ai-1) | `sponsor@slapjam.ai`; sponsors are AI asset tools; 3D allowed | Email this week offering Pro grants and the free Forge API |
| Every two weeks | [Micro Jam](https://itch.io/jam/micro-jam-065) | `tommy@microjam.dev`; sponsors get a named category; AI allowed | Propose "Best 3D with three.ws" |
| 2026-09-23 to 11-04 | [Game Gauntlet SIM Jam](https://itch.io/jam/game-gauntlet-sim-jam) | Sponsor form at gamegauntlet.gg; AI allowed if disclosed | Ask about an in-kind tool prize |
| 2026-11-01 to 12-01 | [GitHub Game Off 2026](https://itch.io/jam/game-off-2026) | No sponsor slot; a resources thread is a post | Draft a free CC0 props and text-to-3D thread for 2026-11-01 |
| Any time | [Kaggle Community Hackathon](https://www.kaggle.com/competitions?new=true&type=hackathon) | Free to host; confirm who funds prizes on the form | Draft a "give an AI agent a 3D body" hackathon |
| 2026-10 events | [lablab.ai](https://lablab.ai/sponsor), [MLH](https://sponsor.mlh.com/) | Sponsor forms, prices unpublished | Ask whether a content partnership is free |
| December | [Hour of AI](https://csforall.org/en-US/hour-of-ai/faq) (Code.org, CSforALL) | Window closed; email `hourofai@code.org` | Ask when the next window opens; pitch only the sign-language learning pages |
| Rolling | [GitHub Student Developer Pack partner](https://github.com/education/partners) | Offer must be free to students; 5-10 partners a year | Build a student Pro redemption path first |
| Rolling | [MediaPipe showcase in Google AI Studio](https://developers.googleblog.com/jump-to-play-building-with-gemini-mediapipe/) | Publish an AI Studio app, email `mediapipe-community@google.com` | Remix the fingerspelling grader (`src/sign-input.js`), then email |
| Rolling | Microsoft Store as a PWA | Partner Center, no registration fee, certification up to 3 business days; package with PWABuilder | Read the Store's financial-services policy, then package |
| Rolling | Meta Horizon Store as a PWA | `@meta-quest/bubblewrap-cli`; the TWA pipeline exists in `solana-mobile/twa` | Build a Quest APK and sideload-test it |
| Rolling | [pwa.directory](https://pwa.directory/submit) (705 apps) | Free, up to 4 weeks | Submit |

Dropped vendors: Upstash (production Redis is self-hosted behind a compatible proxy, so a
customer story would be false), Neynar and LiveKit (not configured in production), Resend
(curated customers page), meshoptimizer, Playwright, Puppeteer, ONNX Runtime, and Avaturn (no
intake). Dropped jams: js13kGames (ended 2026-09-13), Ludum Dare 60 (no sponsor intake),
Scream Jam and others banning generative AI, Devpost's 3D Websites Hackathon (ended
2026-09-18; watch for the next edition).
~~~~

