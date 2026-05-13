# REST API Reference

Complete reference for the `@xspace/server` HTTP API. All endpoints are served by the Express server created in `packages/server/src/create-server.ts` and the route modules under `packages/server/src/routes/`.

## Authentication

Three methods are accepted (any one is sufficient):

| Method | Example |
|--------|---------|
| `X-API-Key` header | `X-API-Key: <ADMIN_API_KEY>` |
| `Authorization` header | `Authorization: Bearer <ADMIN_API_KEY>` |
| Query parameter | `?apiKey=<ADMIN_API_KEY>` |

Routes under `/admin/*`, `/config`, `/state`, `/api/personalities/*`, `/api/agents/*`, `/api/deployments/*`, and `/api/builder/*` require authentication. Public routes (`/health`, `/metrics`, `/marketplace` browse endpoints) do not.

Many multi-tenant endpoints also require a **tenant context** (organization and user identity) provided by upstream auth middleware. These are marked with "Tenant: Yes" below.

## Error Format

All error responses follow a standardized structure:

```json
{
  "code": "NOT_FOUND",
  "message": "Human-readable description",
  "hint": "Actionable fix suggestion (optional)",
  "requestId": "uuid"
}
```

## Rate Limiting

All endpoints are rate-limited at **100 requests per minute per IP** by default (configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` environment variables).

---

## 1. Health and Metrics

### GET /health

Returns server health status including database and Redis connectivity.

- **Auth required:** No

**Response `200 OK` (healthy) / `503 Service Unavailable` (degraded):**

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "timestamp": "2026-03-27T00:00:00.000Z",
  "agent": "listening",
  "database": { "ok": true },
  "redis": { "ok": true }
}
```

```bash
curl http://localhost:3000/health
```

---

### GET /metrics

Returns metrics in Prometheus text exposition format.

- **Auth required:** No

**Response `200 OK`:**

```
Content-Type: text/plain; version=0.0.4

# HELP xspace_space_joins_total Total Space join attempts
# TYPE xspace_space_joins_total counter
xspace_space_joins_total 5
...
```

```bash
curl http://localhost:3000/metrics
```

---

### GET /metrics/json

Returns metrics in JSON format.

- **Auth required:** No

**Response `200 OK`:**

```json
{
  "counters": { ... },
  "gauges": { ... },
  "histograms": { ... }
}
```

---

## 2. Agent Control and State

Agent lifecycle is primarily controlled via Socket.IO events (`xspace:start`, `xspace:stop`, `xspace:join`, `xspace:leave`). The REST endpoints below expose read-only state and agent personality management.

### GET /config

Returns the current AI provider and agent status.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{
  "aiProvider": "openai",
  "status": "listening"
}
```

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" http://localhost:3000/config
```

---

### GET /state

Returns the current agent state snapshot including recent messages.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{
  "status": "listening",
  "spaceUrl": "https://x.com/i/spaces/1eaJbNPAEkwKX",
  "messages": [
    {
      "id": "1711500000000",
      "agentId": -1,
      "name": "Speaker",
      "text": "Hello everyone",
      "timestamp": 1711500000000,
      "isUser": true
    }
  ]
}
```

Messages are capped at the 50 most recent entries.

---

### GET /api/agents/:agentId/personality

Returns the currently assigned personality for an agent.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID (`0` or `1`) |

**Response `200 OK`:**

```json
{
  "agentId": 0,
  "personality": { ... }
}
```

---

### POST /api/agents/:agentId/personality

Hot-swap an agent's personality at runtime. Updates system prompt, temperature, max tokens, voice settings, and optionally clears conversation history.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `agentId` | string | Yes | Agent ID (`0` or `1`) |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personalityId` | string | Yes | ID of a loaded personality |
| `clearHistory` | boolean | No | Clear conversation history on swap |

**Response `200 OK`:**

```json
{
  "success": true,
  "agentId": 0,
  "personality": { ... },
  "hotSwapped": true
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Personality ID not found |

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"personalityId": "debate-moderator", "clearHistory": true}' \
  http://localhost:3000/api/agents/0/personality
```

---

## 3. Personalities

CRUD endpoints for agent personality definitions. Mounted at `/api/personalities`.

### GET /api/personalities

List all loaded personalities (built-in and custom).

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:** Array of personality objects.

---

### GET /api/personalities/:id

Get a single personality by ID.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Personality ID |

**Response `200 OK`:** Personality object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Personality not found |

---

### POST /api/personalities

Create a new custom personality.

- **Auth required:** Yes (ADMIN_API_KEY)

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique personality ID |
| `name` | string | Yes | Display name |
| `systemPrompt` | string | Yes | System prompt text |
| `description` | string | No | Short description |
| `context` | string[] | No | Additional context paragraphs |
| `behavior.temperature` | number | No | LLM temperature (0-2) |
| `behavior.maxResponseTokens` | number | No | Max response tokens |
| `voice.provider` | string | No | TTS provider name |
| `voice.voiceId` | string | No | Provider-specific voice ID |
| `voice.speed` | number | No | Speech speed multiplier |
| `voice.stability` | number | No | Voice stability setting |

**Response `201 Created`:** Created personality object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid request body |

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "tech-expert",
    "name": "Tech Expert",
    "systemPrompt": "You are a senior software engineer...",
    "behavior": { "temperature": 0.7 }
  }' \
  http://localhost:3000/api/personalities
```

---

### PUT /api/personalities/:id

Update an existing personality. All fields are optional (partial update).

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Personality ID |

**Request body:** Same fields as POST, all optional.

**Response `200 OK`:** Updated personality object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Personality not found |
| 400 | `VALIDATION_ERROR` | Invalid request body |

---

### DELETE /api/personalities/:id

Delete a custom personality. Built-in personalities cannot be deleted.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Personality ID |

**Response `200 OK`:**

```json
{ "success": true }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Personality not found |
| 400 | `VALIDATION_ERROR` | Cannot delete built-in personality |

---

## 4. Builder (No-Code Agent Flows)

Endpoints for the visual agent builder. Mounted at `/api/builder`.

### Templates

#### GET /api/builder/templates

List all available flow templates.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

#### GET /api/builder/templates/:id

Get a single template by ID.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Template ID |

**Response `200 OK`:**

```json
{ "template": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Template not found |

---

#### GET /api/builder/templates/category/:category

List templates filtered by category.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `category` | string | Yes | Category name |

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

### Flows CRUD

#### GET /api/builder/flows

List all saved flows (summary view).

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{
  "flows": [
    {
      "id": "uuid",
      "name": "My Agent",
      "description": "",
      "version": 1,
      "nodeCount": 5,
      "createdAt": "2026-03-27T00:00:00.000Z",
      "updatedAt": "2026-03-27T00:00:00.000Z"
    }
  ]
}
```

