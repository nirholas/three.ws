# Prompt: TypeScript Migration

## Why This Matters
TypeScript isn't optional for a professional open-source project in 2026. It's the difference between "I'll try this" and "I trust this." Developers won't adopt a library without types — no autocomplete, no confidence.

## Current State
All JavaScript, no types, no JSDoc. ~15 source files.

## Migration Strategy
Incremental migration — don't rewrite everything at once. Use `allowJs: true` so JS and TS coexist during migration.

## Step 1: Project Setup

```bash
npm install -D typescript @types/node @types/express tsx
npx tsc --init
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowJs": true,
    "checkJs": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "examples"]
}
```

## Step 2: Define Core Types First

Create `src/types.ts` with all the interfaces before migrating any code. This forces you to think about the public API:

```typescript
// === Agent Configuration ===

export interface AgentConfig {
  auth: AuthConfig
  ai: AIConfig
  voice?: VoiceConfig
  browser?: BrowserConfig
  behavior?: BehaviorConfig
}

export interface AuthConfig {
  /** X auth_token cookie value */
  token?: string
  /** X ct0 CSRF token */
  ct0?: string
  /** Username for form-based login */
  username?: string
  /** Password for form-based login */
  password?: string
  /** Email for verification step */
  email?: string
  /** Path to persistent cookie file */
  cookiePath?: string
}

export interface AIConfig {
  provider: 'openai' | 'openai-realtime' | 'claude' | 'groq' | 'custom'
  model?: string
  apiKey?: string
  systemPrompt: string
  maxTokens?: number
  temperature?: number
  maxHistory?: number
  custom?: CustomProvider
}

export interface VoiceConfig {
  provider: 'elevenlabs' | 'openai' | 'browser'
  apiKey?: string
  voiceId?: string
  speed?: number
  stability?: number
}

export interface BrowserConfig {
  headless?: boolean
  executablePath?: string
  userDataDir?: string
  proxy?: string
  args?: string[]
}

export interface BehaviorConfig {
  autoRespond?: boolean
  silenceThreshold?: number
  minSpeechDuration?: number
  maxResponseLength?: number
  turnDelay?: number
}

// === Agent Status ===

export type AgentStatus =
  | 'disconnected'
  | 'launching'
  | 'logged-in'
  | 'joining-space'
  | 'listening'
  | 'speaking'
  | 'error'

// === Messages ===

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp?: Date
  speaker?: string
  agentId?: number
}

// === Events ===

export interface AgentEvents {
  transcription: { speaker: string; text: string; timestamp: Date }
  response: { text: string; audio?: Buffer; agentId: number }
  status: AgentStatus
  error: Error
  'speaker-joined': { username: string }
  'speaker-left': { username: string }
  'space-ended': void
  'audio-chunk': Float32Array
  'turn-granted': { agentId: number }
  'turn-released': { agentId: number }
}

// === Provider Interface ===

export interface LLMProvider {
  readonly type: 'socket' | 'webrtc'
  readonly name: string

  generateResponse(params: {
    messages: Message[]
    systemPrompt: string
    maxTokens?: number
    temperature?: number
  }): Promise<string>

  generateResponseStream?(params: {
    messages: Message[]
    systemPrompt: string
  }): AsyncIterable<string>
}

export interface STTProvider {
  transcribe(audio: Buffer, format?: string): Promise<string>
}

export interface TTSProvider {
  synthesize(text: string, voiceId?: string): Promise<Buffer>
}

// === Custom Provider (user-facing) ===

export interface CustomProvider {
  type: 'socket'
  generateResponse(params: {
    messages: Message[]
    systemPrompt: string
  }): Promise<string>
  generateResponseStream?(params: {
    messages: Message[]
    systemPrompt: string
  }): AsyncIterable<string>
}

// === Middleware ===

export type MiddlewareStage =
  | 'before:stt'
  | 'after:stt'
  | 'before:llm'
  | 'after:llm'
  | 'before:tts'
  | 'after:tts'

export type MiddlewareFn<T = unknown> = (input: T) => T | null | Promise<T | null>

// === Multi-Agent ===

export interface AgentTeamConfig {
  auth: AuthConfig
  agents: Array<{
    name: string
    ai: AIConfig
    voice?: VoiceConfig
    behavior?: BehaviorConfig
  }>
  turnManagement?: {
    strategy: 'queue' | 'round-robin' | 'director'
    turnDelay?: number
  }
}
```

## Step 3: Migration Order

Migrate bottom-up — start with modules that have no internal dependencies:

### Wave 1: Leaf modules (no internal imports)
1. `x-spaces/selectors.js` → `src/browser/selectors.ts`
2. `providers/stt.js` → `src/pipeline/stt.ts`
3. `providers/tts.js` → `src/pipeline/tts.ts`

### Wave 2: Provider implementations
4. `providers/openai-chat.js` → `src/providers/openai.ts`
5. `providers/claude.js` → `src/providers/claude.ts`
6. `providers/groq.js` → `src/providers/groq.ts`
7. `providers/openai-realtime.js` → `src/providers/openai-realtime.ts`
8. `providers/index.js` → `src/providers/index.ts`

### Wave 3: Browser automation
9. `x-spaces/browser.js` → `src/browser/launcher.ts`
10. `x-spaces/auth.js` → `src/browser/auth.ts`
11. `x-spaces/space-ui.js` → `src/browser/space-ui.ts`
12. `x-spaces/audio-bridge.js` → `src/audio/bridge.ts`

### Wave 4: Core orchestration
13. `x-spaces/index.js` → `src/browser/orchestrator.ts`
14. Server state/pipeline → `src/agent.ts` (the main `XSpaceAgent` class)

### Wave 5: Server (last — it's the consumer)
15. `server.js` → `src/server/index.ts`

## Step 4: Build & Development Setup

### package.json scripts
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/server/index.ts",
    "start": "node dist/server/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build"
  }
}
```

### Development with tsx
Use `tsx` for development (runs TypeScript directly, no build step needed):
```bash
npx tsx src/server/index.ts
```

## Step 5: Type-Safe Event Emitter

Replace Node's generic EventEmitter with a typed version:

```typescript
import { EventEmitter } from 'events'

// Typed event emitter wrapper
export class TypedEmitter<Events extends Record<string, unknown>> {
  private emitter = new EventEmitter()

  on<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    this.emitter.on(event as string, listener)
    return this
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): boolean {
    return this.emitter.emit(event as string, data)
  }

  off<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    this.emitter.off(event as string, listener)
    return this
  }
}
```

## Step 6: Strict Null Checks

After migrating, enable `strictNullChecks`. Common patterns to fix:

```typescript
// Before: crashes at runtime if env var missing
const apiKey = process.env.OPENAI_API_KEY

// After: explicit validation
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is required')
```

## New Dependencies
```json
{
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "tsx": "^4.7.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  }
}
```

## Validation
- [ ] `npm run build` compiles with zero errors
- [ ] `npm run typecheck` passes
- [ ] Generated `.d.ts` files provide full autocomplete
- [ ] All provider implementations satisfy `LLMProvider` interface
- [ ] No `any` types in public API (internal `any` is OK during migration)
- [ ] Import autocomplete works when consuming the package
- [ ] `tsx` dev mode works for development


