# grok-startups 16: a forkable Grok + three.ws starter app that turns a chat into a 3D model on the page

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3286.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, creating the destination GitHub repository, posting) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Examples (order 877) show one call. Developer relations reshares something a developer can fork and have running in five minutes: a small, beautiful app where you chat with Grok, Grok calls three.ws, and a real textured 3D model appears on the page, then changes when you say "make it chrome". Nothing like it exists for Grok today, and it is the strongest proof that three.ws is the 3D layer for anyone building on xAI. The repo already ships focused, exportable starter repos under [satellites/](../../satellites) (see [satellites/agent-starter](../../satellites/agent-starter) and [docs/ops/growth-satellite-export.md](../../docs/ops/growth-satellite-export.md)); this order adds a Grok one in the same pattern, exported one-way like its siblings.

## Step 0: re-derive the current state

    cat satellites/README.md
    ls -a satellites/agent-starter satellites/agent-starter/scripts; cat satellites/agent-starter/package.json
    sed -n 1,80p scripts/export-growth-satellites.mjs; grep -n "TARGETS" scripts/export-growth-satellites.mjs | head
    sed -n 1,200p examples/grok-remote-mcp/index.mjs
    grep -n "GROK_MODELS" -A 3 api/_lib/chat-models.js | head -20
    curl -s -X POST https://three.ws/api/mcp-grok -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 1200; echo
    curl -s -o /dev/null -w "xai no-key %{http_code}\n" https://api.x.ai/v1/models

Read the xAI docs for the Responses API with a remote MCP tool (`server_url`, `server_label`, `allowed_tools`, the authorization field) and streaming events (the `.md` form of each docs.x.ai page). Record the exact event names you will render. Read [examples/grok-remote-mcp/index.mjs](../../examples/grok-remote-mcp/index.mjs) end to end: it already solves the long-render problem (pending job, `previous_response_id` continuation, viewer-link detection); reuse its approach, do not reinvent it. Note which three.ws tools change a model after it exists (refine, restyle) by reading the live `tools/list` output.

## Tasks

