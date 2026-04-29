# Task 11: Rate Limiting & Security Hardening

## Context
The server needs protection against abuse, especially since it exposes endpoints that trigger expensive AI provider calls.

## Requirements

### Rate Limiting
Use `express-rate-limit` (already in typical Express projects, add if missing):

**Global rate limit**: 100 requests per minute per IP
```typescript
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests', hint: 'Wait 60 seconds' } }
})
```

**Strict limits for expensive operations**:
- `POST /api/agents/*/join` — 5 per minute (triggers browser + AI)
- `POST /api/providers/verify` — 10 per minute (makes API calls)
- `POST /api/flows/*/test` — 10 per minute (runs AI pipeline)
- User chat messages via Socket.IO — 12 per minute (already has 5s cooldown in UI)

**Auth endpoint limits**:
- `POST /api/auth/verify` — 5 per minute (prevent brute force)
- Login attempts — 5 per 15 minutes per IP

### Socket.IO Rate Limiting
- Implement custom rate limiting for Socket.IO events
- Track message count per socket per minute
- Disconnect sockets that exceed limits with a warning message
- Log rate-limited connections

### Input Sanitization
- Sanitize all user-provided strings that might be rendered in HTML (XSS prevention)
- Use a library like `xss` or `sanitize-html` for message content
- Strip any HTML tags from chat messages
- Validate URL inputs against a strict pattern (X Space URLs only for space join)
- Limit request body size: `express.json({ limit: '1mb' })`
- Limit URL-encoded body size: `express.urlencoded({ limit: '1mb' })`

### SQL/NoSQL Injection
- While the project uses file-based persistence, still validate:
  - No path traversal in file-based operations (`../` in filenames)
  - Flow IDs and agent IDs are alphanumeric only
  - No command injection in any string passed to shell operations

### Dependency Security
- Add `npm audit` to the CI pipeline (already in `.github/workflows/ci.yml` — verify it's active)
- Add a `npm run security` script that runs `npm audit --audit-level=high`
- Pin all dependencies to exact versions in `package-lock.json`

### Secrets Management
- Ensure `.env` is in `.gitignore` (verify)
- Add `.env.local` to `.gitignore`
- Scan codebase for any hardcoded secrets (API keys, tokens)
- Add a pre-commit hook (via husky) that checks for common secret patterns in staged files
- Document all required secrets in `.env.example` with placeholder values

### Error Information Leakage
- In production (`NODE_ENV=production`):
  - Never return stack traces in API responses
  - Never return internal file paths
  - Generic error messages for 500s
- In development:
  - Stack traces in responses are OK
  - More verbose error messages

## Files to Create
- `src/server/middleware/rate-limit.ts`
- `src/server/middleware/sanitize.ts`
- `src/server/utils/security.ts` — validation helpers

## Files to Modify
- `src/server/index.ts` — wire up middleware
- `package.json` — add security script
- `.gitignore` — verify .env entries

## Acceptance Criteria
- [ ] Global rate limit returns 429 with Retry-After header when exceeded
- [ ] Expensive endpoints have stricter limits
- [ ] Socket.IO messages are rate-limited
- [ ] HTML in chat messages is stripped/escaped
- [ ] No path traversal possible in file operations
- [ ] Request body size is limited
- [ ] No secrets in codebase (run a scan)
- [ ] Production mode hides stack traces and internal paths
- [ ] `npm run security` exits cleanly or reports known issues


