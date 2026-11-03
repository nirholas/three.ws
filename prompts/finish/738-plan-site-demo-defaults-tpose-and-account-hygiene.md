# Demo pages stop shipping T-pose avatars, QA accounts and real-person likenesses as defaults

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/738-plan-site-demo-defaults-tpose-and-account-hygiene.md`.

**Priority:** P2, new capability with clear value (score 48 of 100 inside the tier). **Area:** site. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The operating rules say a bind-pose T-pose is never shipped as a default, yet the filming run found it as the default avatar on `/playground`, `/avatar-sdk`, `/restyle`, `/pocket` cartridge 01 and thumbnails on `/characters` and `/rankings`. Public boards also show the QA test account and wallet dollar values, and two pages default to the likeness of a real person. These are the first things a new visitor sees on the highest-intent pages.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Pages exist: `pages/playground.html`, `pages/avatar-sdk.html`, `pages/restyle.html`, `pages/pocket.html`, `pages/rankings.html`, `pages/labs.html`; `/characters` and `/avatar-engines` and `/render-lab` per the findings.
- `src/animations-live-preview.js` uses `/avatars/cz.glb` as the stage avatar (a real person's likeness tied to another crypto project).
- The findings list per page: T-pose defaults, a public QA account on `/characters` and `/rankings`, wallet dollar values and launchpad descriptions on character cards, a translucent sticky filter bar on `/avatar-engines` that lets headings bleed through, and `/render-lab` listing one model twice.
- Gate note: removing references to other crypto projects from UI copy is allowed (it removes, not adds), but a commit whose diff mentions another project requires owner approval.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
grep -rn "cz.glb" src pages public --include=*.js --include=*.html | head
grep -rln "bindpose\|T-pose\|tpose" src/playground* src/avatar-sdk* src/restyle* src/pocket* 2>/dev/null | head
curl -s "https://three.ws/api/characters?limit=20" | python3 -c "import json,sys;d=json.load(sys.stdin);print([ (c.get('name'),c.get('owner')) for c in d.get('characters',d.get('items',[]))][:20])"
curl -s https://three.ws/api/rankings 2>/dev/null | head -c 600
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Pick one rigged, idling default avatar (an existing CC0 or house-made GLB already in `public/avatars/`, `ls public/avatars | head`) and make every page above start it with an idle clip from the animation library (`src/animation-manager.js` or the equivalent loader) so it never shows bind pose. Add a small shared helper `src/default-stage-avatar.js` so the default lives in one place, with a Playwright check in `tests/e2e/` that samples a frame and asserts the skeleton is not in bind pose (compare bone quaternions to the rest pose from the loaded skin).
2. Replace the real-person likeness defaults (`cz.glb` in `src/animations-live-preview.js`, `/render-lab` default, `/avatar-sdk` playground) with the same house default; keep user-provided avatars working.
3. Hide the QA/test accounts and zero-value rows from public boards: add a server-side exclusion in the rankings and characters APIs (`api/rankings*.js`, `api/characters*.js`, find with `ls api | grep -iE "rank|character"`), based on an explicit `is_test` marker or the QA account id from the self-unblock playbook (`.claude/skills/self-unblock-playbook/SKILL.md`), plus tests. Do not show wallet dollar values on public cards.
4. Fix `/avatar-engines` sticky filter bar (opaque background, z-index), the duplicate chip in `/render-lab`, the doubled tooltip on its sheet button, and `/restyle` control placement so presets and Reset stay visible beside the 3D view; verify 18 PBR presets appear in the page body, not only the meta description.
5. `/agent-identities`-style empty boards: give `/walk-leaderboard`, `/daily-match`, `/reputation/market`, `/diorama`, `/world-lines`, `/crews` designed empty states that say how to take part (real links, no fake data).
6. Browser-verify each page at desktop and 400px widths; hover/focus/active states on every control touched.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -rn "cz.glb" src pages` returns nothing.
- [ ] The e2e bind-pose test passes for playground, avatar-sdk, restyle and pocket.
- [ ] The characters and rankings API tests assert no test account rows are returned.
- [ ] Screenshots from a real browser of each page show an idling avatar and no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Unsure which avatar is house-owned | Use one under `public/avatars/` with a licence recorded in `public/avatars/README.md` or `docs/`; generate a new one through the free Forge text-to-3D lane if none qualifies. |
| QA account id unknown | The self-unblock playbook names the QA login; identify it by email pattern in the DB instead of hardcoding names. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Removing the other-coin likeness and copy is a deletion. If any diff line must mention another crypto project by name (for example in a test fixture), stop and ask for owner approval for that commit, batched with other asks at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/738-plan-site-demo-defaults-tpose-and-account-hygiene.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `738-plan-site-demo-defaults-tpose-and-account-hygiene.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ops/x-story-findings-2026-09-30.md` (section "Defects on surfaces that were announced or are otherwise fine")

