# 452 grok-fix-02: Assemble the final Grok for Startups repost thread (run LAST)

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`, **after** orders 451, 454, 456, 457 and 458 have run (or after as many of them as will run today). Read `CLAUDE.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; stage explicit paths only and commit promptly with a message that describes the diff. Posting to X is owner-only: you finish the draft and print it, you never post.

**Owner approval carried by this file:** the owner running this order IS the explicit approval to commit `docs/x-posts/2026-11-27-grok-for-startups-repost.md` with the funding source its post 18 names (the creator-rewards platform and its tag), which the CLAUDE.md commit gate otherwise holds. No other non-$THREE crypto project may appear in your diff. It is not approval to push.

## The owner's decision (do not re-litigate)

On 2026-11-27 xAI asked us to take the 2026-11-25 thread down because the program gives credits and does not include co-marketing. The owner decided: **keep the original thread exactly as written, remove only the co-marketing clause from post 1, and add posts for the Grok work built since.** "The first crypto-native company approved", "our plugin is headed to the Grok Bot, Grok Build and @cursor_ai marketplaces", the original numbers' framing, and the original tags all stay. Do not cut or soften them. Do not reintroduce co-marketing or a working relationship with the xAI, SpaceXSI or Cursor teams.

Owner decisions of 2026-11-27, also final: tags are company accounts only, never individual staff. Post 1 mentions @SpaceXSI as a plain company mention with no relationship claim, and the personal tag that was in post 6 stays removed. The repost carries no error count: post 15 and its card drop "2 errors", so never add an error figure back. Media is clean black cards drawn by `scripts/grok-startups-repost-cards.mjs`, with video only where a real render exists (posts 1, 4 and 5), and the 3D subjects on the cards are a rocket, an electric sports car, an electric pickup and a humanoid robot.

The draft is [docs/x-posts/2026-11-27-grok-for-startups-repost.md](../../docs/x-posts/2026-11-27-grok-for-startups-repost.md): nineteen posts, complete except post 14 (evals) and the refreshed numbers in posts 3, 15 and 16. Its media is in `public/x-media/grok-startups-repost/` (one file per post, listed in the draft's Media section). `docs/x-posts/2026-11-25-grok-for-startups-announcement.md` holds a stricter rewrite (`ed86dc046`) that the owner did not choose; leave it alone and do not copy from it.

## Step 0

1. `git log --oneline -15` and read `prompts/finish/_context/grok-fix-PROGRESS.md` in full: it records what 451, 454, 456, 457 and 458 proved. Read the repost draft in full.
2. Production connector check. Both lines must print `rejected: []`:
   ```bash
   for p in mcp-grok mcp-studio; do curl -s https://three.ws/api/$p -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s.replace(/^data: /m,""));const bad=m.result.tools.filter(t=>{const r=t.inputSchema||{};return r.type!=="object"||["anyOf","oneOf","allOf","not","if","then","else","enum","const"].some(k=>k in r)}).map(t=>t.name);console.log(process.argv[1],m.result.tools.length,"tools, rejected:",bad)})' $p; done
   ```
   If either is not empty, the deploy (order 451) has not landed and Grok cannot use three.ws through the xAI API. Finish every task below anyway, and put "Do not post until order 451 has deployed" as the first line of your report.
3. `DATABASE_URL`: `export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"`. If it fails with a gcloud reauthentication error, the owner must run `gcloud auth login nich@sperax.io` in a terminal on this machine; do every task that does not need the database first and report that one line.

## Tasks

1. **Refresh posts 3, 15 and 16.** `node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to <yesterday>` (read its header for flags). Update the figures in post 3 ("426 checks") and post 15 (tool calls, days, the five generation counts, distinct prompts) and the window ("in 44 days") to the refreshed totals, keeping each sentence's wording otherwise identical. Write the same figures to `public/x-media/grok-startups-repost/src/usage.json` so the cards match the text: keys `window` (the card's label), `calls`, `days` ("N of N"), `prompts`, `renders` and `weeks` (`[["Oct 5", 1125], ...]`, week starts), formatted as in `USAGE` in `scripts/lib/grok-startups-cards.mjs`; never edit `USAGE` itself, which the 2026-11-25 thread's cards read. If the script now excludes our own probe or test traffic, use what it prints; never add our own traffic back. If the database is unreachable, keep the original figures and say so in the report. Post 16 needs no database: read `curl -s https://three.ws/api/status/mcp`, take the Grok server's `windows.7d` `passed`, `probes` and `handshakeP50Ms`, and update the checks-passed counts and the median handshake in the post's second paragraph. Task 4 below re-renders the post 16 card from the same endpoint; the text must match the `src/live.json` that render writes, so take the figures from that file after rendering. If fewer than 95% of checks passed, cut post 16.
2. **Fill post 14** from the evals, by the rules in the draft's "Post 14: how order 452 fills it" section. Read `docs/evals/grok-4-7-on-three-ws.md` and `docs/evals/grok-imagine-ref-image.md` and `git log -3` on each: use only a Grok column that came from a real run (the progress log names the run). Replace the `EVAL_HOOK` and `EVAL_BODY` placeholders with the hook and body, with figures copied from the doc. If neither has a real Grok column, delete post 14 and renumber every later post and every reference to those numbers in the file. Remove the `[NEW, FILLED BY ORDER 452]` marker either way.
3. **Prove each post's surface is live now.** One check each, recorded in the draft's Sources section with today's date:
   - Post 5: the launch stack cutaway URL returns 200 and its page source or `/api/anatomy` record names 29 parts and 10 steps.
   - Posts 6 and 8: the progress log shows order 451 (xAI API live) and 458 (all six examples passed live). If 458 recorded that one example still fails, rewrite only the specific sentence in post 8 that it contradicts, and say so.
   - Post 7: the plugin directory still has `make-3d`, `rig`, `embed`, `three-ws-init` and `3d-art-director`, and `integrations/cursor/three-ws/commands` still has `make-3d`, `rig` and `embed`. Note 458's Grok Build result in Sources.
   - Post 9: `cd satellites/grok-3d-starter && npm install && npm test` passes, its README still says one dependency and server-held keys, and the GitHub tree URL in the post returns 200. Optionally prove one live turn with `XAI_API_KEY="$(cat ~/.config/three-ws/xai-local.key)"` and a QA account's three.ws key (proof-sized, key never printed or saved).
   - Post 10: the four template cards and their times are still on `pages/grok.html`, and `npm view @three-ws/cli version` plus the package's client list still include `grok-bot` (`npx -y @three-ws/cli setup --help`).
   - Post 11: `api/_lib/webhook-dispatch.js` still sends the stored bearer token, signs and retries deliveries, and its tests pass (`npx vitest run tests/webhook-bearer-token.test.js tests/webhook-dispatch-signing.test.js`); `pages/grok.html` still has the `#gk-wake-h` section.
   - Post 12: a pano capture or pano scene job finished in the last 30 days (query the table `api/_mcp-studio/pano-tools.js` writes to; find it from that file) and the 360 tools pass the root-schema check in step 0.2. If no job has finished, run one real `pano_scene_create` through `/api/mcp-studio` on a CC0 equirectangular image with a QA account (`AUDIT_EMAIL`, `npm run audit:web:provision` if missing) and record the result. If the lane cannot finish a job, cut post 12.
   - Post 13: `api/_lib/agent-grok-key.js` still bills an owner's saved key, and the Grok 4.7 id is in `api/_lib/chat-models.js`.
   - Post 16: `/status` returns 200 and shows the Grok connector row; the probe still runs every 5 minutes (`vercel.json` crons, `api/cron/mcp-probe.js`).
   - Post 17: a production model page bundle contains the Ask @grok action (`curl -s https://three.ws/forge | grep -o 'src="[^"]*\.js"'`, then grep the bundle for `Ask @grok`), and one live `/m/<id>` model page carries `"@type":"3DModel"` JSON-LD (take a public model id from a link on `/forge` or `/explore`; the JSON-LD is built in `src/model-page.js`). If the JSON-LD is missing, drop only the "structured data" clause.
   A post whose check fails is cut and the thread renumbered; never post a claim you could not check today.
