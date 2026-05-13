# Task 09: API Validation & Standardized Errors

## Context
The Express server needs consistent input validation and error responses across all endpoints. Currently, validation is ad-hoc and error formats vary.

## Requirements

### Error Response Format
Every API error should follow this structure:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      { "field": "spaceUrl", "message": "Must be a valid X Space URL" }
    ],
    "hint": "The Space URL should look like: https://x.com/i/spaces/...",
    "docsUrl": "https://docs.xspace.dev/errors/VALIDATION_ERROR"
  }
}
```

### Error Codes
Define and document these error codes (align with existing `XSpaceError` codes in `packages/core/src/errors.ts`):
- `VALIDATION_ERROR` (400) — request body/params/query failed validation
- `AUTH_REQUIRED` (401) — no API key or token provided
- `AUTH_INVALID` (401) — API key or token is invalid
- `FORBIDDEN` (403) — valid auth but insufficient permissions
- `NOT_FOUND` (404) — resource doesn't exist
- `RATE_LIMITED` (429) — too many requests
- `PROVIDER_ERROR` (502) — upstream provider (OpenAI, etc.) failed
- `INTERNAL_ERROR` (500) — unexpected server error

### Zod Validation
Add Zod schemas for every API endpoint:

```typescript
// Example for agent creation
const CreateAgentSchema = z.object({
  name: z.string().min(1).max(64),
  personality: z.string().max(2000).optional(),
  llmProvider: z.enum(['openai', 'claude', 'groq']),
  ttsProvider: z.enum(['elevenlabs', 'openai', 'browser']).optional(),
  sttProvider: z.enum(['groq', 'openai']).optional(),
  model: z.string().optional(),
  voice: z.string().optional(),
})
```

### Validation Middleware
Create a reusable middleware:
```typescript
function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: result.error.issues.map(i => ({
            field: i.path.join('.'),
            message: i.message
          }))
        }
      })
    }
    req.validated = result.data
    next()
  }
}
```

### Apply to All Routes
Audit every route in the server and add validation:
- `POST /api/agents` — validate body
- `POST /api/agents/:id/join` — validate params (id) and body (spaceUrl)
- `GET /api/agents/:id` — validate params
- `POST /api/auth/verify` — validate body (tokens)
- `POST /api/providers/verify` — validate body (provider, apiKey)
- `POST /api/flows` — validate body
- All other existing routes

### Global Error Handler
Add a catch-all Express error handler:
```typescript
app.use((err, req, res, next) => {
  if (err instanceof XSpaceError) {
    return res.status(err.statusCode || 500).json({ error: { ... } })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', ... } })
  }
  // Log unexpected errors
  logger.error('Unhandled error', { err, path: req.path })
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
})
```

### Request ID
- Generate a unique request ID (`X-Request-ID` header) for every request
- Include in error responses for debugging
- Pass through to provider calls for correlation

## Files to Create
- `src/server/middleware/validate.ts`
- `src/server/middleware/error-handler.ts`
- `src/server/middleware/request-id.ts`
- `src/server/schemas/` — directory with Zod schemas per domain (agents, flows, auth, providers)

## Files to Modify
- `src/server/index.ts` — wire up middleware
- All route files — add validation middleware

## Acceptance Criteria
- [ ] Every POST/PUT endpoint validates its body with Zod
- [ ] Every parameterized route validates params
- [ ] All errors follow the standard format with code, message, details
- [ ] Invalid requests return 400 with clear field-level errors
- [ ] Unexpected errors return 500 with generic message (no stack traces in production)
- [ ] Request ID is present in every response header
- [ ] Zod schemas are exported and can be reused by client code


