# 452 grok-fix-02: Assemble the final Grok for Startups repost thread (run LAST)

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`, **after** orders 451, 454, 456, 457 and 458 have run (or after as many of them as will run today). Read `CLAUDE.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; stage explicit paths only and commit promptly with a message that describes the diff. Posting to X is owner-only: you finish the draft and print it, you never post.

**Owner approval carried by this file:** the owner running this order IS the explicit approval to commit `docs/x-posts/2026-11-27-grok-for-startups-repost.md` with the funding source its post 11 names (the creator-rewards platform and its tag), which the CLAUDE.md commit gate otherwise holds. No other non-$THREE crypto project may appear in your diff. It is not approval to push.

## The owner's decision (do not re-litigate)

On 2026-11-27 xAI asked us to take the 2026-11-25 thread down because the program gives credits and does not include co-marketing. The owner decided: **keep the original thread exactly as written, remove only the co-marketing clause from post 1, and add posts for the Grok work built since.** "The first crypto-native company approved", "our plugin is headed to the Grok Bot, Grok Build and @cursor_ai marketplaces", the original numbers' framing, and the original tags all stay. Do not cut or soften them. Do not reintroduce co-marketing or a working relationship with the xAI, SpaceXSI or Cursor teams.

Owner decisions of 2026-11-27, also final: tags are company accounts only, never individual staff. Post 1 mentions @SpaceXSI as a plain company mention with no relationship claim, and the personal tag that was in post 6 stays removed. The repost carries no error count: the usage post (post 10) and its card drop "2 errors", so never add an error figure back. Post 1 says the approval comes with credits across Grok, Grok Build, Grok Bot and the Grok API, and never states an amount, tranche or expiry (the program terms keep those confidential). The thread is thirteen posts; the lower-priority new work lives in a companion X Article that post 12 quotes, so never add those posts back to the thread. Media is clean black cards drawn by `scripts/grok-startups-repost-cards.mjs`, with video only where a real render exists (posts 1, 4 and 5), and the 3D subjects are a rocket (article image), an electric sports car, an electric pickup and a humanoid robot.

The draft is [docs/x-posts/2026-11-27-grok-for-startups-repost.md](../../docs/x-posts/2026-11-27-grok-for-startups-repost.md): thirteen posts, complete except the refreshed numbers in posts 3 and 10 and the article link in post 12. Its media is in `public/x-media/grok-startups-repost/` (one file per post, listed in the draft's Media section). `docs/x-posts/2026-11-25-grok-for-startups-announcement.md` holds a stricter rewrite (`ed86dc046`) that the owner did not choose; leave it alone and do not copy from it.

## Step 0

1. `git log --oneline -15` and read `prompts/finish/_context/grok-fix-PROGRESS.md` in full: it records what 451, 454, 456, 457 and 458 proved. Read the repost draft in full.
2. Production connector check. Both lines must print `rejected: []`:
   ```bash
   for p in mcp-grok mcp-studio; do curl -s https://three.ws/api/$p -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s.replace(/^data: /m,""));const bad=m.result.tools.filter(t=>{const r=t.inputSchema||{};return r.type!=="object"||["anyOf","oneOf","allOf","not","if","then","else","enum","const"].some(k=>k in r)}).map(t=>t.name);console.log(process.argv[1],m.result.tools.length,"tools, rejected:",bad)})' $p; done
   ```
   If either is not empty, the deploy (order 451) has not landed and Grok cannot use three.ws through the xAI API. Finish every task below anyway, and put "Do not post until order 451 has deployed" as the first line of your report.
3. `DATABASE_URL`: `export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"`. If it fails with a gcloud reauthentication error, the owner must run `gcloud auth login nich@sperax.io` in a terminal on this machine; do every task that does not need the database first and report that one line.

## Tasks

1. **Refresh posts 3, 15 and 16.** `node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to <yesterday>` (read its header for flags). Update the figures in post 3 ("426 checks") and post 10 (tool calls, days, the five generation counts, distinct prompts) and the window ("in 44 days") to the refreshed totals, keeping each sentence's wording otherwise identical. Write the same figures to `public/x-media/grok-startups-repost/src/usage.json` so the cards match the text: keys `window` (the card's label), `calls`, `days` ("N of N"), `prompts`, `renders` and `weeks` (`[["Oct 5", 1125], ...]`, week starts), formatted as in `USAGE` in `scripts/lib/grok-startups-cards.mjs`; never edit `USAGE` itself, which the 2026-11-25 thread's cards read. If the script now excludes our own probe or test traffic, use what it prints; never add our own traffic back. If the database is unreachable, keep the original figures and say so in the report. The uptime figures belong to the companion article, not the thread: if the article quotes them, they must match the `src/live.json` that task 4's render writes.
2. **Evals are not in the thread.** The measured Grok evals belong to the companion article; leave the thread at thirteen posts.
3. **Prove each post's surface is live now.** One check each, recorded in the draft's Sources section with today's date:
   - Post 5: the launch stack cutaway URL returns 200 and its page source or `/api/anatomy` record names 29 parts and 10 steps.
   - Posts 6 and 8: the progress log shows order 451 (xAI API live) and 458 (all six examples passed live). If 458 recorded that one example still fails, rewrite only the specific sentence in post 8 that it contradicts, and say so.
   - Post 7: the plugin directory still has `make-3d`, `rig`, `embed`, `three-ws-init` and `3d-art-director`, and `integrations/cursor/three-ws/commands` still has `make-3d`, `rig` and `embed`. Note 458's Grok Build result in Sources.
   - Post 9 (Ask @grok): a production model page bundle contains the Ask @grok action (`curl -s https://three.ws/forge | grep -o 'src="[^"]*\.js"'`, then grep the bundle for `Ask @grok`), and one live `/m/<id>` model page carries `"@type":"3DModel"` JSON-LD (take a public model id from a link on `/forge` or `/explore`; the JSON-LD is built in `src/model-page.js`). If the JSON-LD is missing, drop only the "structured data" clause.
   A post whose check fails is cut and the thread renumbered; never post a claim you could not check today.