---

#### GET /api/builder/flows/:id

Get a single flow with full node/connection data.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Response `200 OK`:**

```json
{ "flow": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Flow not found |

---

#### POST /api/builder/flows

Create a new flow.

- **Auth required:** Yes (ADMIN_API_KEY)

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Flow name |
| `description` | string | No | Flow description (default: `""`) |
| `nodes` | array | No | Flow nodes (default: `[]`) |
| `connections` | array | No | Node connections (default: `[]`) |
| `variables` | array | No | Flow variables (default: `[]`) |
| `personality` | object | No | Personality settings (see below) |
| `templateId` | string | No | Source template ID |

**Personality object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent name |
| `role` | string | Yes | Agent role |
| `tone` | number | Yes | Tone level (0-100) |
| `energy` | number | Yes | Energy level (0-100) |
| `detail` | number | Yes | Detail level (0-100) |
| `humor` | number | Yes | Humor level (0-100) |
| `knowledgeAreas` | string[] | Yes | Knowledge domain tags |
| `excludeTopics` | string[] | Yes | Topics to avoid |
| `exampleConversations` | array | Yes | Example exchanges |

**Response `201 Created`:**

```json
{ "flow": { ... } }
```

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Customer Support Bot", "nodes": [], "connections": []}' \
  http://localhost:3000/api/builder/flows
```

---

#### POST /api/builder/flows/from-template/:templateId

Create a new flow pre-populated from a template.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `templateId` | string | Yes | Template ID to clone from |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Override the template name |

**Response `201 Created`:**

