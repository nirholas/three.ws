# Prompt: Testing & CI/CD Pipeline

## Why
No tests = no trust. Contributors won't submit PRs to an untested project. CI catches regressions before they ship.

## Testing Strategy

### What to Test

**Unit tests** (fast, no network, no browser):
- Provider message formatting
- Config resolution and validation
- Turn management queue logic
- Audio PCM utilities
- Middleware pipeline execution
- Type validation

**Integration tests** (mocked external services):
- STT/LLM/TTS pipeline with mock API responses
- Auth strategy selection
- Config file loading
- API endpoint responses
- Socket.IO event handling

**E2E tests** (full browser, real APIs — run manually or in CI with secrets):
- Browser launch and X login
- Space join flow
- Audio capture and injection
- Full transcription → response cycle

### Test Structure
```
packages/core/
├── src/
│   └── ...
├── tests/
│   ├── unit/
│   │   ├── providers/
│   │   │   ├── openai.test.ts
│   │   │   ├── claude.test.ts
│   │   │   └── groq.test.ts
│   │   ├── audio/
│   │   │   ├── vad.test.ts
│   │   │   └── pcm.test.ts
│   │   ├── pipeline/
│   │   │   └── middleware.test.ts
│   │   ├── config.test.ts
│   │   └── turn-manager.test.ts
│   ├── integration/
│   │   ├── pipeline.test.ts        ← STT → LLM → TTS with mocked APIs
│   │   ├── api-endpoints.test.ts
│   │   └── socket-events.test.ts
│   └── e2e/
│       ├── browser-launch.test.ts
│       └── space-join.test.ts
│
├── __mocks__/
│   ├── openai.ts                   ← Mock OpenAI client
│   └── puppeteer.ts                ← Mock Puppeteer
│
└── vitest.config.ts
```

### Test Framework: Vitest
Fast, TypeScript-native, compatible with Jest API:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts']
    },
    testTimeout: 10000
  }
})
```

### Example Tests

#### Unit: Provider message formatting
```typescript
// tests/unit/providers/openai.test.ts
import { describe, it, expect, vi } from 'vitest'
import { OpenAIProvider } from '../../../src/providers/openai'

describe('OpenAIProvider', () => {
  it('should format messages correctly', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Hello!' } }]
    })

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      client: { chat: { completions: { create: mockCreate } } }
    })

    const result = await provider.generateResponse({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'You are helpful.'
    })

    expect(result).toBe('Hello!')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' }
      ]
    }))
  })

  it('should respect maxHistory', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test', model: 'gpt-4o-mini' })
    // Add 30 messages to history
    for (let i = 0; i < 30; i++) {
      provider.addToHistory({ role: 'user', content: `msg ${i}` })
    }
    // Should only keep last 20
    expect(provider.getHistory().length).toBe(20)
  })
})
```

#### Unit: Turn manager
```typescript
// tests/unit/turn-manager.test.ts
import { describe, it, expect } from 'vitest'
import { TurnManager } from '../../src/pipeline/turn-manager'

describe('TurnManager', () => {
  it('should grant turn to first requester', () => {
    const tm = new TurnManager()
    const granted = tm.requestTurn(0)
    expect(granted).toBe(true)
    expect(tm.currentTurn).toBe(0)
  })

  it('should queue subsequent requests', () => {
    const tm = new TurnManager()
    tm.requestTurn(0)
    const granted = tm.requestTurn(1)
    expect(granted).toBe(false)
    expect(tm.queueDepth).toBe(1)
  })

  it('should grant next in queue on release', () => {
    const tm = new TurnManager()
    tm.requestTurn(0)
    tm.requestTurn(1)
    tm.releaseTurn(0)
    expect(tm.currentTurn).toBe(1)
  })
})
```

#### Unit: PCM audio utilities
```typescript
// tests/unit/audio/pcm.test.ts
import { describe, it, expect } from 'vitest'
import { pcmToFloat32, float32ToPcm, calculateAmplitude } from '../../src/audio/pcm'

describe('PCM utilities', () => {
  it('should convert PCM int16 to float32', () => {
    const pcm = Buffer.from([0x00, 0x40]) // 16384 in int16
    const float = pcmToFloat32(pcm)
    expect(float[0]).toBeCloseTo(0.5, 1)
  })

  it('should detect silence', () => {
    const silence = new Float32Array(1024).fill(0)
    expect(calculateAmplitude(silence)).toBe(0)
  })

  it('should detect speech', () => {
    const speech = new Float32Array(1024).fill(0.5)
    expect(calculateAmplitude(speech)).toBeGreaterThan(0.1)
  })
})
```

#### Integration: API endpoints
```typescript
// tests/integration/api-endpoints.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/server'

describe('API Endpoints', () => {
  let app: Express.Application

  beforeAll(() => {
    app = createApp({ adminToken: 'test-token' })
  })

  it('GET /api/health returns status', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('POST /api/agent/join requires auth', async () => {
    const res = await request(app)
      .post('/api/agent/join')
      .send({ spaceUrl: 'https://x.com/i/spaces/test' })
    expect(res.status).toBe(401)
  })

  it('POST /api/agent/join works with auth', async () => {
    const res = await request(app)
      .post('/api/agent/join')
      .set('Authorization', 'Bearer test-token')
      .send({ spaceUrl: 'https://x.com/i/spaces/test' })
    expect(res.status).toBe(200)
  })
})
```

## CI/CD Pipeline: GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm test
      - uses: codecov/codecov-action@v3
        with:
          files: packages/core/coverage/lcov.info

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm build
      - run: pnpm pack --pack-destination ./artifacts
      - uses: actions/upload-artifact@v4
        with:
          name: package
          path: ./artifacts/*.tgz

  # Only runs on main branch pushes with NPM_TOKEN secret
  publish:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [build]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: pnpm install
      - run: pnpm build
      - run: pnpm publish --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## New Dependencies
```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "supertest": "^6.3.0",
    "@types/supertest": "^6.0.0"
  }
}
```

## Package.json Scripts
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run tests/e2e/",
    "lint": "eslint src/ tests/",
    "typecheck": "tsc --noEmit",
    "ci": "pnpm lint && pnpm typecheck && pnpm test"
  }
}
```

## Implementation Steps
1. Install Vitest and configure
2. Write unit tests for providers (mock API clients)
3. Write unit tests for turn manager and PCM utils
4. Write integration tests for API endpoints (supertest)
5. Set up GitHub Actions CI pipeline
6. Add code coverage reporting
7. Add badge to README
8. (Later) Add E2E tests for browser flows

## Validation
- [ ] `pnpm test` passes all unit + integration tests
- [ ] Code coverage > 60% on core modules
- [ ] CI pipeline runs on every PR
- [ ] TypeScript type check is part of CI
- [ ] Linting catches issues before commit
- [ ] Build artifacts are produced successfully
- [ ] Tests run in < 30 seconds (fast feedback)


