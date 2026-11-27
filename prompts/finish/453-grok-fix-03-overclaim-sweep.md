# 453 grok-fix-03: Remove every Grok for Startups overclaim outside the announcement thread

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`. Read `CLAUDE.md` and the "Saying it correctly" section of `prompts/finish/_context/grok-startups-00-CONTEXT.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; stage explicit paths only and commit promptly with a message that describes the diff. Never post, email or submit anything externally. This order is independent of orders 451, 452 and 454 to 458. **Do not edit `docs/x-posts/2026-11-25-grok-for-startups-announcement.md`**: order 452 owns it.

**Commit gate:** if a file you edit already references a crypto project other than $THREE and your diff touches those lines or the commit message would name it, leave those lines untouched. If you cannot fix an overclaim without touching such a line, skip that hunk, finish everything else, and list the file and line in your report as needing owner approval. Do not commit it.

## Why

On 2026-11-27 xAI asked three.ws to remove its announcement because the Grok for Startups program grants API credits only: "it doesn't include co-marketing and the other items in your X post." The same claims were written into pages, docs, plans, queued X drafts and an unsent email. Any of them going live repeats the problem. Facts to hold to:

- The program gives API credits. There is no co-marketing, no marketplace placement, no featured listing, no working relationship with the xAI, SpaceXSI or Cursor teams, and no partnership.
- Approved claim: "three.ws is a member of xAI's Grok for Startups program." Never "partner", "backed by", "official", "endorsed", "working with the xAI team", "first crypto-native company approved".
- Nothing has been submitted to the Grok Bot, Grok Build, Cursor or xAI plugin marketplaces (`docs/partners/grok-bot-listings.md`: "Nothing here has been submitted"). A listing may be described as "prepared" or "planned", never as "headed to", "coming to" or "in" a marketplace.
- Until the xAI schema fix (`a99f32c10`) is deployed, the xAI API path does not work in production. Check: the `tools/list` root-schema check in step 0.

## Step 0

1. Production state:
   ```bash
   curl -s https://three.ws/api/mcp-grok -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s.replace(/^data: /m,""));console.log(m.result.tools.filter(t=>{const r=t.inputSchema||{};return r.type!=="object"||["anyOf","oneOf","allOf","not","if","then","else","enum","const"].some(k=>k in r)}).map(t=>t.name))})'
   ```
   `[]` means fixed in production.
2. Find candidates. Run and read every hit:
   ```bash
   git grep -n -i -E "co-?market|reshare|amplif|working (directly )?with (the )?(xai|spacex|cursor)|xai partner|grok partner|partnership with xai|backed by xai|official grok|endorsed|first crypto|headed to the|coming to the (grok|cursor)|featured (by|in) (xai|grok)|marketplace" -- pages public/*.html public/grok-skill.md src docs data/x-content data/partner-programs.json data/pages.json api integrations examples ':!docs/x-posts/2026-11-25-grok-for-startups-announcement.md' ':!data/changelog.json' | grep -i -E "grok|xai|x\.ai|spacex|cursor"
   ```
   Also open and read in full: `pages/grok.html`, `docs/grok.md`, `docs/partners/xai-comarketing-kit.md`, `docs/partners/xai-grok-startups-plan.md`, `docs/partners/grok-bot-listings.md`, `prompts/finish/_context/grok-OWNER-ACTIONS.md`, the `xai-grok-for-startups` row in `data/partner-programs.json`, `/partners/benefits#xai` source, and every `grok-*` item in `data/x-content/queue.json` (list them with `node -e 'const q=require("./data/x-content/queue.json");(Array.isArray(q)?q:q.items||q.queue).filter(i=>/grok|xai/i.test(JSON.stringify(i))).forEach(i=>console.log(i.id,i.status))'`).

## Tasks

1. **Classify every hit** as: (a) a public claim (live page, skill file, plugin or connector description, queued post), (b) an internal plan or doc that a person might copy into public copy, or (c) a correct statement (for example "the program gives credits only", or an accurate description of a different program). Leave (c) alone.
2. **Fix (a) and (b).**
   - Pages and public files: rewrite to the approved claim; remove any co-marketing, reshare or marketplace promise. If `pages/grok.html` says the xAI API or "everywhere you use Grok" works and step 0 shows production is not fixed, scope the line to what works (grok.com custom connector and Grok Bot) rather than deleting the section.
   - `docs/partners/xai-comarketing-kit.md`: the unsent email to the startups team asks for co-marketing and reshares. xAI said the program includes none of that. Rewrite the email as a short, factual product update that asks for nothing the program does not offer (or remove it if it has no remaining purpose), and rename the doc's framing from "co-marketing kit" to what it now is. Keep the numbers appendix (order 455 owns refreshing it). If you rename the file, update every link to it (`git grep -n xai-comarketing-kit`).
   - `docs/partners/xai-grok-startups-plan.md`: rows that plan co-marketing asks or marketplace featuring get marked dropped with the 2026-11-27 reason in one line each; do not delete history.
   - `prompts/finish/_context/grok-OWNER-ACTIONS.md`: remove or mark dropped the owner actions for the co-marketing email and the co-marketing posts.
   - `data/x-content/queue.json` (hot file: re-read immediately before each edit, small anchored edits): for each `grok-*` draft, fix any overclaim in its text; a draft whose whole premise is a program benefit that does not exist gets `"status": "dropped"` with a `"note"` giving the reason. Do not change any item's `status` to anything that would publish it.
   - `data/partner-programs.json`: the row's benefits must list credits only.
3. **Tests.** If a test pins copy you changed (`git grep -n` the old string under `tests/`), update it to the new honest copy. If `pages/grok.html` copy is checked by a test or a build step, run it.
4. **Verify.** Rerun the step 0.2 grep; every remaining hit must be class (c). `npm run build:pages` if you touched `data/pages.json` or the changelog. `npm run audit:docs`. `grep -rnP '\x{2014}|\x{2013}'` on every file you changed prints nothing.
5. **Changelog.** If a live page changed, append one `data/changelog.json` entry (tags `docs` or `fix`, link `/grok`), then `npm run build:pages`.
6. **Commit** in topical commits with explicit paths, for example `docs(grok): describe Grok for Startups as the credit program it is on every page and plan`.

## Definition of done

- [ ] Every hit from step 0.2 classified; every (a) and (b) fixed or listed as commit-gated.
- [ ] No queued X draft or live page promises co-marketing, a marketplace placement, or an xAI relationship.
- [ ] Tests that pin changed copy updated and passing; `npm run audit:docs` passes.
- [ ] Nothing posted, emailed, submitted or pushed.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Report format

A list of files changed with the claim removed from each (one line each), the queue items dropped, any hunk left for owner approval, and the commit hashes.
