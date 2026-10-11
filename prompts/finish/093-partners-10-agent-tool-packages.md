# partners 10: Tool packages and registry entries for the agent frameworks

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/partners-00-CONTEXT.md](_context/partners-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: irreversible spend, git push or deploy, external posting, committing content that names a crypto project other than $THREE, destroying unrecoverable data. Batch every such ask into ONE message at the end.
- Never contact a third party: no email, issue, pull request, form, listing or post. Write the exact text into the repo and put the step in the owner message (context file rules).
- Never onboard a paid API or spend. Wire paid vendors behind their env var and prove the code against the real API with whatever free or sandbox access exists.
- Verify each upstream license from its LICENSE file before adopting anything.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. The em-dash and en-dash characters are banned.
- Concurrent agents share this worktree: stage explicit paths only and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Agents already call three.ws through MCP (13,898 tool calls in September from 13 distinct clients, per the [proof brief](../../docs/partners/proof-brief-2026-10.md)), but most agent frameworks find tools through their own packages and registries, and three.ws is in almost none of them. The [prospects list](../../docs/partners/prospects.md) scores about thirty frameworks and coding tools with a free listing route. This order builds everything those listings need so the owner's part (order 938) is opening pull requests and submitting forms with text that already exists.

## Step 0: re-derive the current state

    ls packages | head -120
    cat public/.well-known/mcp.json | head -40
    grep -rn "HTTP-Referer\|X-Title" api --include=*.js | head
    npm view ai version; npm view @langchain/core version

For each framework in the agent table of the prospects list, re-check the intake route on the day you run this (several changed during the 2026-10-09 sweep: LangChain now takes integrations through an issue first, and hand-written pull requests are closed automatically). Record what you found.

## Tasks

1. **`packages/ai-sdk`**: three.ws tools for the Vercel AI SDK (`tool()` definitions over the public API: forge, rig, animate, render, agent chat), typed, tested against the live API, with a README example that runs.
2. **`packages/langchain`**: the same tools as LangChain JS tools, following LangChain's current integration-package template, with the integration issue text.
3. **Google ADK**: a docs page and a runnable sample that connects an ADK agent to the three.ws MCP server.
4. **A skills index** at `/.well-known/skills/index.json` describing the agent skills we publish, in the format the agent-skills registries read.
5. **OpenRouter attribution**: every OpenRouter request the platform makes sends the same `HTTP-Referer` and `X-Title`, so three.ws appears in OpenRouter's app rankings.
6. **A Postman collection** generated from `public/.well-known/openapi.yaml`, checked in and kept in sync by a script.
7. **Registry entries** for Hermes, Kilo, OpenHands, OpenCode, Dify and cursor.directory: each entry file in the exact format the registry wants, plus its pull request or form text, in `marketing/growth/submissions/agent-registries/`.
8. Build and check each package with `npm pack --dry-run`. Publishing to npm is owner order 938.
9. **Docs.** README per package, the agent docs updated, `STRUCTURE.md` rows, changelog entry.

## Definition of done

- [ ] Each package's README example runs against the live API and returns real results (output in the report).
- [ ] `npm pack --dry-run` is clean for each package.
- [ ] The skills index and Postman collection validate against their schemas.
- [ ] One registry submission file per registry exists, matching the format checked in step 0.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] READMEs, docs, `STRUCTURE.md` and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/093-partners-10-agent-tool-packages.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
