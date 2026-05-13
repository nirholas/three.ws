# Task 12: Structured Logging

## Context
The codebase uses `console.log` throughout. For production, we need structured JSON logging with levels, context, and correlation IDs.

## Requirements

### Logger Setup
Use **pino** (fastest Node.js logger, JSON output):
```typescript
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: { service: 'xspace-agent', version: pkg.version },
})
```

### Log Levels
- `fatal` — process is crashing
- `error` — operation failed, needs attention
- `warn` — degraded behavior but still working
- `info` — significant events (agent joined, space left, provider switched)
- `debug` — detailed flow information
- `trace` — very verbose (audio levels, every Socket.IO event)

### What to Log

**Always log (info)**:
- Server start/stop with port and config summary
- Agent lifecycle transitions (idle → joining → listening → speaking)
- Space join/leave events
- Provider health check results
- Auth attempts (success/failure, no secrets in logs)
- Rate limit triggers

**Log on error**:
- Provider failures with error code and latency
- Browser automation failures with selector info
- WebSocket disconnections with reason
- Unhandled rejections and uncaught exceptions

**Log on debug**:
- Every API request (method, path, status, duration)
- Socket.IO events (event name, namespace)
- LLM prompt/response metadata (token count, latency — NOT the content)
- TTS/STT operation metadata

**Never log**:
- API keys, auth tokens, passwords
- Full LLM prompts or responses (may contain user data)
- Audio data
- PII from X users (speaker names should be pseudonymized in logs)

### Request Logging
Add request logging middleware:
```typescript
app.use((req, res, next) => {
  const start = Date.now()
  const requestId = req.headers['x-request-id'] || uuid()
  req.log = logger.child({ requestId, method: req.method, path: req.path })

  res.on('finish', () => {
    req.log.info({
      status: res.statusCode,
      duration: Date.now() - start,
      contentLength: res.getHeader('content-length')
    }, 'request completed')
  })

  next()
})
```

### Child Loggers
Create child loggers with context for each domain:
```typescript
const agentLogger = logger.child({ component: 'agent' })
const browserLogger = logger.child({ component: 'browser' })
const audioLogger = logger.child({ component: 'audio' })
const providerLogger = logger.child({ component: 'provider' })
```

### Migration
- Replace ALL `console.log` with appropriate `logger.info`
- Replace ALL `console.error` with `logger.error`
- Replace ALL `console.warn` with `logger.warn`
- Remove ALL `console.debug` or convert to `logger.debug`
- Search for `console.` across the entire codebase

### Log Rotation (production)
Document how to set up log rotation:
- Using `pino-roll` for file-based rotation
- Or piping to `pino-pretty` / `pino-elasticsearch` / `pino-datadog`
- Docker: just log to stdout (container runtime handles rotation)

## Dependencies to Add
- `pino`
- `pino-pretty` (dev dependency)
- `pino-http` (optional, for Express integration)

## Files to Create
- `src/server/logger.ts` — logger instance and child logger factories

## Files to Modify
- `src/server/index.ts` — replace console.log, add request logging
- Every file in `src/` that uses `console.log/error/warn`
- `package.json` — add pino dependencies

## Acceptance Criteria
- [ ] Zero `console.log` statements remain in `src/` (except in client-side JS)
- [ ] All logs are structured JSON in production
- [ ] Pretty-printed colored logs in development
- [ ] Request ID present in every log entry within a request lifecycle
- [ ] No secrets or sensitive data in any log output
- [ ] Log level configurable via `LOG_LEVEL` env var
- [ ] Agent lifecycle events logged at info level
- [ ] Provider errors logged with error code, latency, provider name


