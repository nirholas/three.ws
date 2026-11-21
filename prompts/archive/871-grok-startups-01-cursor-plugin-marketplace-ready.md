# grok-startups 01: make the Cursor plugin pass Cursor Marketplace review on the first try

Status 2026-11-20: built and committed (f4888fd24 to 4e496d293). Validator 0 errors, 0 warnings; live tool surface 16 tools, none can move money. Owner steps remain: push, deploy, create the public plugin repo, then submit (order 929 rows 1 and 2, then order 873).

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3271.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, creating a GitHub repo, any submission) into ONE message at the end. Never contact Cursor, xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

SpaceX announced the acquisition of Cursor in June 2026, so the Cursor Marketplace is now a SpaceXSI surface. It is also the catalog Grok Bot inherits ("Grok Bot inherits your team's Cursor connector policy"), so one approved Cursor plugin reaches Cursor users and Grok Bot teams at once. Cursor reviews every submission and every update by hand for security, quality and data handling; the common rejections are "reviewer could not connect", "reviewer could not sign in", privacy-policy gaps and repository problems. This order removes every one of those causes mechanically. The submission itself stays with order 929 (rows 1 and 2 of [docs/partners/grok-bot-listings.md](../../docs/partners/grok-bot-listings.md)) and order 873 (the official Grok Bot marketplace form).

## Step 0: re-derive the current state

    ls -la integrations/cursor/three-ws integrations/cursor/three-ws/.cursor-plugin integrations/cursor/three-ws/skills
    cat integrations/cursor/three-ws/.cursor-plugin/plugin.json integrations/cursor/three-ws/mcp.json
    sed -n 1,80p integrations/cursor/three-ws/README.md
    git log --oneline -8 -- integrations/cursor
    sed -n '/### 1 and 2/,/### 3/p' docs/partners/grok-bot-listings.md
    curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://three.ws/api/mcp-studio?auth=oauth" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
    curl -s https://three.ws/.well-known/oauth-protected-resource | head -c 600; echo
    curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/privacy

Then read the primary sources, not summaries: Cursor's plugin reference (`https://cursor.com/docs/reference/plugins`, `https://cursor.com/docs/plugins`), the publisher terms (`https://cursor.com/marketplace-publisher-terms`), and clone `https://github.com/cursor/plugin-template` into your scratchpad to read its manifest schema and any validator it ships. Record the schema version and template commit SHA you used. Known claim to verify: `displayName` is not in Cursor's manifest schema and the validator flags it; our manifest has it.

## Tasks

