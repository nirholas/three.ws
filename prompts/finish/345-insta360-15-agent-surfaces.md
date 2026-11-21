# insta360 15: MCP tools, OpenAPI entries and `three-ws` CLI commands for the 360 lanes

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3345.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (you own the MCP, OpenAPI and CLI surfaces; you call C4 endpoints over HTTP). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Publishing the CLI to npm and updating MCP registry listings are owner steps owned by order 347. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Agents and scripts are first-class three.ws users. "Turn this 360 video into a splat" should work from Claude, Cursor or a shell as well as from the browser: same endpoints, same account, same result.

## Step 0: re-derive the current state

    sed -n 1,120p api/_mcp-studio/tools.js
    grep -n "name:" api/_mcp-studio/tools.js | head -40
    sed -n 1,80p api/_mcp-studio/dispatch.js
    grep -n "scene-capture\|scene_capture\|motion" api/_mcp-studio/tools.js api/_mcp3d/tools/*.js | head
    grep -n "paths\|/api/scene" api/openapi-json.js | head -20
    ls packages/three-ws-cli/src/commands; sed -n 1,80p packages/three-ws-cli/src/commands/tools.js
    ls packages/three-ws-cli/tests

Record how studio tools are declared (schema, auth, usage tags), how they reach API handlers (in-process call or HTTP), how OpenAPI paths are written, and how CLI commands are registered and tested.

## Tasks

1. **MCP tools** on the studio server (where `forge_free` and siblings live), following the existing declaration style exactly:
   - `pano_capture_start` (input: `source_url` or `source_urls`, `source_kind`, optional `trim`, `quality`; agents provide a public URL because MCP clients cannot stream multi-GB files; describe that in the tool description and point to the CLI for local files) returns `job_id`.
   - `pano_capture_status` (`job_id`) returns status, stage, progress, result URLs and `viewer_url`.
   - `pano_capture_list` returns the caller's captures.
   - `pano_scene_create` and `pano_scene_status` for the photo-to-depth-shell lane.
   Tool descriptions are precise about what each returns, how long jobs take (measured numbers from the progress log if present, else conservative ranges), and that results are owned files (PLY, SPZ, GLB). Usage tags and auth identical to sibling generation tools.
2. **OpenAPI**: add every C4 path (`capture-upload` four, `pano-capture` GET, POST and DELETE, `pano-scene` GET and POST) with request and response schemas matching the contract, error schema, security scheme, and examples built from real response bodies captured in task 5.
3. **CLI** in `packages/three-ws-cli`: `three-ws capture 360 <file...> [--quality] [--trim-start] [--trim-end] [--wait] [--out <dir>]` uploads local files with the C4 multipart flow (parallel parts, retry, resume state in the CLI's config directory keyed by file path, size and mtime), starts the job, and with `--wait` shows a live progress line and downloads PLY, SPZ, preview and poster into `--out`. `three-ws capture status <job>`, `three-ws capture list`, `three-ws capture scene <photo>` for the depth shell. Uses the CLI's existing auth and HTTP helpers. JSON output with `--json` for scripts.
4. **Tests**: tool schema tests beside the existing MCP tool tests, OpenAPI validation (the repo's existing validator if present, or `@apidevtools/swagger-parser` if already a dependency; do not add a new root dependency for this), CLI tests in `packages/three-ws-cli/tests` against a local HTTP server speaking C4 (allowed by the context file).
5. **Live**: run the MCP tools through the real local MCP endpoint on port 3345 (JSON-RPC over HTTP, as the `connect-three-ws-mcp` skill shows) and the CLI against the local dev server, both with a real account (self-unblock playbook QA login row). For lanes whose workers are not deployed, capture the real `unconfigured` responses as evidence; if 339 and 333 exist on disk, capture real job creation too.
6. **Docs**: MCP tool docs (find with `grep -rln "forge_free" docs | head`), CLI README section, OpenAPI is self-documenting, changelog entry (developer-facing), and the `connect-three-ws-mcp` skill's tool list if it enumerates tools (anchored edit).

## Definition of done

- [ ] Five MCP tools declared, dispatched and tested; visible in `tools/list` on the local endpoint.
- [ ] OpenAPI contains every C4 path, validates, and its examples are real captured bodies.
- [ ] CLI commands work end to end against the local server; `--json` output stable; tests pass.
- [ ] `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| C4 endpoints not on disk yet | Build to contract, test against a contract-speaking server, capture the real 404 or `unconfigured` evidence; 347 reruns live. |
| Studio tools are dispatched in-process to handler modules that do not exist yet | Dispatch over HTTP to the same origin for these tools, or import lazily with a clear `unconfigured` result when the module is absent; pick whichever matches sibling tools and record it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. CLI publish and registry updates are the owner's: leave this file in `finish/` with a dated status line naming them, unless the CLI is published by the regular deploy (check its README), in which case archive it. Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
