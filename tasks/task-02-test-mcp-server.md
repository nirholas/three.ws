# Task: Write Tests for the MCP Server

## Context

This is the `three.ws` 3D agent platform. The MCP server (`api/mcp.js`, 1,201 lines) implements the Model Context Protocol (MCP 2025-06-18) over JSON-RPC 2.0. It exposes 14 tools to external AI systems. It has **zero test coverage** despite being a critical external-facing API.

## Goal

Write a vitest test suite for the MCP server. Tests should live at `tests/api/mcp.test.js`.

## Files to Read First

- `api/mcp.js` — the full MCP server (read this carefully before writing any tests)
- `api/_lib/auth.js` — `authenticateBearer()`, `getSessionUser()`
- `tests/api/llm-anthropic.test.js` — existing API test for reference on style and how to mock Vercel serverless handlers
- `tests/api/agents.test.js` — another reference for request/response mocking patterns

## What to Test

### Protocol layer
1. `POST /api/mcp` with `method: "initialize"` returns protocol version, server info, and tool list
2. `POST /api/mcp` with unknown method returns JSON-RPC error `-32601` (method not found)
3. `POST /api/mcp` with malformed JSON returns JSON-RPC parse error `-32700`
4. `DELETE /api/mcp` returns 200 (stateless session termination no-op)
5. `GET /api/mcp` returns 405 (SSE not yet implemented)

### Authentication
6. `tools/call` without auth token returns 401 or appropriate JSON-RPC error
7. `tools/call` with a valid bearer JWT succeeds for tools that require no scope
8. `tools/call` for `list_my_avatars` (requires `avatars:read` scope) with a token lacking that scope returns a permission error

### Tool: `search_public_avatars`
9. Returns a list of agents when database has results (mock the DB call)
10. Returns empty list when no results found

### Tool: `validate_model`
11. Returns validation results for a valid model URL (mock `safeFetchModel`)
12. Returns SSRF error when URL resolves to a private IP address

### Tool: `render_avatar`
13. Returns HTML snippet containing `<model-viewer>` for a valid GLB URL

### x402 payment flow
14. Unauthenticated request for a paid tool returns 402 with `WWW-Authenticate` header
15. Request with valid `X-PAYMENT` header passes payment check and proceeds to tool

## Approach

- Mock the Neon DB client to avoid real database calls
- Mock `safeFetchModel` for model-related tools
- Use the same request/response mock pattern as `tests/api/agents.test.js`
- Create a helper `makeRpcRequest(method, params, authHeader?)` to reduce boilerplate

## Success Criteria

- `npm test tests/api/mcp.test.js` passes with all tests green
- No real network or database calls
- Auth paths (no token, wrong scope, valid token) all covered