~~~~markdown
## Defects on surfaces that were announced or are otherwise fine

- **`/herald`:** the documented import `import { createHerald, pollSource } from 'https://three.ws/herald.js'` has no exports in the served file; only `window.threeHerald` works. The page says the card presenter takes over under reduced motion; it does not (only without WebGL). The playground cannot show dedupe because each send gets a fresh id. The companion introduces itself with a random guest name about 9.6 s after load; the name list includes a word that reads as an exchange name.
- **`/docs/world`:** pressing `/` opens both the Docs World search and the site-wide command palette on top of it. "Shift+Enter has the world walk you there" lays a trail but the avatar does not move (the tour, the tooltip and `docs/docs-world.md` all overstate it). The social description says 14 sections; the index has 15. The Top Down camera shows only the hub, not the ring.
- **`/drive`:** `/api/tts/edge` answers 401 before the fallback succeeds, a console error on every turn. The model reply is uncontrolled and once volunteered a third-party launchpad; re-films need their frames checked.
- **`/glance`:** the SVG card in an `<img>` shows a broken-image icon where the agent thumbnail should be (an external image cannot load inside an SVG used as an image; it needs a data URI). The card prints a raw event name ("last: load-end 3d ago"). Of 600 published agents none has "Moves today" above 0, because chats do not count as moves. At 720 px the 480 px card overflows its panel. `/api/glance/token` returns 401 on every signed-out load. `?agent=` links leave the Agent dropdown on the featured agent.
- **`/3d`:** the live badge is stuck on "CHECKING…" (i18n rewrites `#liveBadge` after `setLive` runs). `footer.foot` renders `position:absolute` over the stats cards on the first screen.
- **`/inspect`:** "Non-collapsed bounds" reports raw quantized units for meshopt models, not world units.
- **`/render-lab`:** the default model is a crypto personality likeness; one model appears twice in the chips; the sheet button leaves a doubled tooltip.
- **`/avatar-sdk`:** the hero viewer shows a bind-pose T-pose, which the operating rules say never to ship, and the playground offers a real person's likeness.
- **`/avatar-engines`:** the sticky filter bar is translucent and family headings bleed through it while scrolling.
- **`/characters`:** user cards show wallet dollar values, launchpad descriptions, a public QA test account, and T-pose thumbnails.
- **`/widgets`, `/integrations`, `/timeline`:** name third-party coins, exchanges and launchpads in chips, cards and milestones, so none can be filmed under the coin gate.
- **`/wardrobe`:** the page's intro names a stablecoin above the fold; the reel starts below it.
~~~~

### `docs/ops/x-story-findings-2026-09-30.md` (section "Added 2026-10-01")

~~~~markdown
## Added 2026-10-01

A second wave of authors covered labs, voice, restyle, agents and the marketplace. The same rule
holds: a surface that did not pass is listed here instead of being posted.

### Could not be announced

