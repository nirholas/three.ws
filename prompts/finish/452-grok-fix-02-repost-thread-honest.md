# 452 grok-fix-02: Rewrite the Grok for Startups thread with nothing it cannot prove

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`. Read `CLAUDE.md` and the "Saying it correctly" section of `prompts/finish/_context/grok-startups-00-CONTEXT.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; stage explicit paths only and commit promptly with a message that describes the diff. Posting to X is owner-only: you write the draft, you never post. This order is independent of orders 451 and 453 to 458.

**Owner approval carried by this file:** the owner running this order IS the explicit approval to commit the rewritten thread doc with the funding source post 8 already names (the creator-rewards platform and its tag), which the CLAUDE.md commit gate otherwise holds. No other non-$THREE crypto project may appear in your diff. It is not approval to push.

## Why

On 2026-11-27 xAI (the Grok for Startups team) asked three.ws to take the 2026-11-25 announcement thread down: "Being accepted gives you access to credits, but it doesn't include co-marketing and the other items in your X post." The owner will delete the old thread and repost a corrected one. The file is [docs/x-posts/2026-11-25-grok-for-startups-announcement.md](../../docs/x-posts/2026-11-25-grok-for-startups-announcement.md).

## What the audit found (re-verify each against the repo before you rely on it)

- **Post 1:** "first crypto-native company approved" is unprovable (xAI publishes no member list). "working directly with the xAI, @SpaceXSI and Cursor teams on co-marketing" is false. "our plugin is headed to the Grok Bot, Grok Build and @cursor_ai marketplaces" is false (nothing submitted; see `docs/partners/grok-bot-listings.md`). Replacement claims: "three.ws is a member of xAI's Grok for Startups program." / "xAI accepted three.ws into Grok for Startups." Program = API credits.
- **Post 3:** "Grok checks its own work ... caught before you ever see it" and "This one looks first" are guarantees. Grok runs `look_at_model` only when it decides to. Say "Grok can check its own work" and drop the guarantee. Re-verify the "426 checks" figure or drop it.
- **Post 5:** "works everywhere you use Grok: grok.com, Grok Bot, Grok Build, Cursor and the xAI API." Only the grok.com custom connector and Grok Bot have real use (31 Grok Bot sign-ins, the 195.8 s timed run). Grok Build never ran a model turn; the xAI API path was broken in production from 2026-11-21 until the schema fix deploys; Cursor connects but is not listed in any marketplace. Drop the `@ericzakariasson` tag (it implies xAI involvement). Only name a surface you can cite evidence for at the moment you write: check `git log` and `prompts/finish/_context/grok-fix-PROGRESS.md` for later proofs (orders 451 and 458 may have proven the xAI API and Grok Build live by then; if so, name them; if not, do not).
- **Post 6:** the six-example claims ("One command runs all six ... so you know they work", the X search summary, "82 seconds") were measured with no xAI key. Only use claims a later live run proved (see the progress log). Otherwise rewrite as "six runnable examples for the Grok API, with the three.ws side tested against production" and drop the 82 seconds. Drop `@XDevelopers`.
- **Post 7:** "Grok was using us before we got in", "5,547 tool calls", "718 distinct prompts written by people and agents we have never met", "Traffic every single day", "2 errors". The calls include our own testing and the synthetic probe; the 718 is a 60-character prefix heuristic; model counts are calls, not finished models. Safe form: "5,547 tool calls on our Grok connector in 44 days, and 718 distinct prompts that don't match our own tests or demos." If `docs/partners/xai-comarketing-kit.md` has been refreshed with probe-excluded figures by the time you run (order 455), use those, with their date range.
- **Post 8:** "xAI vets every applicant" and "Guides to the program say it looks for venture-backed startups" are unsourced claims about xAI's process. Keep the true part: no VC, funded by the creator rewards post 8 already names, accepted into the program.
- **Posts 2, 4, 9:** accurate as written. Keep them.

## Add (each only if verified at write time)

- **Ask @grok on every model page.** Verify: `curl -s https://three.ws/ | grep -o 'grok-ask[^"]*' | head -1`, or load any `/m/<id>` model page bundle and confirm the Ask @grok button. If live, it is a natural closer near post 9.

## Step 0

1. `git log --oneline -10 -- docs/x-posts/2026-11-25-grok-for-startups-announcement.md` and read the current file in full.
2. Read `docs/partners/xai-comarketing-kit.md` (numbers appendix), `docs/partners/grok-bot-listings.md`, `prompts/finish/_context/grok-startups-PROGRESS.md` and `prompts/finish/_context/grok-fix-PROGRESS.md`. Every number you keep must trace to one of them or to a command you run now.

## Tasks

1. Rewrite the file in place as the repost. Keep its structure (posts numbered, media notes, the under-280-character hook at the start of each post, UTM links with `utm_content=repost`). Head the file with a short dated note: the original was taken down on xAI's request on 2026-11-27; this is the corrected version; what changed and why (one line each). Do not name the xAI staff member or quote their email address.
2. Every claim in the new thread gets a one-line source in an HTML comment or a "Sources" section at the end of the file (file path, commit, or command). A claim without a source is cut.
3. No tag of any xAI, SpaceXSI or Cursor employee or official account in a way that implies they took part. `@grok` in post 9 as a question to the bot is fine.
4. Check every link in the thread returns 200: `curl -s -o /dev/null -w '%{http_code}\n' <url>`.
5. Run the dash and wording checks: `grep -nP '\x{2014}|\x{2013}' <file>` prints nothing; `grep -niE 'co-market|partner|marketplace|first crypto|working directly' <file>` prints nothing outside the dated note.
6. Commit only that file (plus any media file you changed) with a message like `docs(x-posts): rewrite the Grok for Startups thread without the claims xAI asked us to remove`.

## Definition of done

- [ ] The thread doc is the corrected repost, with a source for every kept claim.
- [ ] None of the overclaims above survive; posts 2, 4 and 9 kept.
- [ ] Every link returns 200; no em-dash or en-dash.
- [ ] Committed with explicit paths; nothing pushed; nothing posted.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Report format

Print the full final thread text in the chat (the owner will paste it into X), then the list of claims removed, claims kept with their sources, and the commit hash.