4. **Media.** Re-render the cards once tasks 1 to 3 are settled: `node scripts/grok-startups-repost-cards.mjs`, adding `--smoke-passed` only if the progress log shows order 458 proved all six examples live. It rewrites `post-NN.png`, the `article-<topic>.png` images and `src/live.json`. If a post was cut, renumber the cards to match (`RENUMBER`, `THREAD`, the card keys and `TOTAL`). Open every PNG and check nothing overlaps or clips. Every tag in the thread is a company account (`@SpaceXSI`, `@cursor_ai`, `@XDevelopers`, `@X`, `@grok`, `@pumpdotfun`); remove any personal account. Post 12's `ARTICLE_URL` is filled by the owner once the article is published; leave it as is.
5. **Links.** Every URL in the thread returns 200: `curl -s -o /dev/null -w '%{http_code}\n' "<url>"`. One link per post.
6. **Format.** Every post's hook (text before its first blank quoted line) is at most 280 characters (measure it with node). Strip every `[NEW]` marker from the post headers. `grep -nP '\x{2014}|\x{2013}' <file>` prints nothing. `grep -niE 'co-market|working directly' <file>` matches only the "What changed" and "Wording rules" sections, never a post.
7. **Status line.** Replace the draft's "Status: final assembly runs last" section with "Status: ready to post (assembled <date>)" and two lines: what step 0.2 printed, and which posts were cut, if any.
8. Commit the repost doc, the re-rendered `public/x-media/grok-startups-repost/` files (and any card script change) and the progress log entry, for example `docs(x-posts): assemble the Grok for Startups repost with refreshed numbers and measured evals`.

## Definition of done

- [ ] Posts 1 to 4, 6, 8, 10, 11 and 13 match the original thread except post 1's removed clause, credits line and @SpaceXSI mention, post 6's removed personal tag, post 10's removed error count, the `utm_content` tags and the refreshed figures.
- [ ] Tags are company accounts only. Every card in `public/x-media/grok-startups-repost/` re-rendered today and its figures match the post text.
- [ ] Every post's surface checked today, every link 200, every hook at most 280 characters, no dash characters.
- [ ] Committed with explicit paths; nothing pushed; nothing posted.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Never blocked

- The numbers script fails: read its error and fix the root cause if it is a bug in the script (test-first); if it is access, keep the original figures and say so.
- A link returns non-200: check it twice 30 seconds apart; if it is still down, find the right live URL for the same surface, or cut that post.

## Report format

First line: "Ready to post" or "Do not post until <what>". Then the full final thread text exactly as it should be pasted into X, post by post, then the posts cut (if any) with the reason, and the commit hash.
