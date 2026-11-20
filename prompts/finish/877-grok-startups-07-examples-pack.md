# grok-startups 07: a runnable examples pack for building 3D with Grok and three.ws

Status 2026-11-20: built and verified (all six examples PASS in `npm run grok:examples-smoke`, fresh copy to first GLB 82.4 s); the live Grok-leg samples wait on order 927 installing the xAI key (owner).

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3277.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Developers adopt what they can run in two minutes. xAI's developer relations team reshares working examples that show their API doing something new; a folder of examples that each make a real 3D model through Grok is exactly that. Every example uses surfaces that already exist in production (remote MCP from the Responses API, the studio server, the Grok Build plugin, the REST API), so this order builds nothing new on the server. It makes what exists legible and proves it runs.

## Step 0: re-derive the current state

    ls examples/ | head -80
    ls examples/grok-remote-mcp && sed -n 1,80p examples/grok-remote-mcp/README.md
    sed -n 1,60p scripts/xai-mcp-e2e.mjs
    grep -n "xai\|grok" package.json
    curl -s https://three.ws/.well-known/mcp.json | head -c 1500; echo
    curl -s -o /dev/null -w "%{http_code}\n" "https://three.ws/api/v1/catalog/search?q=chair"

Find the real REST endpoints for catalog search, free generation, job status and rigging by reading `vercel.json` routes and `docs/` (do not trust the probe URL above; correct it). Read the xAI SDK docs at docs.x.ai (`.md` suffix) for the current Python `xai-sdk` and the OpenAI-compatible Node usage, and record the versions you pin.

## Tasks

Each example is a directory under `examples/` with its own README (what it does, prerequisites, the exact run command, expected output with a real sample you captured, cost note), a pinned dependency file, and code that reads keys from the environment only.

1. **`examples/grok-python-mcp/`**: Python, official `xai-sdk`, Grok with the three.ws studio server as a remote MCP tool. Prompt: "find a chair in the free catalog, and if none fits, make a low-poly wooden chair". Prints the tool calls and the final GLB URL.
2. **`examples/grok-node-responses/`**: Node, OpenAI-compatible client pointed at `https://api.x.ai/v1`, Responses API with the remote MCP tool. Same task, plus rendering the result with `/api/render/glb` and saving the PNG.
3. **`examples/grok-curl/`**: one shell script, `curl` and `jq` only, that does the whole flow in raw HTTP so the request shapes are visible.
4. **`examples/grok-x-search-to-3d/`**: Grok's built-in X search finds what people are posting about (a topic passed as an argument), Grok writes a prop prompt from it, the studio server makes the model, and the script prints a draft post with the model link. It never posts; it prints.
5. **`examples/grok-agent-avatar/`**: a tiny web page (no framework) where a Grok-powered chat drives an `<agent-3d>` avatar: the server side keeps the key and proxies chat; the client embeds the avatar and maps reply sentiment to the avatar's emotes through the component's documented API.
6. **`examples/grok-build-workflow/`**: a README-driven walk-through for the Grok Build plugin in `integrations/grok/three-ws` (install, `/three-ws-tour`, a generation, embedding in a three.js scene), with a small three.js starter the walk-through edits.
7. **Index and smoke test.** `examples/grok/README.md` indexing all six with one line each. `scripts/grok-examples-smoke.mjs` (npm script `grok:examples-smoke`): installs nothing globally, runs each example in its own temp environment, and asserts either a real success (key present) or the documented xAI 401 plus a successful three.ws leg (key absent). It must run the three.ws legs for real every time: catalog search and, with `THREE_WS_API_KEY`, one free generation.
8. **Docs.** Link the index from `docs/grok.md` (hot file, small anchored edit) and from `/grok` (hot file) and `examples/README.md` if it exists. Changelog entry.

## Definition of done

- [ ] Six example directories, each with a README holding a real captured sample output and a pinned dependency file.
- [ ] `npm run grok:examples-smoke` exits 0 on this machine and prints one PASS line per example with which legs ran live.
- [ ] `grep -rnE "GROK_API_KEY=|xai-[A-Za-z0-9]{20,}" examples/grok*` finds no committed key.
- [ ] `grep -rniE "\\\$THREE|token price|wallet" examples/grok*` returns nothing (xAI-facing material is token-free).
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No xAI key | Context file, no-key rule. Every three.ws leg runs live; the Grok leg proves the documented 401. Sample outputs for the Grok leg are captured after order 927 and the README says which lines will change. |
| Python version mismatch | `uv` or a venv in your scratchpad; pin the Python version in the example. |
| A free generation is queued for minutes | Poll job status as the examples do and record the real time in the README. |
| No three.ws API key | Self-unblock playbook, QA-login row. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (capturing Grok-leg samples after order 927): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (time from clone to first GLB for the fastest example).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