1. **Manifest conformance.** Make `.cursor-plugin/plugin.json` valid against the official schema: drop or move any field the schema does not define, keep `name` lowercase kebab-case and unique, bump `version` by semver, keep the logo path committed, and declare every `${VAR}` that `mcp.json` uses. Vendor the schema as a test fixture with its source URL and commit SHA in a header comment.
2. **A validator that runs in this repo.** `scripts/validate-cursor-plugin.mjs <dir>`: schema check, kebab-case name, every referenced file exists, every `${VAR}` declared, every MCP URL on an allowlist of three.ws hosts, manifest under 10 MB, no symlinks (Cursor skips symlinked local plugins). Add a `grok:`-prefixed npm script and `tests/cursor-plugin-validate.test.js` that runs it against the real plugin directory and against broken copies (missing logo, undeclared var, foreign URL) built in a temp dir.
3. **No spend surface, proven.** The plugin must only reach tools that generate, rig, render, search and read. Write a test that opens a real MCP session to every URL in `mcp.json` (production, with a real API key from `.env` as `THREE_WS_API_KEY`; if none, follow the self-unblock-playbook QA-login row to get one), lists tools, and fails if any tool name or description matches wallet, transfer, send, swap, trade, launch, pay, x402 or withdraw. Record the tool list in the test output.
4. **Content that matches reality.** Re-read every skill and the README against live behavior: making or rigging a model needs a free three.ws account and Cursor signs the user in on first connect; catalog search needs nothing. Add Cursor rules (`rules/*.mdc`, verify the component type and frontmatter in the reference) that steer the agent to search the free catalog before generating and to render a model to look at it. Add commands only if the reference defines them for Cursor plugins.
5. **Reviewer path.** Add `REVIEWING.md` to the plugin: a numbered test plan a Cursor reviewer can follow in under five minutes (install, connect, sign in with a free account using their own email, three prompts with the expected results and timings measured by you against production), plus a data-handling section: what the server stores, retention, and links to the live privacy page and terms. If `/privacy` does not cover MCP-submitted prompts and generated files, add that paragraph to the privacy page source in a small anchored edit and note it in the report.
6. **Real end-to-end session.** `scripts/cursor-plugin-session-check.mjs`: an MCP client built on `@modelcontextprotocol/sdk` (use the repo's installed version; read `package.json` first) that reads the plugin's own `mcp.json`, performs `initialize` without auth and asserts the 401 plus resource metadata Cursor needs to start OAuth, then authenticates with the API key, lists tools, calls the free catalog search and one free generation, and prints a timed pass/fail table. Run it against production.
7. **Standalone public repo export.** Cursor requires an open-source public repository with the manifest at its root. Write `scripts/export-plugin-repo.mjs --src <plugin dir> --out <dir>` (generic: it must also work on `integrations/grok/three-ws`): copies the plugin to the root of a fresh tree, adds LICENSE, README, CHANGELOG.md generated from the plugin's git history, a `.gitignore`, runs the validator, `git init`, and makes one commit authored as the repo's configured user. Deterministic output, covered by a test. If a sibling order already created this script, extend it instead of writing a second one.
8. **Screenshots from real runs.** Generate one model through the plugin's MCP URL (task 6), open its real viewer page with Playwright on your dev server, and commit two screenshots (connected tools list as rendered by our `/grok` or docs page is not a substitute; use the viewer and the result card) under `integrations/cursor/three-ws/assets/`, referenced from README and REVIEWING.md.
9. **Docs, last.** Update `integrations/cursor/three-ws/README.md`, then in a small anchored edit add the export command and the REVIEWING.md link to section "1 and 2" of `docs/partners/grok-bot-listings.md` (hot file). Changelog entry only if the user-facing plugin behavior changed.

## Definition of done

- [ ] `node scripts/validate-cursor-plugin.mjs integrations/cursor/three-ws` exits 0 against the vendored official schema; the broken-copy cases fail with clear messages.
- [ ] The tool-surface test passes against production and its output lists the tools, none of them spend-capable.
- [ ] `node scripts/cursor-plugin-session-check.mjs` prints every step PASS against production, including one completed free generation with its GLB URL.
- [ ] `node scripts/export-plugin-repo.mjs --src integrations/cursor/three-ws --out <scratch>/three-ws-cursor` produces a tree with `.cursor-plugin/plugin.json` at its root and `git -C <scratch>/three-ws-cursor log --oneline` shows one commit.
- [ ] `REVIEWING.md` exists, its timings are your measured numbers, and the privacy page covers MCP data.
- [ ] `npx vitest run tests/cursor-plugin-validate.test.js` passes; `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cursor's docs page does not render with curl | Read the schema and examples from the cloned `cursor/plugin-template`; cite its commit SHA. |
| Cursor desktop cannot run here | The validator plus the real MCP session (task 6) are the test; a reviewer runs Cursor. Say so in REVIEWING.md under "what we tested". |
| No three.ws API key on this machine | Self-unblock playbook, QA-login row. Never paste a key into a committed file. |
| Free generation is slow or queued | Measure it honestly and put the real timing in REVIEWING.md; if it exceeds Cursor's tool timeout, record the number and use the job-status pattern the studio server already documents. |
| A GitHub organization does not exist | Export works to any directory. Creating the org and pushing is owner action 4 in the plan. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (it is: creating the public repo, pushing the export, then order 929 rows 1 and 2 and order 873): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (reviewer test plan duration and generation time).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message (repo name proposal, push command, then the submission order); one-line judgment calls. No trailing questions.
