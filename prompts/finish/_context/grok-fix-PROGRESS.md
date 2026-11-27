# grok-fix progress log

Append-only. One dated entry per order run: order number, what shipped (commit hashes), what was measured, what remains and who owns it. Never edit an earlier entry.

## 2026-11-27: campaign filed

Orders 451 to 458 filed from the xAI takedown request and the live key run. Fixes `a99f32c10`, `848857cb2`, `8b275ada1` and changelog `e6f8ae31d` are on `main`, undeployed and unpushed. Key stored at `~/.config/three-ws/xai-local.key`. gcloud reauth was expired for both owner accounts.

## 2026-11-27: order 452, the Grok for Startups thread rewritten as a corrected repost

Shipped: `ed86dc046` rewrites `docs/x-posts/2026-11-25-grok-for-startups-announcement.md` in place. Ten posts, a dated correction note, a source for every kept claim, and a "Before posting" gate. Posts 2, 4 and 9 kept word for word; post 10 (the Ask @grok button) added. Removed: the "first" claim, the team-access and listing claims in post 1, the render-check guarantee and the 426 figure in post 3, every surface in post 5 except the grok.com custom connector and Grok Bot, the "all six work" and 82 second claims in post 6, the "before we got in", daily-traffic, error-count and "people we have never met" claims in post 7, both statements about how xAI picks members in post 8, and the tags of @SpaceXSI, @cursor_ai, @ericzakariasson and @XDevelopers.
Measured 2026-11-27: all four thread links answer 200; every hook is 58 to 194 characters; live `tools/list` on `/api/mcp-grok` returns 21 tools; "Ask @grok about it" is in the production `share` bundle that the model page and cutaway bundles import. Production (`f0eed584f`) still publishes the root `anyOf` on `pano_capture_start` on both `/api/mcp-grok` and `/api/mcp-studio`, so the thread names no xAI API surface and its gate says not to post until the order 451 check prints `rejected: []`.
Not re-measured: the database figures (5,547, 1,243, 718, 31). gcloud reauth was still expired for both owner accounts and there is no `.env.local`, so they are the recorded 2026-11-20 run with its window stated; the 426 figure was dropped for that reason.
Remains (owner): delete the old thread; after the order 451 deploy passes the gate, rerun `node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to 2026-11-20` and post by hand. Post 6 stays out until order 458 records a run with a real xAI key. Not pushed, not posted.