1. **The satellite.** `satellites/grok-3d-starter/`, matching the sibling layout: `package.json` (`"private": true`, Apache-2.0 like its siblings, Node 20+, `dev`, `start`, `check`, `test`), README, LEARN.md (a ten-minute path: run it, change the system prompt, add a tool, deploy), CONTRIBUTING.md, `.devcontainer/devcontainer.json` so Codespaces starts it with one click, and `.env.example` naming `XAI_API_KEY` and `THREE_WS_API_KEY` with the URL where each is created. Keep dependencies minimal and pinned; prefer the platform (Node `http`, `fetch`, ES modules) over a framework.
2. **Server: keys never reach the browser.** A small Node server that serves the page and exposes one streaming endpoint. It calls `https://api.x.ai/v1/responses` with the model from an env var defaulting to the current flagship id (read it from `GROK_MODELS` at authoring time; document how to change it), the three.ws remote MCP tool pointed at `https://three.ws/api/mcp-grok` with the user's `THREE_WS_API_KEY` as its authorization, and an `allowed_tools` list limited to search, generate, refine and job-status tools. It streams Grok's text, each tool call (name and arguments) and each tool result to the browser as server-sent events, continues long renders through `previous_response_id` exactly as the example does, and keeps the conversation id so follow-ups ("make it chrome", "now a red one") act on the same model. Input is validated at the boundary (length cap, rate limit per IP in memory), and upstream errors map to clear, specific messages.
3. **Page: a real product, not a demo.** One page: a chat column and a 3D stage. The stage shows the GLB with `<agent-3d>` or three.js `GLTFLoader` (Meshopt decoder registered, since three.ws GLBs are meshopt-compressed), orbit controls, a soft studio environment, and a turntable when idle. The chat shows Grok's reasoning-free answer, a compact tool-call timeline ("searching the catalog", "making the model", "rendering, about a minute"), the viewer link, a download button, and a version strip so the user can step back to an earlier model. States: an empty state with three example prompts that are known to work, a loading state driven by real stream events (never a timer), an error state per failure (missing xAI key, missing three.ws key, xAI 401 or 429, three.ws `sign_in_required`, render failure) that says what happened and how to fix it, and hover, active, focus and disabled states on every control. Responsive down to 360 px. Accessible: labelled controls, keyboard-only use, live region for status.
4. **Setup screen, honestly.** When a key is missing the page shows a setup panel listing exactly which key is missing, where to create it, and the one line to put in `.env`, instead of a broken chat. The free three.ws account requirement is stated plainly. Membership wording, if any, follows the context file.
5. **Tests that run without keys, and a live run.** `node:test` suites for the stream parser, the continuation logic, input validation and error mapping, driven by recorded real responses captured from the live services in this session where a key exists, otherwise by the documented response shapes with the doc URL in each fixture's header (context file, no-key rule; label them as documented shapes, never as captures). `scripts/check.mjs` like the sibling's: structure, no secrets in the tree, every link reachable. A live run with `THREE_WS_API_KEY` (the QA key per the `self-unblock-playbook` skill) proves the three.ws half end to end through the same MCP tool calls the server sends (call the MCP server directly with those exact arguments and render the returned GLB on the page). The xAI half is proven by the documented 401 without a key; with a key (after order 927), one full chat-to-model run with a screenshot.
6. **Deploy anywhere, documented.** A `Dockerfile` and a README section with one `gcloud run deploy --source .` command (the starter is the developer's app, so name Cloud Run as one option beside plain `npm start` on any Node host). Never add a GitHub Actions workflow (CLAUDE.md).
7. **Export.** Add a `TARGETS` entry to [scripts/export-growth-satellites.mjs](../../scripts/export-growth-satellites.mjs) (proposed destination `nirholas/grok-3d-starter`; the owner confirms the org in the owner message), run `npm run export:growth-satellites`, and confirm the exported tree installs, passes `npm test` and has one commit. Add the row to [satellites/README.md](../../satellites/README.md) and extend the growth-satellites row in STRUCTURE.md (hot file, small anchored edit).
8. **Wire it.** Link the starter from `docs/grok.md` and `/grok` (hot files, small anchored edits), from [docs/partners/xai-grok-startups-plan.md](../../docs/partners/xai-grok-startups-plan.md) row C6, and add a changelog entry. If order 882's kit file exists, add one post draft for the starter to it; otherwise put the draft in the README's last section for the owner.

## Definition of done

- [ ] `cd satellites/grok-3d-starter && npm ci && npm test` passes, and `npm run check` passes.
- [ ] On your dev server (port 3286), the page loads with no console errors, shows the setup panel with no keys, and with the QA three.ws key renders a real generated GLB on the stage (Playwright screenshots at desktop and 360 px).
- [ ] The live xAI call without a key returns the documented 401 and the page shows the matching error (output and screenshot in the report); with a key, one full chat-to-model run (screenshot), or the line stays open for after order 927.
- [ ] `npm run export:growth-satellites` produces the `grok-3d-starter` tree with one commit, and the exported tree passes `npm test`.
- [ ] `grep -rniE "\\\$THREE|wallet|token price" satellites/grok-3d-starter` returns nothing, and no key or secret is in the tree.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No `XAI_API_KEY` (the normal state until order 927) | Build all of it; prove the three.ws half live with the QA key and the xAI half with the documented 401. List the one-command live run in the owner message. |
| No QA three.ws key on this machine | Follow the credential row of the `self-unblock-playbook` skill to mint one for the QA account. |
| A render takes minutes | That is the pending-job path the example already handles; show the real job status in the timeline. |
| WebGL in headless Chromium | Use swiftshader flags at reduced resolution (memory note on verifying without the full world). |
| The exporter does not know the new satellite's test command | Extend its target schema the way its existing targets declare theirs; keep the existing targets unchanged. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (creating the destination repository and pushing the export, the full xAI run after order 927): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (seconds from clone to a model on the stage, measured on a fresh checkout).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
