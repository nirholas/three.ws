# microsoft 31: a three.ws declarative agent for Microsoft 365 Copilot, built on the existing MCP tools

Status 2026-11-16: built and validated (97d6fe763, 6396778e1, db9f17888, df7587dab, 041f954b8). 4 of 6 starters proven on production. Remaining owner step: deploy main (contains R2 reference fix c3ec82891), then rerun the proof for "Rigged mascot" and "Inspect a model" and record their job ids in docs/microsoft-copilot-agent.md.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3131.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The app package in [integrations/microsoft/copilot-teams/](../../integrations/microsoft/copilot-teams) declares an `agentConnectors` MCP source, a bot and message extensions, but no declarative agent. A declarative agent is what appears by name in the Microsoft 365 Copilot agent list ("three.ws 3D Studio"), with its own instructions, conversation starters and icon, so a user can pick it and say "make a 3D model of our product for the sales deck" without knowing about MCP. It is the most visible Copilot surface for a partner.

## Step 0: re-derive the current state

    node -e "const m=require('./integrations/microsoft/copilot-teams/manifest.template.json');console.log(m.manifestVersion,Object.keys(m));console.log(JSON.stringify(m.copilotAgents||null))"
    ls integrations/microsoft/copilot-teams integrations/microsoft/copilot-teams/schema
    cat integrations/microsoft/copilot-teams/mcptools.json | head -60
    npm run package:microsoft-app -- --check
    curl -s -X POST https://three.ws/api/mcp-studio -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 1500

Read Microsoft's current docs for declarative agents in the unified app manifest (`copilotAgents.declarativeAgents`), the declarative agent manifest schema (latest version), the API plugin manifest, and how a declarative agent references MCP tools (the remote MCP server action support). Use the current schema versions from Microsoft, and vendor each schema file into `integrations/microsoft/copilot-teams/schema/` with its source URL.

## Tasks

1. **Declarative agent manifest** `integrations/microsoft/copilot-teams/declarativeAgent.json`: name, description, instructions written for this agent (what it does, which tools to call for which request, how to present GLB and viewer links, when to refuse, never claiming Microsoft endorsement), up to the schema maximum of conversation starters that each work end to end on the free tools, and the action referencing the three.ws studio MCP tools (through the plugin manifest the schema requires, reusing `mcptools.json`). Capabilities limited to what the agent needs.
2. **Wire into the package.** Reference the agent from `manifest.template.json` (anchored edit, re-read first; it is a shared hot file), include every new file in `npm run package:microsoft-app`, bump the package version.
3. **Validation.** Extend `npm run package:microsoft-app -- --check` to validate the declarative agent and plugin files against the vendored schemas and enforce Microsoft's documented limits (instruction length, starter count, description lengths). A test fails on any violation.
4. **Prove the tools.** For each conversation starter, run the exact tool sequence the instructions tell Copilot to use against production `https://three.ws/api/mcp-studio` and record the real outputs (job ids, GLB URLs) in the doc.
5. **Docs.** A "Declarative agent" section in [docs/microsoft-teams-forge.md](../../docs/microsoft-teams-forge.md) or a new `docs/microsoft-copilot-agent.md` (with `docs/microsoft.md` link): what users see, sideload steps in a developer tenant, and how it ships inside the same Partner Center offer. Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] `npm run package:microsoft-app -- --check` passes with the declarative agent included (output in the report).
- [ ] The schema and limits test fails on an over-length instruction (demonstrated, then reverted).
- [ ] Every conversation starter's tool sequence returned a real result from production (ids in the doc).
- [ ] `npm test` and `npm run audit:docs` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| MCP action support in declarative agents is preview or changed | Follow Microsoft's current documented pattern; if MCP actions are not yet supported in the target schema, generate an API plugin (OpenAPI) for the same studio tools from the live handlers and reference that instead, and record why. |
| No Microsoft 365 developer tenant | Validation plus live tool proof is the bar here; the owner sideloads (owner message). |
| Free lane queued | Wait for the real job; never stage a result. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
