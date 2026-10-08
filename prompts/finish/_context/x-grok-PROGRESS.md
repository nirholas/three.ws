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
