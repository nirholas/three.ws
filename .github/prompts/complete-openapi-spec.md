---
mode: agent
description: "Complete the OpenAPI spec with all actual API endpoints"
---

# Complete OpenAPI Specification

## Problem

`public/.well-known/openapi.yaml` currently only documents a single endpoint (`GET /`) but the actual API surface is extensive:

### Endpoints that exist but are undocumented:

**Avatar CRUD:**
- `GET /api/avatars` — list user's avatars
- `POST /api/avatars` — create avatar
- `GET /api/avatars/:id` — get avatar by ID
- `PUT /api/avatars/:id` — update avatar
- `DELETE /api/avatars/:id` — delete avatar
- `GET /api/avatars/public` — search public avatars
- `POST /api/avatars/presign` — get presigned upload URL

**Auth:**
- `POST /api/auth/register` — register user
- `POST /api/auth/login` — login
- `GET /api/auth/me` — current user
- `POST /api/auth/logout` — logout

**OAuth 2.1:**
- `POST /api/oauth/register` — dynamic client registration
- `GET /api/oauth/authorize` — authorization endpoint
- `POST /api/oauth/token` — token endpoint
- `POST /api/oauth/revoke` — token revocation
- `POST /api/oauth/introspect` — token introspection

**MCP:**
- `POST /api/mcp` — JSON-RPC (MCP protocol)
- `GET /api/mcp` — SSE stream
- `DELETE /api/mcp` — terminate session

**API Keys:**
- `GET /api/keys` — list API keys
- `POST /api/keys` — create API key
- `DELETE /api/keys/:id` — revoke API key

**Usage:**
- `GET /api/usage/summary` — usage statistics

**Discovery:**
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/agent-card.json`
- `GET /.well-known/agent-registration.json`
- `GET /.well-known/ai-plugin.json`

## Implementation

1. Read each API route file to understand request/response schemas
2. Read `api/_lib/schema.sql` for data models
3. Read `api/_lib/validate.js` for request validation schemas
4. Build complete OpenAPI 3.0 spec with:
   - All endpoints with methods, parameters, request bodies, responses
   - Authentication schemes (Bearer token, OAuth 2.1, API key)
   - Schema definitions for Avatar, User, ApiKey, UsageSummary, etc.
   - Error response schemas
   - Rate limiting headers
   - Tags for grouping (Avatars, Auth, OAuth, MCP, Keys, Usage)

## Validation

- Copy spec to https://editor.swagger.io/ — should pass validation
- Each documented endpoint should match an actual route in `api/`
- Request/response schemas should match actual handler code
