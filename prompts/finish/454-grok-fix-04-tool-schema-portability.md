# 454 grok-fix-04: One tool-schema portability gate for every MCP server we publish

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`. Read `CLAUDE.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; bug fixes are test-first; stage explicit paths only and commit promptly with a message that describes the diff. Deploys and pushes are owner-gated: commit only. This order is independent of orders 451 to 453 and 455 to 458.

## Why

On 2026-11-21 `pano_capture_start` shipped with `anyOf` at the root of its `inputSchema`. xAI's Responses API refuses the entire request when any single tool has a non-object or union root (`HTTP 400 invalid_client_tool_schema: tool parameter root must be an object type`), so every three.ws tool went offline for every Grok model for six days. The fix (`a99f32c10`) moved the union into a server-only `serverSchema` in `api/_mcp-studio/pano-tools.js`, and `tests/mcp-grok.test.js` now pins the rule for the `grok` surface only. `api/_lib/mcp-probe.js` exports `clientAcceptsRootSchema` for the runtime probe.

The same class of bug can hit any server we publish, and xAI is not the only strict client. Other published servers (see `public/.well-known/mcp.json`): `/api/mcp` (`api/mcp.js`), `/api/mcp-chatgpt`, `/api/mcp-studio`, `/api/mcp-grok`, `/api/mcp-agent`, `/api/mcp-bazaar`, `/api/ibm-mcp`, and any other `api/mcp-*.js`. Re-derive the list in step 0.

## Step 0

1. `ls api/mcp*.js api/*-mcp.js 2>/dev/null; node -e 'const m=require("./public/.well-known/mcp.json");for(const s of m.servers)console.log(s.name,s.endpoint)'`.
2. For each server, find how its tool catalog is built (for the studio family, `toolCatalogFor(surface)` in `api/_mcp-studio/dispatch.js`; others export or build a `TOOLS` array). Note which ones a unit test can import without network or a database.
3. Read `tests/mcp-grok.test.js` ("gives every tool a plain object root schema that xAI accepts") and `clientAcceptsRootSchema` in `api/_lib/mcp-probe.js`.
4. Research the current published rules (fetch the docs; cite URLs in the module header):
   - xAI function/tool calling and remote MCP: `https://docs.x.ai/developers/` (fetch `.md` variants; x.ai pages answer 403 to curl).
   - OpenAI function calling strict mode / structured outputs supported schema subset (root must be an object; `additionalProperties: false` and all properties `required` under strict; unsupported keywords).
   - Gemini function declarations (OpenAPI 3 subset: unsupported keywords such as `$ref` cycles, `oneOf` at some levels, `const`, `additionalProperties` handling).
   - Anthropic tool `input_schema` (root `type: "object"`).
   Encode only rules you found in a document, each with its URL.

## Tasks

1. **Shared rules module.** Create `api/_lib/tool-schema-portability.js` exporting `checkToolSchema(schema, client)` for `client` in `xai | openai | gemini | anthropic`, returning a list of `{ path, rule, message }` violations, plus `PORTABILITY_RULES` with each rule's doc URL. Fold the existing root check into it and make `clientAcceptsRootSchema` in `mcp-probe.js` call it (keep its export and behaviour so `tests/mcp-probe.test.js` still passes). Walk nested schemas, not only the root, for the rules that apply below the root.
2. **Test first.** `tests/tool-schema-portability.test.js`:
   - Unit cases for each rule using real violating shapes (the original `pano_capture_start` root `anyOf` is the first xAI case; take it from `git show a99f32c10^:api/_mcp-studio/pano-tools.js`).
   - A catalog sweep: every importable server's published catalog, checked against the clients that server is meant for (studio and grok surfaces: xai, openai, anthropic; chatgpt surface: openai; `/api/mcp`: every client). Run it and confirm what fails before you fix anything.
3. **Fix what the sweep finds.** For every violating tool, apply the pattern from `a99f32c10`: keep the published schema portable and enforce the extra constraint server-side (a `serverSchema` merged into the ajv validator, or a handler check that returns a JSON-RPC `-32602` with a clear message). Each fixed tool keeps rejecting the invalid input it rejected before: add a test for that per tool.
4. **Keep the probe and sweep in step.** If you add rules the runtime probe should enforce for the xAI-facing servers, the probe's tools/list step uses `checkToolSchema(schema, 'xai')`. Rerun `npx vitest run tests/mcp-probe.test.js tests/mcp-grok.test.js tests/mcp-studio-pano.test.js tests/tool-schema-portability.test.js`.
5. **Docs.** Add a short "Tool schema rules" section to `docs/mcp.md` (what a new tool's `inputSchema` must look like, why, and the test that enforces it). `npm run audit:docs`.
6. **Changelog** only if a published schema changed in a user-visible way (tags `fix`, link `/docs/mcp` or the relevant page), then `npm run build:pages`.
7. `npm test` once before close-out.

## Definition of done

- [ ] `api/_lib/tool-schema-portability.js` with cited rules; `mcp-probe.js` uses it; probe tests green.
- [ ] `tests/tool-schema-portability.test.js` sweeps every importable published server; it failed before your fixes (if anything violated) and passes after.
- [ ] Every fixed tool still rejects the input it rejected before (tested).
- [ ] `docs/mcp.md` documents the rule.
- [ ] Committed with explicit paths; nothing pushed or deployed.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Report format

Servers swept, violations found per server and client, fixes made, the rules with their source URLs, commit hashes. Note that the fixes reach users only after a deploy.
