# microsoft 45: an OData usage feed so customers analyze three.ws usage in Power BI and Excel with scheduled refresh

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3145.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Team and enterprise buyers report on what they pay for. In Microsoft shops that reporting happens in Power BI and Excel, and both connect natively to OData feeds with scheduled refresh in the Power BI Service. Today [api/usage/summary.js](../../api/usage/summary.js) serves one user's dashboard numbers as JSON; there is no tabular, filterable, refreshable feed for a team admin. An OData v4 feed with an auth method that survives Power BI Service refresh turns three.ws into a line in the customer's existing cost dashboards. (The existing `integrations/microsoft/power-bi-visual` renders 3D inside a report; this order is about data, not visuals.)

## Step 0: re-derive the current state

    sed -n 1,60p api/_lib/usage-summary.js
    ls api/usage api/teams 2>/dev/null; grep -rn "usage_events\|mcp_tool_calls\|llm_usage" api/_lib/migrations/*.sql | head
    grep -rn "api_keys\|scope" api/_lib/auth.js | head -20
    ls integrations/microsoft/power-bi-visual

Read Microsoft's current docs on Power BI and Excel OData connectivity: OData v4 features Power Query uses (`$metadata`, `$select`, `$filter`, `$top`, `$skip`, server-driven paging with `@odata.nextLink`, query folding), the authentication kinds that support scheduled refresh in the Power BI Service without a gateway (Anonymous, Basic, Organizational account; confirm whether a custom header key survives Service refresh before relying on it), and the rules for dynamic data sources that block refresh.

## Tasks

1. **Entity model** from real tables: `UsageDaily` (date, team, user, metric, quantity), `McpToolCalls` (timestamp, tool, user, status, duration), `LlmUsage` (date, model, tokens in and out, calls), `Generations` (Forge jobs with type, status, duration), and `Billing` (period, plan, metered dimension quantities as reported to the billing source). Scope every row to what the caller may see: a user sees their own; a team owner or admin sees their team.
2. **OData v4 endpoint** `/api/odata/v1/` with a service document, `$metadata` (CSDL XML), entity sets, `$select`, `$filter` on the documented subset (dates, eq on keys), `$orderby`, `$top`, server-driven paging and `$count`. Use a maintained OData library if one fits the vanilla Node handler style; otherwise implement the subset with a strict parser and tests. Register the route in `vercel.json` (anchored edit, last).
3. **Refreshable auth.** Implement an auth path that Power BI Service can refresh without a gateway: HTTP Basic where the password is a scoped, revocable read-only API key (username ignored or set to the key id), created from the account or team settings page with a "Usage feed" scope. Rate limit per key; audit-log key creation and use.
4. **Settings UI.** A "Connect to Power BI or Excel" panel in the dashboard settings: create or revoke the feed key, copy the feed URL, step-by-step for Power BI Desktop, Power BI Service refresh, and Excel (Data, Get Data, From OData Feed), with loading, empty and error states.
5. **Power Query template** `integrations/microsoft/power-bi-usage/`: a Power BI template (`.pbit`, built reproducibly or documented as owner-exported if binary generation is not possible) or at minimum a Power Query M script with typed columns and a starter report spec, plus a README.
6. **Tests and verification.** Unit tests for the parser, scoping (a member never sees another team's rows), paging and auth; an integration test against an isolated DB; validate `$metadata` against the CSDL schema; and a real Power Query evaluation if available (for example connecting with the open source OData client libraries to prove the feed is consumable end to end).
7. **Docs** `docs/usage-odata.md`, linked from [docs/microsoft.md](../../docs/microsoft.md); changelog entry; `npm run build:pages`.

## Definition of done

- [ ] `$metadata` validates; an OData v4 client library reads every entity set with paging (output in the report).
- [ ] Scoping tests prove no cross-team or cross-user leakage; auth and rate limit tests pass.
- [ ] The settings panel works in a browser with real data (screenshot paths), no console errors.
- [ ] `npm test` and `npm run audit:docs` pass; docs, template and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Power BI Service account to test refresh | The feed uses an auth kind Microsoft documents as refreshable; Desktop and Service refresh tests go in the owner message. |
| A metric has no backing table | Leave it out of the model and say so; never synthesize numbers. |
| Large teams make queries slow | Add the indexes the filters need (migration via the documented path, `db:status` first) and cap `$top` with paging. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
