# microsoft 13: three.ws inside GitHub Copilot in VS Code (chat participant, language model tools, MCP registration)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3113.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

`packages/vscode-3d` is a capable extension (viewer, gallery, inspect, optimize, embed) that is not yet published. VS Code's AI surface is where developers now ask for things: the Chat view with GitHub Copilot. Three APIs put three.ws there: a chat participant (`@threews make a low-poly lantern for my scene`), language model tools that Copilot's agent mode calls on its own, and an MCP server definition provider that registers the three.ws MCP server with one install. Shipping these before publishing makes the Visual Studio Marketplace listing land with a reason to install.

## Step 0: re-derive the current state

    cat packages/vscode-3d/package.json | head -120
    sed -n 1,120p packages/vscode-3d/src/extension.js
    cat packages/vscode-3d/PUBLISHING.md; sed -n 1,80p docs/vscode.md
    ls packages/vscode-3d/test; (cd packages/vscode-3d && npm test 2>&1 | tail -20)
    curl -s -X POST https://three.ws/api/mcp-studio -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 1500

Read the current VS Code docs for the Chat Participant API, the Language Model Tools API (`vscode.lm.registerTool`, `contributes.languageModelTools`, confirmation messages), and `contributes.mcpServerDefinitionProviders` / `vscode.lm.registerMcpServerDefinitionProvider`. Note the minimum `engines.vscode` each needs.

## Tasks

1. **Chat participant `@threews`** with slash commands `/forge` (text to 3D on the free lane, streams progress, ends with a button that opens the model in the extension's viewer and one that saves the GLB into the workspace), `/find` (search ready-made assets in the public catalog), `/rig` (rig a GLB in the workspace), `/embed` (insert an `<agent-3d>` snippet into the open file). Follow-up suggestions, cancellation honoured, errors explained in chat.
2. **Language model tools** declared in `package.json` and registered in code: generate model, check job, find asset, inspect local GLB, optimize local GLB. Each with a JSON schema, a user-facing confirmation where it writes files or spends quota, and results Copilot can reason over.
3. **MCP server definition provider** that registers `https://three.ws/api/mcp-studio` (free tools, no auth) and, when the user signs in, the authenticated server.
4. **Tests** with `@vscode/test-electron` (or the test runner the package already uses) exercising the participant's command routing and each tool's schema and invocation against the real free endpoints; run under `xvfb-run` if needed.
5. **Docs and packaging.** Bump the version, update CHANGELOG, `README.md` (with a GIF or screenshots captured from a real run), `docs/vscode.md` and PUBLISHING.md; `vsce package` produces the `.vsix`. Add a section to docs/mcp-tools.md for GitHub Copilot coding agent and VS Code MCP configuration.

## Definition of done

- [ ] The package's test suite passes, including the new participant and tool tests against real endpoints.
- [ ] `vsce package` succeeds; `.vsix` path in the report; `engines.vscode` matches the APIs used.
- [ ] A recorded real run (screenshots) shows `@threews /forge` producing a model and Copilot agent mode calling a three.ws tool.
- [ ] Docs, CHANGELOG, changelog.json entry landed; root `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Copilot needs a signed-in GitHub account for the agent-mode screenshot | Verify the tool registration through the API and tests; put "run Copilot agent mode with the .vsix and capture the screenshot" in the owner message. |
| Publishing needs the owner's publisher token | Package only; the `vsce publish` command goes in the owner message. |
| A proposed API is required | Use only finalized APIs; if one feature needs a proposed API, drop that feature and note it. |
| Free lane queued | Stream honest queue status; never fake progress. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
