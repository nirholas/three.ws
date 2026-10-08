# X mention timeline fixtures

Captured-shape payloads of `GET /2/users/:id/mentions` (X API v2), used by
`tests/x-mentions.test.js`, `tests/x-mention-intents.test.js` and the mention
store tests. The field layout, expansion layout and problem bodies follow the
real response the @trythreews probe recorded on 2026-10-08
(`prompts/x-grok/_generated/mentions-probe.json`) and X's documented problem
types. Every id, handle and post body here is synthetic, so no real person's
post is committed.

- `timeline-page.fixture.json`: one page with a plain mention carrying an
  image, a quote of a post with an image, a reply chain where our handle is
  only an auto-prefixed reply handle, a long post (`note_tweet`), a retweet,
  a reply whose parent was deleted (partial `errors`), and one of our own posts.
- `timeline-page1.fixture.json` / `timeline-page2.fixture.json`: two pages of
  a `since_id` read, linked by `next_token`.
- `error-*.fixture.json`: the problem bodies and headers X answers with when
  the app's access level, credits, rate window or credentials refuse the call.

The synthetic company account is `@trythreews` with user id
`1700000000000000001`.