```json
{ "flow": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Template not found |

---

#### PUT /api/builder/flows/:id

Update an existing flow. Increments version number automatically.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Request body:** Same fields as POST (all optional for partial update).

**Response `200 OK`:**

```json
{ "flow": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Flow not found |

---

#### DELETE /api/builder/flows/:id

Delete a flow.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Response `200 OK`:**

```json
{ "success": true }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Flow not found |

---

### Validation and Transpilation

#### POST /api/builder/flows/:id/validate

Validate a saved flow for correctness.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Response `200 OK`:**

```json
{
  "valid": true,
  "errors": [],
  "warnings": []
}
```

---

#### POST /api/builder/validate

Validate a flow definition without saving it.

- **Auth required:** Yes (ADMIN_API_KEY)

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `nodes` | array | Yes | At least one node required |
| `connections` | array | No | Node connections (default: `[]`) |
| `variables` | array | No | Flow variables (default: `[]`) |

Additional fields are allowed (passthrough).

**Response `200 OK`:**

```json
{
  "valid": true,
  "errors": [],
  "warnings": []
}
```

---

#### POST /api/builder/flows/:id/transpile

Convert a validated flow into an `AgentConfig` object.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Response `200 OK`:**

```json
{ "config": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Flow has validation errors |
| 404 | `NOT_FOUND` | Flow not found |

---

### Deploy and Preview

#### POST /api/builder/flows/:id/deploy

Deploy a validated flow as a running agent.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | Yes | Target platform (e.g. `"x_spaces"`) |
| `mode` | string | No | Deployment mode |
| `credentials` | object | No | Platform credentials (string values) |

**Response `201 Created`:**

```json
{
  "deployment": {
    "id": "uuid",
    "flowId": "uuid",
    "status": "running",
    "platform": "x_spaces",
    "deployConfig": { ... },
    "startedAt": "2026-03-27T00:00:00.000Z"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Flow has validation errors |
| 404 | `NOT_FOUND` | Flow not found |

---

#### POST /api/builder/flows/:id/preview

Create a temporary 30-minute preview deployment.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Flow ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | No | Target platform (default: `"x_spaces"`) |

**Response `201 Created`:**

```json
{
  "deployment": {
    "id": "uuid",
    "flowId": "uuid",
    "status": "preview",
    "platform": "x_spaces",
    "startedAt": "2026-03-27T00:00:00.000Z",
    "expiresAt": "2026-03-27T00:30:00.000Z"
  },
  "previewUrl": "/preview/uuid"
}
```

---

#### GET /api/builder/deployments

List all active deployments.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{ "deployments": [ ... ] }
```

---

#### GET /api/builder/deployments/:id

Get deployment status.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Deployment ID |

**Response `200 OK`:**

```json
{ "deployment": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Deployment not found |

---

#### POST /api/builder/deployments/:id/stop

Stop a running deployment.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Deployment ID |

**Response `200 OK`:**

```json
{
  "deployment": {
    "id": "uuid",
    "status": "stopped",
    ...
  }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Deployment not found |

---

## 5. Deployments (CI/CD Versioning)

Agent version management, testing, and environment promotion. Mounted at `/api/deployments`.

### Versions

#### GET /api/deployments/agents/:id/versions

List all versions for an agent.

- **Auth required:** Yes
- **Permission:** `deployments:read`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Response `200 OK`:**

```json
{ "versions": [ ... ] }
```

---

#### GET /api/deployments/agents/:id/versions/:version

Get a specific version.

- **Auth required:** Yes
- **Permission:** `deployments:read`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |
| `version` | string | Yes | Version number (integer) |

**Response `200 OK`:** Version object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Version not found |

---

#### POST /api/deployments/agents/:id/versions

Create a new agent version.

- **Auth required:** Yes
- **Permission:** `deployments:create`
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `config` | object | Yes | Agent configuration (non-empty) |
| `changelog` | string | No | Description of changes |

**Response `201 Created`:** Version object.

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"config": {"ai": {"provider": "openai"}}, "changelog": "Updated AI provider"}' \
  http://localhost:3000/api/deployments/agents/abc123/versions
```

---

### Testing

#### POST /api/deployments/agents/:id/test

Run a test suite against a specific version.

- **Auth required:** Yes
- **Permission:** `deployments:create`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `versionId` | string | Yes | Version ID to test |
| `tests` | array | Yes | At least one test case |
| `tests[].name` | string | Yes | Test name |
| `tests[].input` | string | Yes | Test input |
| `tests[].expectedOutput` | string | No | Expected output pattern |

**Response `200 OK`:**

```json
{
  "passed": 3,
  "failed": 1,
  "total": 4,
  "results": [ ... ]
}
```

---

### Deployment

#### POST /api/deployments/agents/:id/deploy

Deploy a version to an environment.

- **Auth required:** Yes
- **Permission:** `deployments:create`
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `versionId` | string | Yes | Version ID to deploy |
| `environment` | string | Yes | `"development"`, `"staging"`, or `"production"` |

**Response `201 Created`:** Deployment object.

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"versionId": "ver_abc123", "environment": "staging"}' \
  http://localhost:3000/api/deployments/agents/abc123/deploy
```

---

#### GET /api/deployments/agents/:id/deployments

List deployment history for an agent.

- **Auth required:** Yes
- **Permission:** `deployments:read`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Response `200 OK`:**

```json
{ "deployments": [ ... ] }
```

---

### Promotion

#### POST /api/deployments/agents/:id/promote

Promote a version to the next environment (e.g. staging to production).

- **Auth required:** Yes
- **Permission:** `deployments:promote`
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `versionId` | string | Yes | Version ID to promote |
| `targetEnvironment` | string | Yes | `"development"`, `"staging"`, or `"production"` |

**Response `200 OK`:** Deployment object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Cannot promote (e.g., skipping environments) |
| 404 | `NOT_FOUND` | Version not found |

---

### Rollback

#### POST /api/deployments/agents/:id/rollback

Rollback to the previous version in an environment.

- **Auth required:** Yes
- **Permission:** `deployments:rollback`
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Agent ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `environment` | string | Yes | `"development"`, `"staging"`, or `"production"` |
| `reason` | string | Yes | Reason for rollback |

**Response `200 OK`:**

```json
{
  "rolledBack": { ... },
  "reactivated": { ... }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | No active deployment in environment |

---

## 6. Marketplace

Browse, install, publish, and review marketplace listings. Routes are mounted at the root level (`/marketplace/*`) plus admin routes at `/admin/marketplace/*`.

### Browse

#### GET /marketplace

Search and browse marketplace listings.

- **Auth required:** No

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No | Search query |
| `type` | string | No | Filter by type |
| `category` | string | No | Filter by category |
| `pricing` | string | No | Filter by pricing model |
| `sort` | string | No | Sort order: `"popular"` (default), `"newest"`, `"rating"`, `"name"` |
| `limit` | number | No | Results per page (1-100, default: 20) |
| `offset` | number | No | Pagination offset (default: 0) |

**Response `200 OK`:**

```json
{
  "listings": [ ... ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

```bash
curl "http://localhost:3000/marketplace?q=voice&type=voice_pack&sort=rating&limit=10"
```

---

#### GET /marketplace/featured

Get featured and trending listings.

- **Auth required:** No

**Response `200 OK`:**

```json
{ "listings": [ ... ] }
```

---

#### GET /marketplace/categories

Get all categories with listing counts.

- **Auth required:** No

**Response `200 OK`:**

```json
{ "categories": [ ... ] }
```

---

#### GET /marketplace/:slug

Get full details for a single listing.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `slug` | string | Yes | Listing URL slug |

**Response `200 OK`:**

```json
{ "listing": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Listing not found |

---

#### GET /marketplace/:slug/reviews

Get reviews for a listing.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `slug` | string | Yes | Listing URL slug |

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Results per page (max 100, default: 20) |
| `offset` | number | No | Pagination offset (default: 0) |

**Response `200 OK`:**

```json
{
  "reviews": [ ... ],
  "listingId": "uuid"
}
```

---

### Install / Uninstall

#### POST /marketplace/:slug/install

Install or purchase a listing for your organization.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `slug` | string | Yes | Listing URL slug |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `config` | object | No | Installation configuration (default: `{}`) |

**Response `201 Created`:**

```json
{ "install": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Listing not found or not published |
| 409 | `VALIDATION_ERROR` | Already installed |

---

#### DELETE /marketplace/:slug/uninstall

Uninstall a listing from your organization.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `slug` | string | Yes | Listing URL slug |

**Response `200 OK`:**

```json
{ "success": true }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Listing not found or not installed |

---

#### GET /marketplace/installed

List all installed items for the current organization.

- **Auth required:** Yes
- **Tenant:** Yes

**Response `200 OK`:**

```json
{ "installs": [ ... ] }
```

---

### Publisher

#### POST /marketplace/publish

Submit a new listing for review.

- **Auth required:** Yes
- **Tenant:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Listing name |
| `type` | string | Yes | `"template"`, `"plugin"`, `"voice_pack"`, or `"integration"` |
| `category` | string | Yes | Category name |
| `description` | string | Yes | Short description |
| `pricingModel` | string | Yes | `"free"`, `"one_time"`, `"monthly"`, or `"usage"` |
| `version` | string | Yes | Semantic version string |
| `longDescription` | string | No | Extended description |
| `priceCents` | number | No | Price in cents (required for paid listings) |
| `tags` | string[] | No | Tags (default: `[]`) |
| `iconUrl` | string | No | Icon URL |
| `screenshots` | string[] | No | Screenshot URLs (default: `[]`) |
| `demoUrl` | string | No | Demo URL |
| `sourceUrl` | string | No | Source code URL |
| `documentationUrl` | string | No | Documentation URL |
| `supportEmail` | string | No | Support email |
| `manifest` | object | No | Plugin manifest (default: `{}`) |
| `minPlatformVersion` | string | No | Minimum platform version |

**Response `201 Created`:**

```json
{ "listing": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 409 | `VALIDATION_ERROR` | Listing with similar name already exists |

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Plugin",
    "type": "plugin",
    "category": "productivity",
    "description": "A useful plugin",
    "pricingModel": "free",
    "version": "1.0.0"
  }' \
  http://localhost:3000/marketplace/publish
```

---

#### PATCH /marketplace/listings/:id

Update an existing listing (publisher only).

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Listing ID |

**Request body:** Any of: `description`, `longDescription`, `tags`, `iconUrl`, `screenshots`, `demoUrl`, `sourceUrl`, `documentationUrl`, `supportEmail`, `manifest`, `version`, `minPlatformVersion`.

**Response `200 OK`:**

```json
{ "listing": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Not the publisher |
| 404 | `NOT_FOUND` | Listing not found |

---

#### GET /marketplace/publisher/listings

List all listings owned by the current organization.

- **Auth required:** Yes
- **Tenant:** Yes

**Response `200 OK`:**

```json
{ "listings": [ ... ] }
```

---

#### GET /marketplace/publisher/analytics

Get revenue and install analytics for the current publisher.

- **Auth required:** Yes
- **Tenant:** Yes

**Response `200 OK`:**

```json
{
  "listingCount": 3,
  "totalInstalls": 150,
  "avgRating": 4.5,
  "totalRevenueCents": 50000,
  "recentPayouts": [ ... ],
  "listings": [
    {
      "id": "uuid",
      "name": "My Plugin",
      "slug": "my-plugin",
      "installCount": 50,
      "ratingAvg": 4.5,
      "ratingCount": 12,
      "status": "published"
    }
  ]
}
```

---

### Reviews

#### POST /marketplace/:slug/reviews

Submit a review for an installed listing.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `slug` | string | Yes | Listing URL slug |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rating` | number | Yes | Rating (1-5) |
| `title` | string | No | Review title |
| `body` | string | No | Review text |

**Response `201 Created`:**

```json
{ "review": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Must install before reviewing |
| 404 | `NOT_FOUND` | Listing not found |
| 409 | `VALIDATION_ERROR` | Already reviewed |

---

#### PUT /marketplace/:slug/reviews/:id

Update your own review.

- **Auth required:** Yes
- **Tenant:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rating` | number | No | Updated rating (1-5) |
| `title` | string | No | Updated title |
| `body` | string | No | Updated body |

**Response `200 OK`:**

```json
{ "review": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Not the review author |
| 404 | `NOT_FOUND` | Review not found |

---

#### DELETE /marketplace/:slug/reviews/:id

Delete your own review.

- **Auth required:** Yes
- **Tenant:** Yes

**Response `200 OK`:**

```json
{ "success": true }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Not the review author |
| 404 | `NOT_FOUND` | Review not found |

---

### Marketplace Admin

#### GET /admin/marketplace/review-queue

List listings pending admin review.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{ "listings": [ ... ] }
```

---

#### POST /admin/marketplace/:id/approve

Approve a listing for publication.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Listing ID |

**Response `200 OK`:**

```json
{ "listing": { ... } }
```

---

#### POST /admin/marketplace/:id/reject

Reject a listing.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Listing ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Rejection reason (default: `"Rejected by admin"`) |

**Response `200 OK`:**

```json
{ "listing": { ... } }
```

---

#### POST /admin/marketplace/:id/suspend

Suspend a published listing.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Listing ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Suspension reason (default: `"Rejected by admin"`) |

**Response `200 OK`:**

```json
{ "listing": { ... } }
```

---

## 7. Analytics (Conversation Intelligence)

Session-level conversation analytics. Mounted at `/api/analytics`.

### GET /api/analytics/sessions/:id

Get full analytics for a session.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Response `200 OK`:** Full analytics object including metrics, sentiment, topics, speakers, insights.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Session belongs to different org |
| 404 | `NOT_FOUND` | Analytics not found |

---

### GET /api/analytics/sessions/:id/sentiment

Get sentiment timeseries data for a session.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `speaker` | string | No | Filter by speaker name |

**Response `200 OK`:**

```json
{
  "sessionId": "uuid",
  "points": [
    { "timestamp": "...", "speaker": "Alice", "sentiment": 0.8, "topic": "..." }
  ]
}
```

---

### GET /api/analytics/sessions/:id/topics

Get topic breakdown for a session.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{
  "sessionId": "uuid",
  "primaryTopic": "AI agents",
  "topics": [ ... ]
}
```

---

### GET /api/analytics/sessions/:id/speakers

Get speaker analytics for a session.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{
  "sessionId": "uuid",
  "speakers": [ ... ],
  "participantCount": 5
}
```

---

### GET /api/analytics/sessions/:id/insights

Get AI-generated insights for a session.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{
  "sessionId": "uuid",
  "summary": "...",
  "keyDecisions": [ ... ],
  "actionItems": [ ... ],
  "recommendations": [ ... ],
  "highlights": [ ... ],
  "riskFlags": [ ... ]
}
```

---

### GET /api/analytics/sessions/:id/transcript

Get an annotated transcript with per-message sentiment and topic data.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{
  "sessionId": "uuid",
  "messageCount": 42,
  "transcript": [
    {
      "speaker": "Alice",
      "text": "Hello everyone",
      "timestamp": 1711500000000,
      "sentiment": { "value": 0.6, "label": "positive" },
      "topic": "general"
    }
  ]
}
```

---

### POST /api/analytics/sessions/:id/reprocess

Re-run the analytics pipeline on an existing session.

- **Auth required:** Yes
- **Tenant:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{
  "status": "reprocessed",
  "sessionId": "uuid",
  "summary": "...",
  "topicCount": 3,
  "speakerCount": 4,
  "highlightCount": 2
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Session belongs to different org |
| 404 | `NOT_FOUND` | Session or conversation data not found |

---

### GET /api/analytics/aggregate

Get aggregate analytics across all sessions for the organization.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | Time period in format `"Nd"` (e.g. `"30d"`) |

**Response `200 OK`:** Aggregate statistics object.

---

### GET /api/analytics/trends

Get trend analysis over a time period.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `days` | number | No | Lookback period in days (1-365, default: 30) |

**Response `200 OK`:**

```json
{
  "period": "30d",
  "trends": [
    {
      "date": "2026-03-01",
      "avgSentiment": 0.45,
      "sessionCount": 3,
      "avgDurationSeconds": 1800
    }
  ]
}
```

---

### GET /api/analytics/reports/weekly

Get a weekly intelligence report.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `weeksBack` | number | No | Weeks in the past (0-52, default: 0 for current week) |

**Response `200 OK`:**

```json
{
  "period": { "start": "...", "end": "..." },
  "totalSessions": 12,
  "summary": "12 session(s) recorded this week...",
  "metrics": {
    "avgSentiment": 0.35,
    "avgDurationMinutes": 45,
    "avgParticipants": 6.2,
    "totalTurns": 340
  },
  "sentimentOverview": { "positive": 8, "neutral": 3, "negative": 1 },
  "topTopics": [ ... ],
  "topSpeakers": [ ... ],
  "risks": [ ... ],
  "recommendations": [ ... ]
}
```

---

### GET /api/analytics/reports/export

Export analytics data as CSV or JSON.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | `"csv"` (default) or `"json"` |
| `period` | string | No | Time period in `"Nd"` format (default: `"30d"`) |

**Response:** File download with `Content-Disposition` header.

- CSV: `Content-Type: text/csv`
- JSON: `Content-Type: application/json`

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/api/analytics/reports/export?format=csv&period=30d" \
  -o analytics.csv
```

---

## 8. Events (Server-Sent Events)

Real-time event streaming via SSE. These routes require external configuration (EventSubscriber, EventBuffer, ConnectionManager) and are created with `createEventRoutes()`.

### GET /v1/events/stream

Subscribe to real-time events via Server-Sent Events (SSE).

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `events` | string | No | Comma-separated event types to filter |
| `session` | string | No | Comma-separated session IDs to filter |
| `agent` | string | No | Comma-separated agent IDs to filter |

**Headers:**

| Header | Description |
|--------|-------------|
| `Last-Event-ID` | Resume from a specific event (catch-up replay) |

**Response:** SSE stream (`text/event-stream`).

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 429 | - | Too many SSE connections for organization |

```bash
curl -N -H "X-API-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/v1/events/stream?events=transcription,response&session=sess_abc"
```

---

### GET /v1/events/replay

Replay missed events from the buffer.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session` | string | No | Session ID filter |
| `since` | string | No | Resume after this event ID |
| `limit` | number | No | Max events to return (default: 100, max: 500) |

**Response `200 OK`:**

```json
{
  "events": [ ... ],
  "count": 42,
  "hasMore": false
}
```

---

## 9. Onboarding and PLG

Product-led growth endpoints for onboarding, templates, upgrade triggers, activation tracking, drip campaigns, and referrals. Mounted at `/api`.

### Onboarding Wizard

#### POST /api/onboarding/start

Start onboarding for a new user.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |
| `signupMethod` | string | No | Signup method (default: `"email"`) |
| `referralCode` | string | No | Referral code |

**Response `200 OK`:**

```json
{
  "state": { ... },
  "progress": 0
}
```

---

#### GET /api/onboarding/:orgId/:userId

Get current onboarding state.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `orgId` | string | Yes | Organization ID |
| `userId` | string | Yes | User ID |

**Response `200 OK`:**

```json
{
  "state": { ... },
  "progress": 50
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Onboarding not found |

---

#### POST /api/onboarding/welcome-wizard

Complete the welcome wizard step.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |
| `answers` | object | Yes | Wizard answers |
| `answers.useCase` | string | No | Use case selection |
| `answers.teamSize` | string | No | Team size |
| `answers.experience` | string | No | Experience level |

Additional answer fields are accepted (passthrough).

**Response `200 OK`:**

```json
{
  "state": { ... },
  "recommendedTemplate": { ... },
  "progress": 25
}
```

---

#### POST /api/onboarding/create-agent

Complete the agent creation step.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |
| `input` | object | Yes | Agent creation input |
| `input.name` | string | No | Agent name |
| `input.templateId` | string | No | Template to use |

Additional input fields are accepted (passthrough).

**Response `200 OK`:**

```json
{
  "state": { ... },
  "progress": 50
}
```

---

#### POST /api/onboarding/test-agent

Complete the agent test step.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |

**Response `200 OK`:**

```json
{
  "state": { ... },
  "progress": 75
}
```

---

#### POST /api/onboarding/complete

Mark onboarding as complete.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |

**Response `200 OK`:**

```json
{
  "state": { ... },
  "progress": 100
}
```

---

#### POST /api/onboarding/skip

Skip to a specific onboarding step.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |
| `targetStep` | string | Yes | Step to skip to |

**Response `200 OK`:**

```json
{
  "state": { ... },
  "progress": 50
}
```

---

### Agent Templates (Onboarding)

#### GET /api/templates

List all agent templates.

- **Auth required:** No

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

#### GET /api/templates/featured

List featured agent templates.

- **Auth required:** No

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

#### GET /api/templates/plan/:tier

List templates available for a plan tier.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `tier` | string | Yes | Plan tier name |

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

#### GET /api/templates/category/:category

List templates by category.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `category` | string | Yes | Category name |

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

#### GET /api/templates/:id

Get a single agent template.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Template ID |

**Response `200 OK`:**

```json
{ "template": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Template not found |

---

### Upgrade Triggers

#### POST /api/upgrade-triggers/evaluate

Evaluate whether to show upgrade prompts to an organization.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `orgId` | string | Yes | Organization ID |
| `currentPlan` | string | Yes | Current plan name |
| `quotas` | object | Yes | Current quota usage |
| `context` | any | No | Additional context |

**Response `200 OK`:**

```json
{ "prompts": [ ... ] }
```

---

#### POST /api/upgrade-triggers/dismiss

Dismiss an upgrade prompt.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `orgId` | string | Yes | Organization ID |
| `triggerId` | string | Yes | Trigger ID to dismiss |

**Response `200 OK`:**

```json
{ "success": true }
```

---

### Activation Tracking

#### GET /api/activation/:orgId

Get activation summary for an organization.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `orgId` | string | Yes | Organization ID |

**Response `200 OK`:**

```json
{ "summary": { ... } }
```

---

#### POST /api/activation/track

Track an activation event.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | string | Yes | Activation event name |
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |
| `metadata` | object | No | Additional metadata |

**Response `200 OK`:**

```json
{ "tracked": true, "record": { ... } }
```

---

### Drip Campaign

#### GET /api/drip/:orgId/:userId

Get drip campaign state for a user.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `orgId` | string | Yes | Organization ID |
| `userId` | string | Yes | User ID |

**Response `200 OK`:**

```json
{ "state": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Drip campaign not found |

---

#### POST /api/drip/evaluate

Evaluate which drip emails are due for a user.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |
| `currentPlan` | string | Yes | Current plan name |

**Response `200 OK`:**

```json
{ "dueEmails": [ ... ] }
```

---

#### POST /api/drip/unsubscribe

Unsubscribe a user from the drip campaign.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User ID |
| `orgId` | string | Yes | Organization ID |

**Response `200 OK`:**

```json
{ "success": true }
```

---

### Referral Program

#### GET /api/referral/code/:userId

Get or create a referral code for a user.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `userId` | string | Yes | User ID |

**Response `200 OK`:**

```json
{ "code": "REF_abc123" }
```

---

#### GET /api/referral/summary/:userId

Get referral summary (signups, conversions) for a user.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `userId` | string | Yes | User ID |

**Response `200 OK`:**

```json
{ "summary": { ... } }
```

---

#### GET /api/referral/lookup/:code

Look up a referral by code.

- **Auth required:** No

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `code` | string | Yes | Referral code |

**Response `200 OK`:**

```json
{ "referral": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Referral not found |

---

#### POST /api/referral/signup

Record a referral signup.

- **Auth required:** No

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Referral code |
| `referredUserId` | string | Yes | New user's ID |
| `referredOrgId` | string | Yes | New user's org ID |

**Response `200 OK`:**

```json
{ "referral": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid or already-used referral code |

---

### Product Analytics (Onboarding)

#### GET /api/analytics/events

Get recent product analytics events.

- **Auth required:** No

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Event category filter |
| `userId` | string | No | Filter by user |
| `orgId` | string | No | Filter by organization |
| `limit` | number | No | Max events (default: 50) |

**Response `200 OK`:**

```json
{ "events": [ ... ] }
```

---

#### GET /api/analytics/funnel

Get funnel metrics for a time period.

- **Auth required:** No

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start` | string | Yes | Start date (ISO format) |
| `end` | string | Yes | End date (ISO format) |

**Response `200 OK`:**

```json
{ "metrics": { ... } }
```

---

## 10. Organizations

Organization CRUD, member management, RBAC, custom roles, and teams. Created with `createOrgRoutes()`.

### Organization CRUD

#### GET /org

Get current organization details.

- **Auth required:** Yes
- **Permission:** `org:read`

**Response `200 OK`:**

```json
{ "org": { ... } }
```

---

#### PATCH /org

Update organization settings.

- **Auth required:** Yes
- **Permission:** `org:settings`

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Organization name |
| `settings` | object | No | Organization settings |

**Response `200 OK`:**

```json
{ "org": { ... } }
```

---

#### DELETE /org

Delete the organization. Requires confirmation.

- **Auth required:** Yes
- **Permission:** `org:delete`

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `confirm` | string | Yes | Must match the org ID |

**Response `200 OK`:**

```json
{ "deleted": true }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | Confirmation string does not match org ID |

---

### Members

#### GET /org/members

List all organization members with their roles.

- **Auth required:** Yes
- **Permission:** `members:read`

**Response `200 OK`:**

```json
{ "members": [ ... ] }
```

---

#### POST /org/members/invite

Invite a user to the organization by email. Creates a 7-day invitation token.

- **Auth required:** Yes
- **Permission:** `members:invite`

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address to invite |
| `role` | string | Yes | Role to assign (`owner`, `admin`, `editor`, `viewer`) |

**Response `201 Created`:**

```json
{
  "invitation": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "editor",
    "expiresAt": "2026-04-03T00:00:00.000Z"
  },
  "inviteToken": "hex-token"
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | Invalid role |
| 403 | - | Cannot invite with a role higher than your own |
| 409 | - | User already a member or pending invitation exists |

---

#### POST /org/members/accept

Accept an invitation using the invite token.

- **Auth required:** No (token-based)

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Invitation token |

**Response `200 OK`:**

```json
{
  "member": {
    "userId": "uuid",
    "orgId": "uuid",
    "role": "editor"
  }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | Invitation expired or already used |
| 404 | - | Invalid token |

---

#### PATCH /org/members/:userId

Update a member's role.

- **Auth required:** Yes
- **Permission:** `members:update`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `userId` | string | Yes | User ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | string | Yes | New role |
| `customRoleId` | string | No | Custom role ID (enterprise) |

**Response `200 OK`:**

```json
{ "member": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | Cannot change your own role |
| 403 | - | Cannot assign a role higher than your own or modify a higher-role member |
| 404 | - | Member not found |

---

#### DELETE /org/members/:userId

Remove a member from the organization.

- **Auth required:** Yes
- **Permission:** `members:remove`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `userId` | string | Yes | User ID |

**Response `200 OK`:**

```json
{ "removed": true }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | Cannot remove yourself |
| 403 | - | Cannot remove a higher-role member or the owner |
| 404 | - | Member not found |

---

### Custom Roles (Enterprise Only)

#### GET /org/roles

List all available roles (built-in and custom).

- **Auth required:** Yes
- **Permission:** `org:read`

**Response `200 OK`:**

```json
{
  "roles": [
    {
      "name": "admin",
      "description": "Full access",
      "permissions": ["org:read", "org:settings", ...],
      "builtIn": true
    },
    {
      "id": "uuid",
      "name": "analyst",
      "description": "Read-only analytics",
      "permissions": ["org:read", "analytics:read"],
      "builtIn": false
    }
  ]
}
```

---

#### POST /org/roles

Create a custom role. Enterprise plans only.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Plan:** Enterprise

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Role name |
| `description` | string | No | Role description |
| `permissions` | string[] | Yes | Array of permission strings |

**Response `201 Created`:**

```json
{ "role": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | Invalid permissions |
| 409 | - | Role name already exists |

---

#### PATCH /org/roles/:roleId

Update a custom role.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Plan:** Enterprise

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `roleId` | string | Yes | Custom role ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated name |
| `description` | string | No | Updated description |
| `permissions` | string[] | No | Updated permissions |

**Response `200 OK`:**

```json
{ "role": { ... } }
```

---

#### DELETE /org/roles/:roleId

Delete a custom role.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Plan:** Enterprise

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `roleId` | string | Yes | Custom role ID |

**Response `200 OK`:**

```json
{ "deleted": true }
```

---

### Teams

#### POST /org/teams

Create a team.

- **Auth required:** Yes
- **Permission:** `teams:create`

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Team name |
| `description` | string | No | Team description |
| `memberIds` | string[] | No | Initial member IDs (default: `[]`) |

**Response `201 Created`:**

```json
{ "team": { ... } }
```

---

#### GET /org/teams

List all teams in the organization.

- **Auth required:** Yes
- **Permission:** `teams:read`

**Response `200 OK`:**

```json
{ "teams": [ ... ] }
```

---

#### PATCH /org/teams/:teamId

Update a team.

- **Auth required:** Yes
- **Permission:** `teams:update`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `teamId` | string | Yes | Team ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated name |
| `description` | string | No | Updated description |
| `memberIds` | string[] | No | Updated member list |

**Response `200 OK`:**

```json
{ "team": { ... } }
```

---

#### DELETE /org/teams/:teamId

Delete a team.

- **Auth required:** Yes
- **Permission:** `teams:delete`

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `teamId` | string | Yes | Team ID |

**Response `200 OK`:**

```json
{ "deleted": true }
```

---

## 11. Usage

Usage tracking, billing period summaries, cost projections, and export. Created with `createUsageRoutes()`.

### GET /usage/current

Get usage summary for the current billing period with quota information.

- **Auth required:** Yes
- **Tenant:** Yes

**Response `200 OK`:**

```json
{
  "period": { ... },
  "metrics": { ... },
  "estimatedCostCents": 2500,
  "activeSessions": 2,
  "maxConcurrentSessions": 5,
  "quotas": {
    "session_minutes": { "used": 120, "limit": 1000, "percent": 12 },
    "llm_input_tokens": { "used": 50000, "limit": -1, "percent": 0 },
    "llm_output_tokens": { "used": 25000, "limit": -1, "percent": 0 },
    "stt_minutes": { "used": 60, "limit": 500, "percent": 12 },
    "tts_characters": { "used": 10000, "limit": 100000, "percent": 10 },
    "api_calls": { "used": 500, "limit": 10000, "percent": 5 },
    "webhook_deliveries": { "used": 100, "limit": 5000, "percent": 2 }
  }
}
```

A `limit` of `-1` indicates unlimited.

---

### GET /usage/history

Get historical usage aggregated by day.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `days` | number | No | Lookback period (max 90, default: 30) |

**Response `200 OK`:**

```json
{
  "orgId": "uuid",
  "days": 30,
  "since": "2026-02-25T00:00:00.000Z",
  "metrics": { ... }
}
```

---

### GET /usage/breakdown

Get per-session usage breakdown.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Max records (max 200, default: 50) |

**Response `200 OK`:**

```json
{
  "orgId": "uuid",
  "sessions": {
    "sess_abc123": {
      "metrics": {
        "session_minutes": 45,
        "llm_input_tokens": 12000
      },
      "costCents": 350
    }
  }
}
```

---

### GET /usage/cost-estimate

Get projected month-end cost based on usage so far.

- **Auth required:** Yes
- **Tenant:** Yes

**Response `200 OK`:**

```json
{
  "orgId": "uuid",
  "period": { ... },
  "currentCostCents": 2500,
  "projectedCostCents": 7500,
  "daysElapsed": 10,
  "daysInMonth": 31,
  "basePriceCents": 9900,
  "projectedTotalCents": 17400
}
```

---

### GET /usage/export

Export usage records as CSV.

- **Auth required:** Yes
- **Tenant:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Max records (max 10000, default: 1000) |

**Response:** CSV file download.

```
Content-Type: text/csv
Content-Disposition: attachment; filename="usage-<orgId>-2026-03-27.csv"

id,session_id,metric,quantity,unit_cost_cents,provider,recorded_at
...
```

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/usage/export?limit=5000" \
  -o usage.csv
```

---

## 12. Voices

Voice cloning, design, management, and marketplace. Created with `createVoiceRoutes()`.

### POST /voices/clone

Clone a voice from uploaded audio samples.

- **Auth required:** Yes
- **Content-Type:** `multipart/form-data`

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `samples` | file(s) | Yes | Audio files (WAV or MP3, max 20 files, max 50MB each) |
| `name` | string | Yes | Voice name (max 100 chars) |
| `consent.consentType` | string | Yes | `"self"`, `"authorized"`, or `"synthetic"` |
| `consent.consentDocument` | string | No | Consent document reference |
| `consent.agreedToTerms` | boolean | Yes | Must be `true` |

**Response `201 Created`:** Voice object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | No audio samples provided |
| 400 | `VOICE_CLONE_ERROR` | Cloning failed |

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -F "samples=@voice-sample.wav" \
  -F "name=My Voice" \
  -F "consent.consentType=self" \
  -F "consent.agreedToTerms=true" \
  http://localhost:3000/voices/clone
```

---

### POST /voices/design

Design a voice from a text description.

- **Auth required:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Voice description (10-500 chars) |
| `gender` | string | Yes | `"male"`, `"female"`, or `"neutral"` |
| `age` | string | Yes | `"young"`, `"middle"`, or `"senior"` |
| `accent` | string | No | Accent description (max 50 chars) |
| `style` | string | Yes | `"conversational"`, `"professional"`, `"energetic"`, `"calm"`, or `"authoritative"` |

**Response `201 Created`:** Voice object.

---

### GET /voices

List all voices for the current organization.

- **Auth required:** Yes

**Response `200 OK`:** Array of voice objects.

---

### GET /voices/library

Browse marketplace voices.

- **Auth required:** Yes

**Response `200 OK`:** Array of marketplace voice objects.

---

### GET /voices/:id

Get voice details.

- **Auth required:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Voice ID |

**Response `200 OK`:** Voice object.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `NOT_FOUND` | Voice not found |

---

### PATCH /voices/:id

Update voice settings.

- **Auth required:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Voice ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Voice name (max 100) |
| `description` | string | No | Description (max 500) |
| `settings.stability` | number | No | Stability (0-1) |
| `settings.similarityBoost` | number | No | Similarity boost (0-1) |
| `settings.style` | number | No | Style exaggeration (0-1) |
| `settings.speed` | number | No | Speed multiplier (0.5-2.0) |

**Response `200 OK`:** Updated voice object.

---

### DELETE /voices/:id

Delete a custom voice.

- **Auth required:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Voice ID |

**Response `200 OK`:**

```json
{ "success": true }
```

---

### POST /voices/:id/preview

Generate a preview audio clip for a voice.

- **Auth required:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Voice ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Preview text (1-1000 chars) |

**Response `200 OK`:**

```
Content-Type: audio/mpeg
Content-Length: <bytes>

<binary audio data>
```

---

### POST /voices/:id/assign/:agentId

Assign a voice to an agent.

- **Auth required:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Voice ID |
| `agentId` | string | Yes | Agent ID |

**Response `200 OK`:**

```json
{
  "success": true,
  "voiceId": "provider-voice-id",
  "agentId": "agent-123",
  "provider": "elevenlabs"
}
```

---

### POST /voices/:id/publish

Publish a voice to the marketplace.

- **Auth required:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Voice ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Listing title (max 200) |
| `description` | string | Yes | Description (10-2000 chars) |
| `tags` | string[] | Yes | Tags (max 10, each max 50 chars) |
| `pricePerMonth` | number | Yes | Monthly price (0-10000) |
| `previewText` | string | Yes | Preview sample text (max 500) |

**Response `200 OK`:**

```json
{ "success": true }
```

---

## 13. Reseller (White-Label)

White-label management, sub-organizations, custom domains, agent templates, impersonation, and billing. Created with `createResellerRoutes()`. All endpoints require the caller to be a registered, active reseller.

### Reseller Profile

#### GET /reseller

Get reseller profile.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Response `200 OK`:**

```json
{ "reseller": { ... } }
```

---

#### PATCH /reseller

Update reseller configuration (branding, tier).

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `config` | object | No | Branding and white-label config |
| `tier` | string | No | Reseller tier |

**Response `200 OK`:**

```json
{ "reseller": { ... } }
```

---

### Sub-Organizations

#### POST /reseller/sub-orgs

Create a sub-organization.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Sub-org name |
| `slug` | string | Yes | URL slug |
| `plan` | string | No | Plan name |
| `settings` | object | No | Sub-org settings |

**Response `201 Created`:**

```json
{ "subOrg": { ... } }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 429 | - | Sub-organization limit reached |

---

#### GET /reseller/sub-orgs

List all sub-organizations.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Response `200 OK`:**

```json
{ "subOrgs": [ ... ] }
```

---

#### GET /reseller/sub-orgs/:id

Get sub-organization details.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Sub-org ID |

**Response `200 OK`:**

```json
{ "subOrg": { ... } }
```

---

#### PATCH /reseller/sub-orgs/:id

Update sub-organization settings.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Sub-org ID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Updated name |
| `plan` | string | No | Updated plan |
| `settings` | object | No | Updated settings |

**Response `200 OK`:**

```json
{ "subOrg": { ... } }
```

---

#### DELETE /reseller/sub-orgs/:id

Delete a sub-organization.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Sub-org ID |

**Response `200 OK`:**

```json
{ "deleted": true }
```

---

#### POST /reseller/sub-orgs/:id/suspend

Suspend a sub-organization.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Sub-org ID |

**Response `200 OK`:**

```json
{ "subOrg": { ... } }
```

---

#### POST /reseller/sub-orgs/:id/activate

Reactivate a suspended sub-organization.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Sub-org ID |

**Response `200 OK`:**

```json
{ "subOrg": { ... } }
```

---

### Custom Domains

#### POST /reseller/domains

Add a custom domain.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | Yes | Domain name |
| `type` | string | Yes | `"dashboard"`, `"api"`, `"docs"`, or `"status"` |

**Response `201 Created`:** Domain object with DNS verification instructions.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 409 | - | Domain already registered |

---

#### GET /reseller/domains

List all custom domains.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Response `200 OK`:**

```json
{ "domains": [ ... ] }
```

---

#### POST /reseller/domains/:id/verify

Verify DNS configuration for a custom domain.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Domain ID |

**Response `200 OK`:**

```json
{ "verified": true }
```

---

#### POST /reseller/domains/:id/provision-tls

Provision a TLS certificate for a verified domain.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Domain ID |

**Response `200 OK`:** TLS provisioning result.

---

#### DELETE /reseller/domains/:id

Remove a custom domain.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Domain ID |

**Response `200 OK`:**

```json
{ "deleted": true }
```

---

### Agent Templates (Reseller)

#### POST /reseller/templates

Create an agent template for sub-organizations.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Template name |
| `description` | string | No | Template description |
| `config` | object | Yes | Agent configuration |
| `isDefault` | boolean | No | Set as default template |
| `targetSubOrgs` | string[] | No | Restrict to specific sub-orgs |

**Response `201 Created`:**

```json
{ "template": { ... } }
```

---

#### GET /reseller/templates

List all agent templates.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Response `200 OK`:**

```json
{ "templates": [ ... ] }
```

---

#### PATCH /reseller/templates/:id

Update an agent template.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Template ID |

**Request body:** Same fields as POST (all optional).

**Response `200 OK`:**

```json
{ "template": { ... } }
```

---

#### DELETE /reseller/templates/:id

Delete an agent template.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `id` | string | Yes | Template ID |

**Response `200 OK`:**

```json
{ "deleted": true }
```

---

### Impersonation

#### POST /reseller/impersonate

Start an impersonation session to act as a sub-organization user.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetOrgId` | string | Yes | Target organization ID |
| `targetUserId` | string | No | Target user ID |
| `durationMinutes` | number | No | Session duration |

**Response `201 Created`:**

```json
{ "session": { ... } }
```

---

#### DELETE /reseller/impersonate/:sessionId

End an impersonation session.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{ "ended": true }
```

---

#### POST /reseller/impersonate/:sessionId/renew

Renew an impersonation session.

- **Auth required:** Yes
- **Permission:** `org:settings`
- **Reseller:** Yes

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID |

**Response `200 OK`:**

```json
{ "session": { ... } }
```

---

#### GET /reseller/impersonate

List active impersonation sessions.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Response `200 OK`:**

```json
{ "sessions": [ ... ] }
```

---

### Reseller Analytics and Billing

#### GET /reseller/analytics

Get aggregate analytics across all sub-organizations.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Response `200 OK`:**

```json
{ "analytics": { ... } }
```

---

#### GET /reseller/billing

Get wholesale billing summary.

- **Auth required:** Yes
- **Permission:** `org:read`
- **Reseller:** Yes

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | string | No | Start date (ISO, default: 30 days ago) |
| `until` | string | No | End date (ISO, default: now) |

**Response `200 OK`:**

```json
{ "billing": { ... } }
```

---

## 14. Admin (Selectors and Providers)

Administrative endpoints for browser selector management and LLM provider monitoring. Authenticated via ADMIN_API_KEY.

### Selectors

#### POST /admin/selectors/:name

Override a CSS selector used for browser automation.

- **Auth required:** Yes (ADMIN_API_KEY)

| Path Parameter | Type | Required | Description |
|----------------|------|----------|-------------|
| `name` | string | Yes | Selector name (max 100 chars) |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | Yes | New CSS selector value (max 500 chars) |

**Response `200 OK`:**

```json
{ "success": true, "message": "Selector 'join-button' overridden" }
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `NOT_FOUND` | No agent running |

```bash
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"selector": "[data-testid=\"join-button\"]"}' \
  http://localhost:3000/admin/selectors/join-button
```

---

#### GET /admin/selectors/health

Validate all selectors against the live browser page.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:** Selector validation report (pass/fail per selector).

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | No agent running or no browser page available |

---

#### GET /admin/selectors/failures

Get the selector failure log.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{
  "failures": [
    {
      "name": "speak-button",
      "attempts": 3,
      "lastError": "Element not found",
      "timestamp": 1711500000000
    }
  ]
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | - | No agent running |

---

### Providers

#### GET /admin/providers

Get provider status, costs, and session duration.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{
  "providers": { ... },
  "costs": { ... },
  "sessionDuration": 3600
}
```

---

#### GET /admin/providers/costs

Get detailed cost tracking data.

- **Auth required:** Yes (ADMIN_API_KEY)

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | number | No | Filter costs since timestamp (epoch ms) |

**Response `200 OK`:**

```json
{
  "summary": { ... },
  "estimatedHourlyCost": 0.15,
  "entries": [ ... ]
}
```

Entries are limited to the 100 most recent.

```bash
curl -H "X-API-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/admin/providers/costs?since=1711500000000"
```

---

#### GET /admin/providers/health

Get provider health check results.

- **Auth required:** Yes (ADMIN_API_KEY)

**Response `200 OK`:**

```json
{
  "results": { ... },
  "providerStatus": { ... }
}
```

---

## Appendix: Socket.IO Events

The server also exposes a Socket.IO namespace at `/space` for real-time bidirectional communication. See the [Socket.IO documentation](../architecture/socket-events.md) for the full event reference.

**Client to Server events** (validated, rate-limited at 30 events per 10 seconds):

| Event | Payload | Description |
|-------|---------|-------------|
| `xspace:start` | `{ spaceUrl: string }` | Create agent and join a Space |
| `xspace:stop` | - | Stop the agent |
| `xspace:join` | `{ spaceUrl: string }` | Join an additional Space |
| `xspace:leave` | - | Leave the current Space |
| `xspace:2fa` | `{ code: string }` | Submit a 2FA code |
| `xspace:status` | - | Request current status |
| `orchestrator:force-speak` | `{ botId: string }` | Force a specific bot to speak |

**Server to Client events:**

| Event | Description |
|-------|-------------|
| `xSpacesStatus` | Agent status changes |
| `stateUpdate` | Full state snapshot on connect |
| `messageHistory` | Last 50 messages on connect |
| `state:change` | FSM state transitions |
| `textComplete` | Transcription or AI response |
| `audio:level` | Audio level telemetry |
| `audio:webrtc-stats` | WebRTC statistics |
| `turn:decision` | Turn-taking decisions |
| `provider:status` | Provider status updates |
| `provider:cost` | Cost tracking updates |
| `selectors:health` | Selector health updates |
| `circuit:state-change` | Circuit breaker state changes |
| `orchestrator:bot-status` | Multi-agent bot status |
| `orchestrator:speaking` | Which bot is currently speaking |
| `log` | Structured log forwarding |
| `health` | Health snapshot on connect |
| `xSpacesError` | Error messages |
| `personality:changed` | Personality hot-swap notification |


