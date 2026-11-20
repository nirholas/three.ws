# grok-startups 03: submit-ready package for the official Grok Bot marketplace, plus templates and the grok.com connector path

Status 2026-11-20: package complete (6156ec071 logos, 205ff62ed review check, 8d5a249b4 listing row 0, 4ce69c2a0 templates and reviewer path, 048ba8874 grid, e3e7d6cfe changelog); review check ALL PASS against production, sign-in to first generated model 195.8 s. Remaining is the owner's: approve push and `npm run deploy:gcp:full` (puts the 1:1 logo and the sign-up consent fix live), create the `three-ws` org handle, add the connector in Grok Bot and run the three review asks, submit the form with the values in docs/partners/grok-bot-listings.md section 0, log the submission there.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3273.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. The form submission is the owner's. Batch every owner step into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

On 2026-10-14 xAI opened the **Grok Bot marketplace** to submissions at `https://x.ai/bot/marketplace/submit-a-plugin`; approved entries appear at `https://x.ai/bot/marketplace`. Per third-party guides the form distributes a plugin or MCP server to Grok Bot, to Cursor and (marked "coming soon") to Grok itself. This is xAI's own first-party catalog, and it is **missing** from the 13-row plan in [docs/partners/grok-bot-listings.md](../../docs/partners/grok-bot-listings.md) (order 929), which was researched before the form was found. An approved first-party listing is the single most reshareable distribution event in this campaign: the xAI staff who opened the marketplace announced it themselves on X. Reported form fields: organization handle, a 1:1 logo, listing targets, an MCP server URL or public GitHub repository, a description, testing instructions, a work email, an optional website, confirmation of local and in-app testing, and acceptance of the publisher terms. The form does not state OAuth rules, categories or a review timeline.

## Step 0: re-derive the current state

    grep -n "submit-a-plugin\|bot/marketplace" docs/partners/grok-bot-listings.md || echo "not in the listings plan"
    sed -n 1,60p docs/grok-bot.md
    curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://three.ws/api/mcp-grok?auth=oauth" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
    curl -s https://three.ws/.well-known/oauth-authorization-server | head -c 800; echo
    ls integrations/cursor/three-ws/assets public/brand 2>/dev/null

Then try the form page itself (`curl -sL https://x.ai/bot/marketplace/submit-a-plugin`); x.ai usually answers 403 to automated clients, so also read the guides cited in the plan doc and record which fields each source names. Read xAI's Grok Bot docs for templates and connectors (`https://docs.x.ai/grok-bot/` pages, `.md` suffix) and the grok.com custom-connector flow (grok.com/connectors, New Connector, Custom). Record every field you will fill and its source.

## Tasks

1. **Listing row and full prepared submission.** Add a row 0, "Grok Bot marketplace (official)", above row 1 in the directory table of the listings doc, and a "### 0. Grok Bot marketplace (official)" prepared-submission section with the exact value for every form field: organization handle (propose `three-ws` and say it must match the org the owner creates), listing targets (all available), the choice of MCP URL versus repository with the reason (a hosted OAuth server is reviewable without installing anything; the repo becomes relevant once orders 871 and 872 export one), description (token-free, under the length the form allows), testing instructions, website. Hot file: re-read, small anchored edits, commit right after.
2. **The 1:1 logo.** Produce a 1024 x 1024 PNG (and 512) from the existing vector logo with a real rasterizer (sharp or resvg, whichever the repo already depends on; check `package.json`), centered with safe padding, checked on light and dark backgrounds. Commit it under `public/brand/` with the source SVG path in the commit message.
3. **Reviewer readiness, proven by a script.** `scripts/grok-connector-review-check.mjs`: from a clean client with no stored state, run the complete OAuth 2.1 discovery against `https://three.ws/api/mcp-grok?auth=oauth`: protected-resource metadata, authorization-server metadata, dynamic client registration, PKCE authorize URL that returns the consent or sign-in page with 200 (fetch it and assert it renders the sign-in form), then, with an API key (`THREE_WS_API_KEY`; QA-login row of the self-unblock playbook if absent), the authenticated `tools/list`, one catalog search and one free generation, each timed. Print a PASS/FAIL table and exit non-zero on any failure. Test it with `tests/grok-connector-review-check.test.js` against recorded real responses from your run.
4. **Testing instructions a reviewer can follow.** Write them from task 3's measured timings: add the connector, sign in with a free account using the reviewer's own email, three prompts with expected results, what a slow job looks like, and the support contact `support@three.ws`. Put them in the prepared submission and in `docs/grok-bot.md`.
5. **Grok Bot task templates.** Write four or five templates that use only free, non-spending tools and produce something a Grok Bot user values on a schedule (for example: a weekly 3D prop pack for a game jam, product photos to 3D for a storefront, a daily stylized avatar for an agent page, a catalog-first scene assembler). Each with a title, the exact prompt, the connector it needs, the expected output and its runtime. Publish them in `docs/grok-bot.md` and as copyable cards on `/grok` (small anchored edit of `pages/grok.html`, hot file, with en locale keys if the page uses i18n). If step 0 found a template submission route at xAI, prepare its submission in the listings doc too.
6. **grok.com custom connector.** Document the plain-Grok path with exact values (name, URL, auth) in `docs/grok.md` (hot file), verified against the docs page you read.

## Definition of done

- [ ] The listings doc has row 0 and a complete section 0 with every form field filled, each traced to a source.
- [ ] `public/brand/` holds the 1024 and 512 PNG logos, square, transparent or solid as the form requires.
- [ ] `node scripts/grok-connector-review-check.mjs` prints all PASS against production (unauthenticated discovery steps always; authenticated steps with the key), and its test passes.
- [ ] `docs/grok-bot.md` has the testing instructions and the templates; `/grok` shows the template cards on your dev server (Playwright screenshot in the report).
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The form page answers 403 | Build the field list from the guides plus xAI's docs; mark any field you could not see directly as "confirm on the form" in the prepared section. |
| Dynamic client registration is not supported on `mcp-grok` | Measure what the server supports, document the exact path Grok Bot uses (from `docs/grok-bot.md` and the x-grok progress log), and make the script assert that path instead. A real gap in the OAuth flow is a bug: fix it test-first. |
| No organization exists yet | The handle is a proposal; creating it is owner action 4 in the plan. |
| No xAI key for an in-app test | The form asks the publisher to confirm in-app testing; that confirmation is the owner's, after a run in Grok Bot. List the exact steps in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. The last step is the owner's (test in Grok Bot, submit the form): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (sign-in to first generated model, in seconds).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message (the filled form values in paste order); one-line judgment calls. No trailing questions.
