# three.ws

**Give your AI a body.** three.ws is an open-source, browser-native 3D AI agent platform. Drop a GLB file, add an LLM brain, register on-chain, and embed anywhere — no plugins, no server uploads, no installs required.

<video width="100%" height="auto" autoplay loop muted playsinline>
  <source src="https://github.com/nirholas/3D-Agent/raw/refs/heads/main/public/skills.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

---

## Table of Contents

- [What is three.ws?](#what-is-threews)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [The Agent System](#the-agent-system)
  - [Event Bus (Agent Protocol)](#event-bus-agent-protocol)
  - [LLM Runtime](#llm-runtime)
  - [Empathy Layer](#empathy-layer)
  - [Skills](#skills)
  - [Memory](#memory)
- [Web Component & Embedding](#web-component--embedding)
- [Widget System](#widget-system)
- [API Reference](#api-reference)
- [Authentication & OAuth 2.1](#authentication--oauth-21)
- [MCP Server](#mcp-server)
- [On-Chain Identity (ERC-8004)](#on-chain-identity-erc-8004)
- [Database Schema](#database-schema)
- [Build & Deployment](#build--deployment)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## What is three.ws?

three.ws is a full-stack system for creating, deploying, and embedding 3D AI agents. It combines a WebGL model viewer, an LLM-driven agent runtime, on-chain identity contracts, and a distributable web component into one cohesive platform.

At its core, it does four things:

1. **Render** — loads and validates glTF 2.0 / GLB models in WebGL 2.0 with zero server-side processing. Drag a file onto the browser and it renders instantly with full Draco, KTX2, and Meshopt decompression.

2. **Embody** — wraps any avatar with an LLM brain. The agent listens to the user, thinks with Claude, executes tools (animations, gestures, memory operations, skill calls), and expresses emotion through morph-target blending on the 3D model in real time.

3. **Register** — optionally mints the agent as an ERC-8004 token on any EVM chain, giving it a stable on-chain identity, a wallet address, signed action history, and a reputation score that cannot be forged.

4. **Embed** — distributes the agent as an `<agent-3d>` web component that anyone can drop into a page, or as one of five purpose-built widget types (turntable, animation gallery, talking agent, passport card, hotspot tour) with Open Graph and oEmbed support built in.

The backend is a set of Vercel serverless functions backed by Neon Postgres for metadata, Cloudflare R2 for model storage, and Upstash Redis for rate limiting. It exposes a full OAuth 2.1 authorization server and an MCP (Model Context Protocol) endpoint so external AI systems can drive avatars programmatically.

three.ws is production-ready and serves [three.ws](https://three.ws) live. The entire stack — viewer, agent runtime, contracts, backend, and web component — is open source under Apache 2.0.

---

## Key Features

**3D Viewer**
- WebGL 2.0 rendering via three.js r176
- glTF 2.0 and GLB with Draco geometry compression, KTX2 texture compression, and Meshopt mesh optimization
- Khronos-spec glTF validation with line-level error reporting
- HDR environment maps, PBR materials, skinned mesh animations, morph targets, and embedded cameras
- OrbitControls (pan, zoom, rotate) with configurable auto-rotation
- Real-time parameter tweaking (lights, exposure, morph weights) via dat.GUI

**Agent Runtime**
- LLM brain powered by Claude (Anthropic API) with a structured tool-loop architecture
- Up to 8 tool iterations per turn before returning final output
- Built-in tools: `wave`, `lookAt`, `play_clip`, `setExpression`, `speak`, `remember`
- Composable skill system — install skills from IPFS, Arweave, or HTTP; each skill is a self-contained bundle with a description, tool definitions, and async handlers
- Weighted emotion blending (celebration, concern, curiosity, empathy, patience) driven by protocol events, not a finite-state machine
- Web Speech API for STT/TTS out of the box; ElevenLabs integration for production-quality voice

**Identity & On-Chain**
- ERC-8004 smart contracts (IdentityRegistry, ReputationRegistry, ValidationRegistry) deployable on any EVM chain
- Each agent is an ERC-721 token with a stable `agentId`, owner wallet, delegated signer (EIP-712), and IPFS-pinned manifest
- Signed action log — every `speak`, `remember`, `skill-done`, and `validate` event is recorded on-chain-optionally or in the database with a cryptographic signature
- EIP-7710 delegated permissions for composable agent-to-agent authorization
- Solana support (SIWS sign-in, Solana wallet linking, Metaplex NFT option)

**Embedding & Distribution**
- `<agent-3d>` custom element — drop it anywhere with no framework dependency
- Five widget variants: turntable, animation gallery, talking agent, ERC-8004 passport card, hotspot tour
- Widget Studio — point-and-click embed code generator
- Open Graph metadata and oEmbed support for rich social previews when links are shared
- Versioned CDN bundles at `/agent-3d/x.y.z/agent-3d.js`

**Backend & Integrations**
- OAuth 2.1 server (RFC 6749 + PKCE, RFC 7591 dynamic registration, RFC 7009 revocation, RFC 7662 introspection, RFC 8414 discovery)
- Developer API keys with scope and expiry
- MCP (Model Context Protocol) over HTTP with JSON-RPC 2.0 for tool-calling from external AI systems
- Ready Player Me, Avaturn (photo-to-avatar), and Privy (embedded wallet) integrations
- DCA strategy execution and on-chain subscription scheduling via cron jobs
- OpenAPI 3.1 spec generated at `/openapi.json`

---

## Architecture

The platform is organized into four layers. All layers communicate through a single event bus (`agent-protocol`) rather than direct calls.

```
┌────────────────────────────────────────────────────────────┐
│  Layer 4: Embed & Distribution                             │
│  <agent-3d> web component · CDN library · 5 widget types  │
│  Widget Studio · oEmbed · Open Graph cards                 │
└────────────────────────────────────────────────────────────┘
                            ↓ protocol events
┌────────────────────────────────────────────────────────────┐
│  Layer 3: Identity & Persistence                           │
│  Agent passport · ERC-8004 on-chain registry              │
│  Signed action log · Memory store · Wallet linking        │
└────────────────────────────────────────────────────────────┘
                            ↓ protocol events
┌────────────────────────────────────────────────────────────┐
│  Layer 2: Agent Runtime                                    │
│  LLM tool-loop · Built-in tools · Skill registry          │
│  Empathy Layer (emotion blending) · TTS/STT               │
└────────────────────────────────────────────────────────────┘
                            ↓ protocol events
┌────────────────────────────────────────────────────────────┐
│  Layer 1: Viewer                                           │
│  three.js r176 · glTF / GLB · Draco / KTX2 / Meshopt     │
│  Animations · Morph targets · HDR · Validation            │
└────────────────────────────────────────────────────────────┘
```

The event bus decouples every component. The avatar emotion system reacts to `speak` events without knowing the runtime exists. The identity module records actions without knowing the UI exists. This makes the system testable, embeddable in isolation, and composable across pages.

The backend is stateless serverless functions. All persistent state lives in Postgres (Neon), object storage (Cloudflare R2), or on-chain. Cron jobs handle scheduled blockchain operations (ERC-8004 crawl, DCA execution, subscription execution).

---

## Tech Stack

**Frontend**
| Technology | Version | Purpose |
|---|---|---|
| three.js | r176 | WebGL 2.0 rendering |
| Vite | 7.3.2 | Build tooling + HMR |
| Vitest | 4.1.4 | Unit testing |
| viem | 2.18.0 | Ethereum wallet + SIWE |
| ethers | 6.16.0 | Contract interaction |
| @solana/web3.js | 1.98.4 | Solana RPC + signing |
| jose | 5.9.6 | JWT handling |
| zod | 3.23.8 | Schema validation |
| gltf-validator | 2.0.0-dev.3.10 | Khronos spec compliance |
| dat.gui | 0.7.9 | Real-time parameter UI |
| simple-dropzone | 0.8.3 | Drag-and-drop file handling |
| vhtml | 2.2.0 | JSX → HTML string rendering |

**Backend (Vercel serverless)**
| Technology | Purpose |
|---|---|
| Neon Postgres | Primary database |
| Cloudflare R2 | Avatar / model object storage |
| Upstash Redis | Rate limiting |
| Anthropic SDK | Claude LLM (claude-sonnet-4-6 / claude-opus-4-7) |
| Resend | Transactional email |
| Sentry | Error monitoring |
| @aws-sdk/client-s3 | R2 presigned upload URLs |

**Smart Contracts**
| Technology | Purpose |
|---|---|
| Solidity 0.8+ | ERC-8004 contracts |
| Foundry | Compile, test, deploy |
| ERC-721 | Agent token standard |
| EIP-712 | Typed structured signing |
| EIP-7710 | Delegated permissions |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- A Neon Postgres database (or any Postgres 15+)
- A Cloudflare R2 bucket (or any S3-compatible store)
- An Anthropic API key (for the LLM backend)

### Installation

```bash
git clone https://github.com/nirholas/3D-Agent.git
cd 3D-Agent
npm install
```

### Environment Setup

Copy the example env file and fill in required values:

```bash
cp .env.example .env.local
```

At minimum, set:

```env
PUBLIC_APP_ORIGIN=http://localhost:3000
DATABASE_URL=postgres://user:pass@host/db
JWT_SECRET=<run: openssl rand -base64 64>
ANTHROPIC_API_KEY=sk-ant-...
```

See [Environment Variables](#environment-variables) for the full reference.

### Initialize the Database

The schema is idempotent — run it against your Postgres instance to create all tables:

```bash
psql $DATABASE_URL < api/_lib/schema.sql
```

### Start the Dev Server

```bash
npm run dev
```

Opens at `http://localhost:3000`. The viewer is at `/app`, the dashboard at `/home`, and the agent creation flow at `/create`.

### Quick Viewer Test

Navigate to `http://localhost:3000/app` and drag any GLB file onto the canvas. The model loads instantly with PBR materials, animations, and full glTF validation.

To try the agent, navigate to `/create`, upload a GLB, and configure a brain (requires `ANTHROPIC_API_KEY` in your env).

---

## Project Structure

```
3D-Agent/
├── index.html                  # Marketing landing page
├── app.html                    # Main viewer (drag-and-drop + deploy mode)
├── home.html                   # Authenticated dashboard
├── create.html                 # Avatar + agent creation wizard
├── agent-home.html             # Agent detail & action timeline
├── agent-edit.html             # Agent editing UI
├── agent-embed.html            # Chromeless embed variant
├── a-embed.html                # On-chain agent embed
│
├── src/                        # Frontend JavaScript (~80 modules, ~15k lines)
│   ├── viewer.js               # three.js renderer core (1,534 lines)
│   ├── app.js                  # SPA entry + URL routing (460 lines)
│   ├── agent-protocol.js       # Event bus (200-action ring buffer)
│   ├── agent-avatar.js         # Empathy Layer (morph targets, emotion) (694 lines)
│   ├── agent-identity.js       # Passport, diary, signed action history
│   ├── element.js              # <agent-3d> custom element
│   ├── runtime/
│   │   ├── index.js            # LLM tool-loop engine
│   │   ├── providers.js        # AnthropicProvider, NullProvider
│   │   ├── scene.js            # SceneController bridge to three.js
│   │   ├── tools.js            # Built-in tools (wave, speak, remember...)
│   │   └── speech.js          # TTS + STT
│   ├── memory/
│   │   └── index.js            # File-based memory (local/ipfs/encrypted-ipfs/none)
│   ├── skills/
│   │   ├── index.js            # SkillRegistry
│   │   └── <name>/             # Bundled skills (SKILL.md, tools.json, handlers.js)
│   ├── erc8004/
│   │   ├── abi.js              # Contract ABIs + deployment addresses
│   │   ├── agent-registry.js   # connectWallet, registerAgent, pinToIPFS
│   │   └── reputation.js       # submitFeedback, getReputation
│   └── widgets/                # Five widget type implementations
│
├── api/                        # Vercel serverless functions (~153 endpoints, ~3.6k lines)
│   ├── agents.js               # Agent CRUD (321 lines)
│   ├── chat.js                 # LLM chat endpoint (298 lines)
│   ├── mcp.js                  # MCP server over HTTP (759 lines)
│   ├── agent-actions.js        # Record signed actions (122 lines)
│   ├── agent-memory.js         # Memory CRUD + recall (188 lines)
│   ├── auth/                   # Login, register, SIWE, Privy, sessions
│   ├── oauth/                  # OAuth 2.1 server (authorize, token, register...)
│   ├── avatars/                # Avatar CRUD + presigned upload
│   ├── widgets/                # Widget CRUD + OG + oEmbed
│   ├── erc8004/                # Blockchain hydrate, import, pin
│   ├── cron/                   # Scheduled jobs (crawl, DCA, subscriptions)
│   └── _lib/                   # Shared helpers (db, auth, r2, validate, email...)
│       └── schema.sql          # Idempotent Postgres migrations
│
├── public/                     # Static subapps + assets
│   ├── studio/                 # Widget Studio SPA
│   ├── dashboard/              # User dashboard SPA
│   ├── validation/             # glTF validator tool
│   ├── discover/               # Agent discovery SPA
│   └── animations/             # Animation clip library
│
├── contracts/                  # Foundry + Solidity (ERC-8004)
│   ├── src/
│   │   ├── IdentityRegistry.sol    # ERC-721 agent tokens (EIP-712)
│   │   ├── ReputationRegistry.sol  # Signed reviewer feedback
│   │   └── ValidationRegistry.sol  # Validator attestations
│   ├── script/Deploy.s.sol
│   ├── test/IdentityRegistry.test.sol
│   └── DEPLOYMENTS.md          # Chain deployment addresses
│
├── docs/                       # Architecture, API, deployment guides
├── specs/                      # Formal specs (manifest, embed, skill, memory...)
├── tests/                      # Vitest test suite (~30 files)
├── scripts/                    # Build tools (publish, icon gen, animations)
│
├── vite.config.js              # App build config
├── vite.config.artifact.js     # Standalone artifact bundle
├── vercel.json                 # Routes, rewrites, crons, headers
└── package.json                # Scripts + dependencies
```

---

## The Agent System

### Event Bus (Agent Protocol)

`src/agent-protocol.js` implements a lightweight `EventTarget` subclass that is the nervous system of the platform. Every component — avatar, runtime, identity, UI — communicates exclusively through this bus. There are no direct method calls between layers.

The bus maintains a 200-action ring buffer for debugging and replay. Embed variants expose a filtered subset of events through `postMessage` to the host page.

**Core event types:**

| Event | Payload | Who emits | Who listens |
|---|---|---|---|
| `speak` | `{ text, sentiment: -1..1 }` | runtime, skills | avatar (emotion), identity (log), chat UI |
| `think` | `{ thought }` | runtime | home (timeline), avatar |
| `gesture` | `{ name, duration }` | avatar, skills | avatar (one-shot clip) |
| `emote` | `{ trigger, weight: 0..1 }` | avatar | avatar (emotion inject) |
| `look-at` | `{ target: 'user'\|'camera'\|'center' }` | skills | scene controller |
| `perform-skill` | `{ skill, args, animationHint }` | runtime | skill registry |
| `skill-done` | `{ skill, result }` | skills | avatar, identity |
| `skill-error` | `{ skill, error }` | skills | avatar, identity |
| `remember` | `{ type, content, ... }` | skills, runtime | memory, identity |
| `load-start` / `load-end` | `{ uri, error? }` | viewer | avatar (emotion) |
| `validate` | `{ errors, warnings }` | validator | avatar, identity |
| `presence` | `{ state }` | element | home UI |

Identity-relevant events (`speak`, `remember`, `sign`, `skill-done`, `validate`, `load-end`) are fire-and-forwarded to `POST /api/agent-actions` for durable logging.

### LLM Runtime

`src/runtime/index.js` implements the `Runtime` class, which drives the agent's LLM-powered brain.

**Tool-loop flow:**

1. User message (text or STT transcript) arrives
2. System prompt is assembled: manifest instructions + recalled memory + skill descriptions
3. Claude is called with the conversation history and all available tools
4. Tool calls are dispatched in order — each built-in tool or skill handler receives a rich context object:
   ```js
   { viewer, memory, llm, speak, listen, fetch, loadGLB, loadClip, loadJSON, call, stage, agentId }
   ```
5. Tool results are appended to conversation history as `tool_result` messages
6. Steps 3–5 repeat until Claude returns with no tool calls, or the iteration limit (8) is hit
7. Final text response is optionally spoken via TTS

**Providers** (`src/runtime/providers.js`):
- `AnthropicProvider` — connects to the Anthropic API, supports streaming
- `NullProvider` — no-op for testing and offline mode

**Built-in tools** (`src/runtime/tools.js`):

| Tool | Description |
|---|---|
| `wave` | Play a wave gesture animation |
| `lookAt` | Direct the agent's gaze (user, camera, or scene center) |
| `play_clip` | Play a named animation clip from the model or animation library |
| `setExpression` | Set a named morph target weight directly |
| `speak` | Emit text through TTS and the protocol bus |
| `remember` | Write a memory entry (user, feedback, project, or reference type) |

Skills can define additional tools that override or augment the built-ins. The skill registry is loaded from the agent manifest before each conversation turn.

### Empathy Layer

`src/agent-avatar.js` implements the Empathy Layer — a continuous weighted emotion blend that drives the avatar's facial morph targets and head orientation in real time.

Emotions are not a finite-state machine. Each emotion is a float (0..1) that decays linearly per frame at a different rate. Protocol events inject spikes:

| Trigger | Emotion | Spike |
|---|---|---|
| `speak` (positive sentiment) | celebration | +0.7 |
| `speak` (negative sentiment) | concern | +0.5 |
| `skill-error` | concern + empathy | +0.6 / +0.5 |
| `load-start` | patience + curiosity | +0.4 / +0.3 |
| `validate` (clean) | celebration | +0.5 |
| `validate` (errors) | concern | +0.6 |

Decay half-lives (approximate):
- Patience: ~20s — persists during long operations
- Empathy: ~13s — lingers after emotional events
- Concern: ~12s — sustained worry
- Curiosity: ~8s — alert, fades moderately
- Celebration: ~6s — brief, upbeat

The blended emotion mix drives morph target values each frame. For example:
- Celebration → `mouthSmile 0.85`, `mouthOpen 0.2`
- Concern → `mouthFrown 0.55`, `browInnerUp 0.6`
- Empathy → `eyeSquint 0.4`, `browInnerUp 0.5`

Head tilt and lean are also driven by the blend — curiosity tilts the head, patience leans slightly back.

This architecture means the avatar feels responsive and emotionally coherent without any hand-authored animation triggers.

### Skills

Skills are self-contained capability bundles that extend the agent's tool set. Each skill lives in its own directory:

```
skills/wave/
├── SKILL.md        # Human-readable description and usage instructions
├── tools.json      # Tool definitions (name, description, input JSON schema)
└── handlers.js     # Async handler functions (default export)
```

**tools.json example:**
```json
[
  {
    "name": "wave",
    "description": "Plays a waving gesture on the avatar for the specified duration.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "duration_ms": { "type": "integer", "minimum": 500, "maximum": 5000 }
      }
    }
  }
]
```

**handlers.js example:**
```js
export default {
  async wave(args, ctx) {
    const { viewer, speak } = ctx;
    await viewer.playClipByName('wave');
    return { ok: true, output: 'Waved!' };
  }
};
```

Skills are loaded from the agent manifest at runtime. The `SkillRegistry` supports three trust modes:
- `any` — install skills from any source (development only)
- `owned-only` — only skills the agent owner has registered
- `whitelist` — only approved skill URIs

Skills are distributed over IPFS, Arweave, or HTTP. The public skills registry is at `/public/skills-index.json`.

### Memory

`src/memory/index.js` implements a file-based memory system (mirroring this project's own Claude memory system). Memories are Markdown files with YAML frontmatter, organized by type:

```markdown
---
type: user
key: user_role
name: User's Role
created: 2024-01-15T10:30:00Z
salience: 0.95
---

User is a game developer interested in character animation.
```

A `MEMORY.md` index file is auto-maintained. At the start of each conversation turn, the memory store is scanned and high-salience entries are injected into the system prompt.

**Storage modes:**
- `local` — stored in the browser's local storage (default for development)
- `ipfs` — pinned to IPFS via Pinata or Web3.Storage
- `encrypted-ipfs` — encrypted before pinning (user holds the key)
- `none` — stateless, no memory between sessions

Memory types (`user`, `feedback`, `project`, `reference`) follow the same taxonomy used by this codebase's own Claude guidelines.

---

## Web Component & Embedding

The `<agent-3d>` custom element (`src/element.js`) is the primary distribution mechanism. It lazy-boots on intersection (IntersectionObserver), so off-screen agents don't load until visible.

**Basic usage:**
```html
<script src="https://three.ws/agent-3d/latest/agent-3d.js"></script>

<agent-3d
  body="https://example.com/my-avatar.glb"
  brain="https://example.com/manifest.json"
  mode="chat"
></agent-3d>
```

**Key attributes:**

| Attribute | Type | Description |
|---|---|---|
| `body` | URL | GLB model URL |
| `brain` | URL | Agent manifest JSON URL |
| `agent-id` | string | Registered agent ID (resolves manifest automatically) |
| `mode` | `view` \| `chat` \| `embed` | Interaction mode |
| `eager` | boolean | Load immediately without intersection check |
| `sandbox` | boolean | Disable network calls (offline mode) |
| `width` / `height` | number | iframe dimensions when generating embed code |

The element fires a `postMessage` API for host-page communication (documented in `specs/EMBED_HOST_PROTOCOL.md`). Hosts can send events to the agent and receive `speak`, `think`, and `skill-done` events back.

**Versioned CDN bundles** are published at `/agent-3d/x.y.z/agent-3d.js`. Use `latest` for auto-updates or pin to a version for stability:
```html
<script src="https://three.ws/agent-3d/1.5.1/agent-3d.js"></script>
```

---

## Widget System

The Widget Studio (`/studio`) lets anyone build a shareable, embeddable 3D experience without writing code. Pick an avatar, pick a widget type, configure it, and get an iframe snippet.

**Five widget types:**

| Widget | Description |
|---|---|
| **Turntable** | Auto-rotating model showcase with configurable background, lighting, and camera |
| **Animation Gallery** | Paginated grid of named clips; click any to play it on the model |
| **Talking Agent** | Full chat interface with the LLM brain; embed a conversational agent anywhere |
| **ERC-8004 Passport** | On-chain identity card — shows agent name, owner, reputation score, and verification badge |
| **Hotspot Tour** | 3D hotspots pinned to world-space coordinates; click to reveal text annotations |

Each widget has:
- A public URL at `/w/<id>` with server-rendered Open Graph metadata for rich link previews
- An oEmbed endpoint at `/api/widgets/oembed` for WordPress, Ghost, Notion embedding
- An iframe embed URL at `/api/widgets/<id>/view`
- A view counter tracked at `/api/widgets/<id>/stats`
- A duplicate API at `/api/widgets/<id>/duplicate`

Widgets are stored as JSON config in Postgres, pointing at an avatar in R2.

---

## API Reference

The full OpenAPI 3.1 spec is available at `/openapi.json`. The key API surface is organized below.

### Agent API

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/agents` | session | List your agents |
| POST | `/api/agents` | session | Create an agent |
| GET | `/api/agents/:id` | — | Get agent detail |
| PATCH | `/api/agents/:id` | session | Update agent |
| DELETE | `/api/agents/:id` | session | Delete agent |
| GET | `/api/agents/:id/manifest` | — | Download manifest JSON |
| POST | `/api/agents/:id/sign` | session | Sign a message with agent wallet |
| GET/POST | `/api/agents/:id/embed-policy` | session | Manage iframe origin allowlist |
| POST | `/api/agents/register-prep` | session | Prep EVM on-chain registration |
| POST | `/api/agents/register-confirm` | session | Confirm EVM registration |
| POST | `/api/agent-actions` | session | Record signed agent action |

### Avatar API

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/avatars` | — | List public avatars |
| POST | `/api/avatars` | session | Create avatar record |
| GET | `/api/avatars/:id` | — | Get avatar detail |
| PATCH | `/api/avatars/:id` | session | Update metadata |
| DELETE | `/api/avatars/:id` | session | Soft-delete avatar |
| POST | `/api/avatars/:id/presign` | session | Get presigned R2 upload URL |
| POST | `/api/avatars/:id/pin-ipfs` | session | Pin to IPFS |

**Three-step upload flow:**
```
1. POST /api/avatars/:id/presign  →  { url, storage_key }
2. PUT <presigned_url>            ←  raw GLB bytes
3. POST /api/avatars              →  register metadata with storage_key
```

### Widget API

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/widgets` | session | List your widgets |
| POST | `/api/widgets` | session | Create widget |
| PATCH | `/api/widgets/:id` | session | Update widget |
| DELETE | `/api/widgets/:id` | session | Delete widget |
| POST | `/api/widgets/:id/duplicate` | session | Clone widget |
| GET | `/api/widgets/:id/stats` | — | View stats |
| GET | `/api/widgets/oembed` | — | oEmbed card |

### Memory API

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/agent-memory/:id` | session | Fetch agent memory store |
| POST | `/api/agent-memory/:id` | session | Append memory entries |
| PUT | `/api/agent-memory/:id` | session | Replace memory store |

### Chat & LLM

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/chat` | session \| api-key | Chat with agent (Claude backend) |
| POST | `/api/llm/anthropic` | session | Anthropic API proxy |

### Cron Jobs

Scheduled via `vercel.json`, these run automatically in production:

| Schedule | Endpoint | Purpose |
|---|---|---|
| Every 15 min | `/api/cron/erc8004-crawl` | Index new agents from blockchain |
| Every 5 min | `/api/cron/index-delegations` | Index EIP-7710 delegations |
| Hourly | `/api/cron/run-dca` | Execute DCA strategy orders |
| Hourly | `/api/cron/run-subscriptions` | Execute recurring subscriptions |

---

## Authentication & OAuth 2.1

three.ws supports three authentication methods:

**1. Email + Password (Session cookie)**
```
POST /api/auth/register   →  create account
POST /api/auth/login      →  JWT session cookie
GET  /api/auth/me         →  current user
POST /api/auth/logout     →  revoke session
```

**2. Wallet (SIWE / SIWS)**
```
POST /api/auth/siwe        →  get nonce challenge
POST /api/auth/siwe/verify →  verify EIP-4361 signed message → session
POST /api/auth/siws        →  Solana equivalent
```

**3. Developer API Keys**
```
POST /api/api-keys          →  create key (set scope + expiry)
DELETE /api/api-keys/:id    →  revoke key
Authorization: Bearer sk-...  →  authenticate requests
```

**OAuth 2.1 Server (RFC 6749 + PKCE)**

For third-party apps and MCP integrations:

```
GET  /oauth/authorize                       →  consent screen
POST /oauth/authorize                       →  submit consent → auth code
POST /oauth/token                           →  exchange code for tokens
POST /oauth/register                        →  RFC 7591 dynamic client reg
POST /oauth/revoke                          →  RFC 7009 token revocation
POST /oauth/introspect                      →  RFC 7662 token check
GET  /.well-known/oauth-authorization-server →  RFC 8414 discovery
GET  /.well-known/oauth-protected-resource  →  RFC 9728 resource discovery
```

Token scopes: `avatars:read`, `avatars:write`, `agents:read`, `agents:write`, `mcp`.

Access tokens are short-lived JWTs (1 hour). Refresh tokens are opaque strings stored hashed in Postgres.

---

## MCP Server

`api/mcp.js` (759 lines) implements the [Model Context Protocol](https://modelcontextprotocol.io) 2025-06-18 specification over HTTP with JSON-RPC 2.0. It enables external AI systems (including Claude Desktop, other agents, or custom integrations) to drive avatars programmatically.

**Endpoint:** `POST /api/mcp`
**Auth:** OAuth 2.1 Bearer token with `mcp` scope

**Available tools:**

| Tool | Description |
|---|---|
| `list_my_avatars` | List all avatars owned by the authenticated user |
| `get_avatar` | Fetch metadata and download URL for a specific avatar |
| `search_public_avatars` | Search the public avatar library by name, tag, or description |
| `render_avatar` | Generate a preview render of an avatar (returns image URL) |
| `delete_avatar` | Permanently delete an avatar |
| `validate_model` | Run Khronos glTF validation and return error report |
| `inspect_model` | Inspect model internals (mesh count, material list, animation names, texture sizes) |
| `optimize_model` | Optimize a model (Draco compression, texture downscale, mesh simplification) |

**MCP discovery:** configured in `.mcp.json` at the repo root for Claude Desktop integration.

**SSE stream:** `GET /api/mcp` returns a Server-Sent Events stream for real-time notifications from long-running operations (validation, optimization).

---

## On-Chain Identity (ERC-8004)

ERC-8004 is a draft standard for verifiable 3D agent identity. The `contracts/` directory contains a full Foundry implementation.

### Contracts

**IdentityRegistry.sol** — the primary contract. Each agent is an ERC-721 token with:
- `agentId` — stable numeric ID (the token ID)
- `owner` — EVM address of the agent's owner
- `delegatedSigner` — optional secondary address for runtime signing (EIP-712 typed signature)
- `tokenURI` — IPFS URL of the agent manifest JSON
- `metadata` — on-chain name, description, image pointer

**ReputationRegistry.sol** — stores signed feedback scores. Each reviewer can submit one score per agent. Scores are averaged for an on-chain reputation metric.

**ValidationRegistry.sol** — records validator attestations for off-chain proofs (glTF validation reports, skill audits, security reviews).

### Deployment Addresses

See `contracts/DEPLOYMENTS.md` for current mainnet and testnet addresses.

### Registration Flow (EVM)

```
1. POST /api/agents/register-prep   →  { manifest, typedData }
   (uploads manifest to IPFS, builds EIP-712 typed data for signing)

2. User signs typedData with their wallet

3. POST /api/agents/register-confirm  →  { txHash, agentId }
   (submits transaction, waits for confirmation, updates agent record)
```

The agent is now an ERC-721 token. Its manifest lives on IPFS. Its action history is anchored to its `agentId`. Any third party can verify the agent's identity, owner, and reputation without trusting three.ws.

### On-Chain Indexing

`api/cron/erc8004-crawl.js` runs every 15 minutes to index new IdentityRegistry mint events. Indexed agents appear in `/discover` and can be imported via `/hydrate`.

---

## Database Schema

The Postgres schema (`api/_lib/schema.sql`) is fully idempotent — all migrations use `CREATE TABLE IF NOT EXISTS` patterns. Safe to re-run on any environment.

**Core tables:**

```sql
-- Users
users (id, email, password_hash, display_name, avatar_url, plan, wallet_address, deleted_at)

-- 3D model files
avatars (id, owner_id, slug, name, description, storage_key, visibility,
         tags, checksum_sha256, version, deleted_at)

-- Sessions
sessions (id, user_id, token_hash, user_agent, ip, expires_at, revoked_at)

-- Developer API keys
api_keys (id, user_id, prefix, token_hash, scope, expires_at, revoked_at)

-- Agent identities
agent_identities (id, user_id, name, description, avatar_id, skills,
                  meta, wallet_address, erc8004_agent_id, deleted_at)

-- Signed action log
agent_actions (id, agent_id, type, payload, source_skill,
               signature, signer_address, created_at)

-- Memory store
agent_memories (id, agent_id, type, content, tags, context,
                salience, expires_at, created_at)
```

**OAuth tables:**

```sql
oauth_clients       (client_id, client_secret_hash, redirect_uris, grant_types, scope, ...)
oauth_auth_codes    (code, client_id, user_id, code_challenge, expires_at, consumed_at)
oauth_refresh_tokens(token_hash, client_id, user_id, scope, expires_at, revoked_at, ...)
```

**Wallet & signing:**

```sql
user_wallets  (user_id, address, chain_type, chain_id, is_primary)
siwe_nonces   (nonce, address, issued_at, expires_at, consumed_at)
siws_nonces   (same shape for Solana)
```

**Usage & quotas:**

```sql
usage_events (user_id, api_key_id, client_id, avatar_id, kind, tool, status, bytes, latency_ms)
plan_quotas  (plan, max_avatars, max_bytes_per_avatar, max_total_bytes)
```

---

## Build & Deployment

### npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server on port 3000 with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run build:lib` | Build `<agent-3d>` web component library to `dist-lib/` |
| `npm run build:artifact` | Build standalone Claude artifact viewer bundle |
| `npm run build:all` | build + build:lib + publish:lib |
| `npm run publish:lib` | Publish versioned CDN bundles to `/agent-3d/` |
| `npm run test` | Run Vitest suite |
| `npm run verify` | Prettier check + Vite build (pre-deploy gate) |
| `npm run format` | Prettier write (entire repo) |
| `npm run deploy` | build:all + vercel --prod |
| `npm run clean` | Remove dist/ and dist-lib/ |
| `npm run fetch-animations` | Download animation clip assets |
| `npm run generate-icons` | Generate PWA icon set |

### Vercel Deployment

The project is built for Vercel. Deployment is one command:

```bash
npm run deploy
```

This runs `build:all` then `vercel --prod`. Routing, rewrites, cache headers, and cron schedules are defined in `vercel.json`.

For preview deployments, push a branch — Vercel auto-deploys it with a preview URL.

**Environment variables** must be set in the Vercel dashboard (not in `.env` files). See [Environment Variables](#environment-variables) for the full list.

### Self-Hosting

For a traditional server deployment:

1. Build: `npm run build` → `dist/`
2. Serve `dist/` as static files (nginx, Caddy, Express)
3. Run `api/` endpoints via Node.js (wrap with Express or use the Vercel dev adapter)
4. Connect to Postgres (Neon or self-hosted)
5. Connect to S3-compatible storage (R2, MinIO, AWS S3)
6. Schedule cron jobs with node-cron or systemd timers

**Minimal nginx config:**
```nginx
server {
    listen 80;
    root /var/www/3d-agent/dist;
    index index.html;

    location /api {
        proxy_pass http://localhost:3001;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Environment Variables

### Required (Backend)

```env
# App
PUBLIC_APP_ORIGIN=https://three.ws           # No trailing slash

# Database
DATABASE_URL=postgres://user:pass@host/db    # Neon or any Postgres 15+

# Object storage (Cloudflare R2 or S3-compatible)
S3_ENDPOINT=https://...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=3d-agent-avatars
S3_PUBLIC_DOMAIN=https://cdn.three.ws        # CDN base URL for public model URLs

# Redis (rate limiting)
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Auth
JWT_SECRET=<base64>                          # openssl rand -base64 64
JWT_KID=k1                                   # Key ID (rotate by incrementing)
PASSWORD_ROUNDS=11                           # bcrypt cost factor

# LLM
ANTHROPIC_API_KEY=sk-ant-...
CHAT_MODEL=claude-sonnet-4-6
CHAT_MAX_TOKENS=1024
```

### Optional (Backend)

```env
# Email (required for registration flow)
RESEND_API_KEY=...

# Error monitoring
SENTRY_DSN=...

# Privy (social/embedded wallets)
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...

# Avatar regeneration
AVATURN_API_KEY=...
AVATAR_REGEN_PROVIDER=none                   # none | avaturn

# EIP-7710 permissions relayer
PERMISSIONS_RELAYER_ENABLED=false
AGENT_RELAYER_KEY=0x...
AGENT_RELAYER_ADDRESS=0x...

# Per-chain RPC URLs (add chains as needed)
RPC_URL_84532=https://sepolia.base.org
RPC_URL_8453=https://mainnet.base.org

# IPFS pinning
PINATA_JWT=...
WEB3_STORAGE_TOKEN=...                       # Fallback
```

### Optional (Frontend, prefixed `VITE_`)

```env
VITE_RPM_SUBDOMAIN=demo                      # Ready Player Me subdomain
VITE_PRIVY_APP_ID=...
VITE_AVATURN_EDITOR_URL=https://editor.avaturn.me/
VITE_AVATURN_DEVELOPER_ID=...
```

---

## Testing

The test suite uses Vitest. API tests mock the database and auth layer; frontend tests mock the viewer.

```bash
npm run test                           # All tests
npm run test -- tests/api/agents       # Specific file
npm run verify                         # prettier check + vite build
```

**Test coverage:**

| Area | Files |
|---|---|
| Agent CRUD | `tests/api/agents.test.js` |
| Widget CRUD | `tests/api/widgets.test.js` |
| OAuth flow | `tests/api/oauth-authorize.test.js`, `oauth-token.test.js` |
| SIWE wallet auth | `tests/api/siwe.test.js` |
| LLM proxy | `tests/api/llm-anthropic.test.js` |
| Schema validation | `tests/api/validate.test.js` |
| API keys | `tests/api/api-keys.test.js` |
| Crypto utilities | `tests/api/crypto.test.js` |
| Embed CORS policy | `tests/api/embed-policy.test.js` |
| Animation slots | `tests/src/animation-slots.test.js` |
| Widget types | `tests/src/widget-types.test.js` |

Smart contract tests are in `contracts/test/` and run via Foundry:
```bash
cd contracts && forge test
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

**Quick rules:**
- Match existing style — no reformatting adjacent code
- Every changed line should trace to the task
- Add tests for new API endpoints
- Run `npm run verify` before opening a PR (Prettier + build check)
- Keep PRs focused — one concern per PR

**Branch conventions:**
- `feat/...` — new features
- `fix/...` — bug fixes
- `refactor/...` — structural changes without behavior changes
- `docs/...` — documentation only

**Development tips:**
- The viewer runs standalone at `/app` — no auth, no backend required
- Use `mode=view` in the `<agent-3d>` element to test rendering without a brain
- Set `CHAT_MODEL=claude-haiku-4-5-20251001` locally to keep API costs low during development
- The MCP server can be tested with `curl` — it's plain JSON-RPC over HTTP

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

The three.js library (`node_modules/three`) is MIT licensed. The gltf-validator (`node_modules/gltf-validator`) is Apache 2.0. See each dependency's license for details.

---

*Built with [three.js](https://threejs.org), [Claude](https://claude.ai), and a belief that AI deserves a body.*
