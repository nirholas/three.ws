# Prompt: REST + WebSocket API Specification

## Why
An API turns this from "a tool" into "infrastructure." People can build dashboards, Discord bots, mobile apps, and monitoring systems on top of it without touching the core code.

## REST API

### Authentication
All protected endpoints require `Authorization: Bearer <ADMIN_TOKEN>` header.

### Endpoints

#### Agent Lifecycle
```
POST   /api/agent/start
  Body: { headless?: boolean }
  Response: { status: 'launching', sessionId: string }

POST   /api/agent/join
  Body: { spaceUrl: string, agents?: AgentConfig[] }
  Response: { status: 'joining', spaceUrl: string }

POST   /api/agent/leave
  Response: { status: 'disconnected' }

POST   /api/agent/stop
  Response: { status: 'stopped' }

GET    /api/agent/status
  Response: {
    status: AgentStatus,
    spaceUrl: string | null,
    agents: Array<{ id: number, name: string, status: string }>,
    uptime: number,
    stats: { messagesProcessed: number, ... }
  }
```

#### Agent Control
```
POST   /api/agent/:id/say
  Body: { text: string }
  Response: { queued: true, position: number }

POST   /api/agent/:id/prompt
  Body: { systemPrompt: string }
  Response: { updated: true }

POST   /api/agent/:id/mute
POST   /api/agent/:id/unmute

GET    /api/agent/:id/history
  Query: ?limit=20&offset=0
  Response: { messages: Message[], total: number }

DELETE /api/agent/:id/history
  Response: { cleared: true }
```

#### Configuration
```
GET    /api/config
  Response: { provider: string, model: string, agents: AgentConfig[] }

PUT    /api/config
  Body: Partial<AgentConfig>
  Response: { updated: true, config: AgentConfig }

GET    /api/providers
  Response: [{ name: 'openai', type: 'socket', models: [...] }, ...]
```

#### Personalities (if personality system is implemented)
```
GET    /api/personalities
GET    /api/personalities/:id
POST   /api/personalities
PUT    /api/personalities/:id
DELETE /api/personalities/:id
POST   /api/agent/:id/personality    Body: { personalityId: string }
```

#### Conversations (if persistence is implemented)
```
GET    /api/conversations             Query: ?limit=10&offset=0&search=crypto
GET    /api/conversations/:id
GET    /api/conversations/:id/transcript
DELETE /api/conversations/:id
GET    /api/conversations/stats
```

#### Health & Metrics
```
GET    /api/health
  Response: {
    status: 'ok' | 'degraded' | 'error',
    uptime: number,
    version: string,
    browser: { status: string, memory: number },
    lastError: string | null
  }

GET    /api/metrics
  Response: {
    stt: { calls: number, avgLatencyMs: number, errors: number },
    llm: { calls: number, avgLatencyMs: number, errors: number, tokensUsed: number },
    tts: { calls: number, avgLatencyMs: number, errors: number },
    audio: { chunksPerSecond: number, vadState: string },
    cost: { today: number, total: number }
  }
```

### Error Format
All errors follow a consistent format:
```json
{
  "error": {
    "code": "SPACE_NOT_FOUND",
    "message": "The specified Space URL is not valid or the Space has ended",
    "details": {}
  }
}
```

Error codes:
- `UNAUTHORIZED` — missing or invalid auth token
- `AGENT_NOT_RUNNING` — agent hasn't been started
- `ALREADY_IN_SPACE` — agent is already in a Space
- `SPACE_NOT_FOUND` — invalid Space URL
- `PROVIDER_ERROR` — AI provider returned an error
- `BROWSER_ERROR` — Puppeteer/browser issue
- `RATE_LIMITED` — too many requests

## WebSocket API (Socket.IO)

### Connection
```javascript
const socket = io('/api', {
  auth: { token: 'your-admin-token' },
  transports: ['websocket']
})
```

### Client → Server Events
```typescript
// Agent control
'agent:start'     → { headless?: boolean }
'agent:join'      → { spaceUrl: string }
'agent:leave'     → {}
'agent:stop'      → {}
'agent:say'       → { agentId: number, text: string }
'agent:2fa'       → { code: string }

// Config
'config:update'   → Partial<AgentConfig>
```

### Server → Client Events
```typescript
// Status updates (real-time)
'agent:status'         → { status: AgentStatus, spaceUrl?: string }
'agent:transcription'  → { speaker: string, text: string, timestamp: string }
'agent:response'       → { agentId: number, text: string, timestamp: string }
'agent:speaking'       → { agentId: number, duration: number }
'agent:error'          → { code: string, message: string }

// Auth flow
'agent:2fa-required'   → {}
'agent:login-success'  → { username: string }

// Metrics (every 5s if subscribed)
'metrics'              → MetricsSnapshot

// Space events
'space:speaker-joined' → { username: string }
'space:speaker-left'   → { username: string }
'space:ended'          → {}
```

### Subscription Model
Clients can subscribe to specific event categories to reduce noise:
```javascript
socket.emit('subscribe', ['transcription', 'metrics', 'errors'])
// Now only receives those event categories
```

## OpenAPI / Swagger

Generate OpenAPI 3.0 spec so people can auto-generate clients:

```yaml
openapi: 3.0.3
info:
  title: X Space Agent API
  version: 1.0.0
  description: Control AI agents in X/Twitter Spaces
servers:
  - url: http://localhost:3000
paths:
  /api/agent/join:
    post:
      summary: Join an X Space
      security:
        - bearerAuth: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [spaceUrl]
              properties:
                spaceUrl:
                  type: string
                  example: "https://x.com/i/spaces/1abc..."
      responses:
        '200':
          description: Joining Space
        '401':
          description: Unauthorized
```

Serve the spec at `GET /api/docs` using swagger-ui-express:
```typescript
import swaggerUi from 'swagger-ui-express'
import spec from './openapi.json'

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec))
```

## SDK Client (auto-generated or hand-written)

Provide a lightweight client for programmatic API access:

```typescript
// Published as @xspace/client or included in main package
import { XSpaceClient } from 'xspace-agent/client'

const client = new XSpaceClient({
  baseUrl: 'http://localhost:3000',
  token: 'your-admin-token'
})

await client.join('https://x.com/i/spaces/1abc...')

client.on('transcription', ({ speaker, text }) => {
  console.log(`${speaker}: ${text}`)
})

const status = await client.getStatus()
const metrics = await client.getMetrics()
```

This is useful for:
- Discord bots that control the agent
- Monitoring dashboards
- Mobile apps
- CI/CD pipelines (automated Space joining)

## Implementation Steps
1. Define route handlers in `src/server/routes.ts`
2. Add auth middleware
3. Add consistent error handling
4. Implement all REST endpoints
5. Refactor Socket.IO events to match spec
6. Generate OpenAPI spec
7. Add swagger-ui at /api/docs
8. Write API client class
9. Add rate limiting per endpoint

## Validation
- [ ] All REST endpoints return correct responses
- [ ] Auth middleware rejects invalid tokens
- [ ] Error responses follow consistent format
- [ ] Socket.IO events match documented spec
- [ ] OpenAPI spec is valid (swagger-ui renders correctly)
- [ ] API client can control agent programmatically
- [ ] Rate limiting prevents abuse