| Surface | What happens |
|---|---|
| `/pocket` | Cartridge 01 stays in a T-pose and slides when steered; the A button reports a wave as played while the character stays idle; cartridge 03 renders with its arms locked straight overhead. Walking and turning with the D-pad work. |
| `/agent-identities` | "View in 3D" spins on "Loading the rigged avatar" forever: the page loads only the decoder shim (`/model-viewer-meshopt.js`) and never the `model-viewer` library, so the element never starts (`ensureModelViewer` in `src/agent-identities.js`). |
| `/create/video` | Signed-out visitors get the sign-in page, and `GET /api/avatar/video-generate` answers `"available": false, "reason": "worker_unconfigured"`: the talking-video renderer is not deployed, while `docs/talking-avatar-video.md` shows `"available": true`. |
| `/motion-swap` | The only way in is a video upload, with no public sample and no finished job to reopen. |
| `/playground` | The default model renders in a bind-pose T-pose. |
| `/restyle` | Works, but the default sample avatar stands in a T-pose, so its reel shows one. The story is filmed and held as paused until the sample idles. The lower presets, seeded variants and Reset sit far below the 3D view, so using them scrolls the model away; "18 PBR material presets" on `/docs/restyle` is only in the meta description. |
| `/globe` | Works, and the story is filmed, but held for the owner: it shows conflict and force-posture layers over military bases and nuclear sites, and the conflict layer misclassifies (a story about US House district maps tagged as conventional military force). The 30-day request takes 4 to 16 s. |
| `/sonar` | Works and was filmed, then withdrawn: the stage avatar (`/avatars/cz.glb`, used by `src/animations-live-preview.js`) is the likeness of a figure tied to another crypto project. After a push zoom the head leaves the frame. |
| `/labs` | `categorize()` in `src/labs.js` files every page it does not recognise as x402, so Animation Gallery and Character Library are badged and filtered as x402. A filter scrolls a heading naming another coin into view, and that heading contains an em-dash. Its live card previews slow the browser so badly that a 9 second scenario took 11 minutes. |
| `/rankings` | The Creations board shows the public QA account and T-pose thumbnails. (Medal emoji drawn as empty boxes were the filming machine missing a colour emoji font, not the page.) |
| `/walk-leaderboard`, `/daily-match`, `/reputation/market` | Effectively empty (one walker, one competitor, no stakes). |
| `/search`, `/ledger`, `/showcase` | Results, decision rows and chain chips name third-party coins and chains. `/search` returns twelve generations all titled the same for one query. |
| `/hydrate`, `/bundles` | A connect-wallet wall and a sign-in wall, with nothing to show signed out. |

### Defects on surfaces that were announced

- **Voice:** Gemini voices fail synthesis with 502 or 503 ("the provider rejected this deployment's credentials") while the catalog lists them as available, so the catalog moves between 357 and 327 voices. A cached clip's status line drops its billing note because the billing header is missing on cache hits.
- **Drive:** the agent reached "Speaking" in every run on a quiet machine and timed out at 60 s twice under heavy load; worth watching, not yet a defect.
- **Spelling gate:** rejects "metalness", "GDELT" and "chokepoints"; authors worded around them.

### Fixed after filming found them

- **`/spotlight` entry:** the agent stood in a T-pose with a second, T-posed copy behind it. The copy
  was the preview thumbnail left under the transparent viewer (the page watched for a canvas that
  `<agent-3d>` draws inside its shadow root); the T-pose was `<agent-3d>` painting every body in its
  bind pose before the idle clip arrived. Both are fixed: the viewer is revealed on `agent:ready`, and
  the element stays hidden until the first clip has rendered. Thumbnails rendered by
  `api/_lib/render-glb.js` are still T-posed and still show for a second while the 3D loads.
- **`/monitor`:** the default fleet sort is by latest real action, but the control said "most
  active". It now says "recently active" in every locale.

### Google Cloud billing

On 2026-10-01 every Vertex AI and Gemini API call from project `aerial-vehicle-466722-p5` answered
`403 Lightning dunning decision is deny`: the billing account behind the project is in dunning, so
the strongest editor rung (Claude on Vertex) and the default translation backend are both refused
until billing is settled in the Cloud console. The editorial chain kept working on the NVIDIA rung.

### The X account

On 2026-10-01 the X API answered `402 credits depleted` to every read and every post, so nothing could be published until the account's API credits are topped up in the X developer console. The credits belong to the app, and the app is shared by the content queue, the changelog's X lane, the Sentiment Scout's recent search (billed per returned post, guarded only by rate limits), and users' connected-X features (scheduled posts, triggers, and a metrics fetch every six hours). The console's usage breakdown says which of them spent it.
~~~~