4. **Media.** Re-render the cards once tasks 1 to 3 are settled: `node scripts/grok-startups-repost-cards.mjs`, adding `--smoke-passed` only if the progress log shows order 458 proved all six examples live. It rewrites `post-NN.png` and `src/live.json`; then set post 16's figures from `src/live.json`. If post 14 survives, add a `post-14.png` card to that script in the same look (a figure from the eval doc, the two or three rows the post cites, the doc path as the caption) and render it with `--only post-14.png`. If a post was cut, renumber the cards to match (`RENUMBER`, the card keys and `TOTAL`). Open every PNG and check nothing overlaps or clips. Every tag in the thread is a company account (`@SpaceXSI`, `@cursor_ai`, `@XDevelopers`, `@X`, `@grok`, `@pumpdotfun`); remove any personal account.
5. **Links.** Every URL in the thread returns 200: `curl -s -o /dev/null -w '%{http_code}\n' "<url>"`. One link per post.
6. **Format.** Every post's hook (text before its first blank quoted line) is at most 280 characters (measure it with node). Strip every `[NEW]` marker from the post headers. `grep -nP '\x{2014}|\x{2013}' <file>` prints nothing. `grep -niE 'co-market|working directly' <file>` matches only the "What changed" and "Wording rules" sections, never a post.
7. **Status line.** Replace the draft's "Status: final assembly runs last" section with "Status: ready to post (assembled <date>)" and two lines: what step 0.2 printed, and which posts were cut, if any.
8. Commit the repost doc, the re-rendered `public/x-media/grok-startups-repost/` files (and any card script change) and the progress log entry, for example `docs(x-posts): assemble the Grok for Startups repost with refreshed numbers and measured evals`.

## Definition of done

- [ ] Posts 1 to 4, 6, 8, 15, 18 and 19 match the original thread except post 1's removed clause and @SpaceXSI mention, post 6's removed personal tag, post 15's removed error count, the `utm_content` tags and the refreshed figures.
- [ ] Tags are company accounts only. Every card in `public/x-media/grok-startups-repost/` re-rendered today and its figures match the post text.
- [ ] Post 14 filled from a real eval run, or cut; no placeholder left. Post 16 figures read on assembly day.
- [ ] Every post's surface checked today, every link 200, every hook at most 280 characters, no dash characters.
- [ ] Committed with explicit paths; nothing pushed; nothing posted.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Never blocked

- The numbers script fails: read its error and fix the root cause if it is a bug in the script (test-first); if it is access, keep the original figures and say so.
- An eval doc is half-filled: use only the rows the doc marks as measured; if that is not enough for a fair comparison, cut post 14.
- A link returns non-200: check it twice 30 seconds apart; if it is still down, find the right live URL for the same surface, or cut that post.

## Report format

First line: "Ready to post" or "Do not post until <what>". Then the full final thread text exactly as it should be pasted into X, post by post, then the posts cut (if any) with the reason, and the commit hash.
