# x-grok: progress log

Cross-session handoff for the `x-grok-` orders ([x-grok-00-CONTEXT.md](x-grok-00-CONTEXT.md)). Append one dated entry per session: which order, what shipped (commit SHAs), what was measured, and anything the next session must know. Never edit an earlier entry.

## 2026-10-08: campaign written

- Orders 023 to 066 (runnable) and 926 to 931 (owner-gated) written, 50 in all, with the shared context file.
- Measured while writing: `workers/agent-gateway` has a `package.json` and no committed source, so the Telegram and Discord inbox is never drained (order 045). `public/robots.txt` welcomes Grok in a comment but lists no xAI user agent in its live-user group (order 041). `GROK_API_KEY` is not configured in production per `docs/ops/llm-lanes.md` (order 927). Nothing reads X mentions anywhere (orders 046 to 050).

## 2026-10-08: order 046 (mentions reader) done

- Shipped `ee718777b`: `api/_lib/x-mentions.js` (`fetchMentions`, `normalizeMentions`, `classifyMentionsError`, `XTierUnavailable`, `XRateLimited`, `XAuthFailed`), `refreshIfNeeded` now exported from `api/_lib/x-post.js` for the agent OAuth2 mode, `scripts/x-mentions-probe.mjs`, fixtures in `tests/fixtures/x-mentions/`, 26 tests in `tests/x-mentions.test.js`.
- Measured: the production app credentials (OAuth 1.0a, all four `X_*` keys are Secret Manager refs on `three-ws-api`) CAN read the @trythreews mention timeline. HTTP 200, 5 mentions returned, `x-rate-limit-limit` 300 per 15 minutes, `x-access-level` read-write. Evidence: `prompts/x-grok/_generated/mentions-probe.json` (credentials redacted, post text omitted). Order 926 is therefore not a prerequisite for reading mentions at current volume; it only matters if volume or a monthly read cap is hit.
- Measured: @trythreews user id is `2049400807624527872` (derived from the access token prefix, no extra call). Real mentions include posts where our handle is only an auto-prefixed reply handle (someone replying in a thread we were tagged in); the parser (047) must treat those as reply context, not as an address.
- `X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET` are not on the Cloud Run service, so agent OAuth2 token refresh (both posting and the agent mention mode) cannot refresh in production until they are set. Relevant to orders 060 and 061.
- The probe was run twice (one stdout preview, one write), so two read calls were spent, not one.

## 2026-10-08: order 047 (mention intent parser) done

- Shipped `7c2382374`: `api/_lib/x-mention-intents.js` (`parseMentionIntent`, `parseLaunch`, `normalizeText`, `splitLeadingHandles`, `sanitizeArg`, `addressing`), 94 tests in `tests/x-mention-intents.test.js` (83-case corpus, 17 hostile), and a pointer in order 925 to consume this parser.
- Step 0: no `api/_lib/x-mention*` existed besides 046's reader; order 925 had not built a parser, so its `launch <NAME> $<TICKER> [description]` grammar was written here first, held to the `/launch` form limits imported from `src/launch/launch-model.js` (the parser's only import; a test asserts it).
- Behavior the next orders rely on: money-movement, secret and instruction-override phrasing returns `help` (reason `refused_*`) and never reaches a model. A handle that only rides along in reply handles of a thread already naming us is `inherited`: explicit commands still parse, chatter is `ignore` (the real 2026-10-08 "add me" shape). Unrecognized direct text is `chat` for both company and agent accounts (reason `company_chat` / `agent_chat`); order 051 decides whether the company account answers it. `image3d` args carry `sourceAuthorId` so order 053 can enforce its own-image rule. `$THREE` is a reserved ticker for `launch`.

## 2026-10-08: order 048 (mention events schema) built, migration NOT applied (order file kept)

- Shipped `ab198d4ff`: migration `api/_lib/migrations/20261008170000_x_mention_events.sql`, `api/_lib/x-mention-store.js` (`recordMention`, `updateDecision`, `countByAuthor`, `recentDecisions`, `getMentionEvent`, `getCursor`, `advanceCursor`, `cursorKey`), 18 PGlite tests in `tests/x-mention-store.test.js` built from the migration file itself, including the dedupe race (three concurrent inserts, one wins).
- Schema notes for later orders: `decision` is null until decided and also allows `pending` (052 follow-ups) and `paused` (055 kill switch) beyond the order's list. `reply_tweet_id` is set once and never replaced. Cursor key is `x_mentions_cursor:<kind>:<ref>` and only moves forward (numeric compare in SQL).
- Remaining DoD line: "`npm run db:migrate` applied". Not run because `db:status` showed another pending migration, `20261008150000_revenue_direct_settle_backfill.sql`, untracked (uncommitted, another session's in-flight work) and a payout-ledger backfill, and the owner instruction for this run was not to apply when that is the case. Owner of the last step: whoever lands that backfill (or the owner). Then `npm run db:status` and `npm run db:migrate` apply both; or apply just this one with `node scripts/apply-migrations.mjs --apply --file 20261008170000_x_mention_events.sql`. Until then `db:check` reports it pending and blocks a deploy, as it already did for the backfill.

## 2026-10-08: order 041 (legible to Grok) done

- Shipped `3ce212575`: `api/_lib/creation-jsonld.js` (one builder for creation structured data: GLB as a `model/gltf-binary` MediaObject `encoding`, `/api/render/glb` PNG as `thumbnailUrl`, creator, date, `/legal/tos` as `license`), `server/creation-head.mjs` (per-creation head on `/m/:id` for every User-Agent, wired into `server/index.mjs` and the Vite dev server), enriched JSON-LD on `/forge/share/:id`, `/avatars/:id` and `/agents/:id`, `public/robots.txt`, `docs/seo.md`, changelog, tests in `tests/legible-to-grok.test.js` plus three handler suites. Order file deleted in that commit.
- Measured: xAI documents NO crawler or live-user user-agent token. Checked `docs.x.ai/llms.txt`, the full `llms-full.txt` (1.6 MB, zero `user-agent`/`robots` hits) and the Grok Bot security docs, which only say hosted computers egress through shared static IPs available from the account team. Third-party directories list `GrokBot`, `xAI-Grok`, `Grok-DeepSearch`, `xAI-SearchBot`, but none is xAI-published, so none was added. Grok falls to `User-agent: *`, which now allows `/api/render/glb`.
- Measured: the production render endpoint returns a real 1200x630 PNG for a live forge GLB (195 KB), so every creation card and thumbnail points at a working image.
- For later orders: Grok Bot browses with a stock browser UA, so the UA-routed crawler pages (`/avatars/:id`, `/agents/:id`, vercel.json `has` user-agent lists) never reach it; `/m/:id` is the only creation page whose structured data every reader gets. Extending the same head rewrite to the avatar and agent shells is the follow-up if Grok Bot reads those links.

## 2026-10-08: order 048 closed (migration applied)

- `20261008170000_x_mention_events.sql` applied alone with `node scripts/apply-migrations.mjs --apply --file 20261008170000_x_mention_events.sql` (output: `applying ... ok`). The unrelated pending `20261008150000_revenue_direct_settle_backfill.sql` was deliberately left for its owner; `db:check` still blocks deploys on it until that session applies it.
