# CLAUDE.md

**Read this first. Then act. Do not ask questions this file answers.**

Scoped guidance lives in [api/CLAUDE.md](api/CLAUDE.md), [src/CLAUDE.md](src/CLAUDE.md), and [contracts/CLAUDE.md](contracts/CLAUDE.md) — read whichever applies to where you're editing.

---

## The one rule

**Stop asking me questions before you start working.** If a task is under ~50 lines, just do it. If you see an obvious default, take it. If a file obviously fits, use it. If you have a hunch about where something lives, grep — don't ask.

You are allowed to make judgment calls. I hired you to make them. Asking "should I proceed?", "which approach do you prefer?", "do you want me to also…?" before touching a single file is the #1 way you waste my time.

**What to do instead of asking:**
- Edit the file, show the diff, and *then* flag the one judgment call worth mentioning.
- If you genuinely cannot proceed, ask **one** specific question. Not a menu. Pick the one you'd do and say "going with B unless you say otherwise."
- If unsure about a name or placement, take the obvious default and mention it in one line.

**Must-ask-first — memorize this short list:**
1. Schema changes to Neon tables (see [api/CLAUDE.md](api/CLAUDE.md) for the table list).
2. Renames of public APIs, event-bus action types, manifest fields, or on-chain ABI.
3. Adding a dependency to [package.json](package.json) — zero-dep by principle, exhaust alternatives.
4. `git push`, `npm run deploy`, publishing, tagging, redeploying contracts.
5. Deleting files I didn't tell you to delete. Binary assets in [public/avatars/](public/avatars/).

Everything else: **do the work.**

---

## What this project is

**3D Agent** — a browser-native 3D viewer that doubles as a runtime for *embodied agents*: 3D avatars with on-chain identity (ERC-8004), memory, skills, and an emotional presence layer. Started as a glTF/GLB viewer; evolving into a universal frontend that renders agents from other frameworks (MCP, A2A, Claude skills).

The viewer is the vehicle. The agent runtime is the product.

- **Production:** `3dagent.vercel.app` (also `3d.irish`)
- **Local dev:** `http://localhost:3000` via `npm run dev`
- **MCP endpoint:** `https://3dagent.vercel.app/api/mcp`
- **npm SDK:** [`@nirholas/agent-kit`](sdk/package.json) — separate package, lives in [sdk/](sdk/), not consumed by the main app

---

## The stack (don't ask, don't change)

| Layer | What | Why |
|---|---|---|
| Renderer | three.js r176 + dat.gui | Existing viewer; no replacement. |
| Client JSX | **vhtml** (not React) | String-based, zero runtime. See `src/components/*.jsx`. |
| Bundler | Vite 8 | `TARGET=lib` splits between `dist/` and `dist-lib/`. |
| Backend | Vercel serverless in [api/](api/) | Small endpoints; reuse helpers in [api/_lib/](api/_lib/). |
| DB | Neon (Postgres) via `@neondatabase/serverless` | Tagged-template `sql` from [api/_lib/db.js](api/_lib/db.js). |
| Object storage | Cloudflare R2 (S3-compatible) | Avatars. Helpers in [api/_lib/r2.js](api/_lib/r2.js). |
| Auth | Session cookies + JWT (HS256) + API keys | Helpers in [api/_lib/auth.js](api/_lib/auth.js). **Never hand-roll.** |
| Rate limit | Upstash Redis via `@upstash/ratelimit` | Presets in [api/_lib/rate-limit.js](api/_lib/rate-limit.js). |
| Web3 | ethers v6 + Privy wallets + ERC-8004 | Contracts in [contracts/](contracts/), ABIs in [src/erc8004/abi.js](src/erc8004/abi.js). |
| Validation | zod | Helpers in [api/_lib/validate.js](api/_lib/validate.js). Every request body. |
| Styling | Plain CSS + tokens in [style.css](style.css) | **No Tailwind. No CSS-in-JS. No design system.** |
| Modules | ESM only (`"type": "module"`) | No CommonJS in `src/`. |
| Indentation | **Tabs, 4-wide** | Prettier-enforced. See [.prettierrc.json](.prettierrc.json). |

**Frameworks we do NOT use and will NOT add:** React, Next.js, Tailwind, TypeScript, CSS-in-JS, Redux, SWR, shadcn, any ORM, any testing framework.

---

## Repo map

```
src/                   # viewer + agent runtime (see src/CLAUDE.md)
api/                   # Vercel serverless (see api/CLAUDE.md)
contracts/             # Foundry / ERC-8004 (see contracts/CLAUDE.md)
public/
  agent/               # /agent/:id unfurl page + /agent/:id/embed iframe target
  dashboard/           # /dashboard authenticated SPA (avatars, keys, MCP, billing)
  studio/              # /studio — DOES NOT EXIST YET; it's the deliverable of prompts/widget-studio/00
sdk/                   # @nirholas/agent-kit npm package (separate from main app)
specs/                 # source-of-truth formats (manifest/skill/memory/embed v0.1)
examples/coach-leo/    # reference agent (manifest + instructions + skill)
prompts/               # task briefs (embed, pretext, scalability, widget-studio) — see Prompts workflow below
docs/                  # authoritative docs: ARCHITECTURE, API, DEPLOYMENT, DEVELOPMENT, MCP, SETUP
scripts/               # animation fetchers + PWA icon generator
dist/, dist-lib/       # build output — never edit
.github/prompts/       # 21 Claude Code feature prompts (not CI)
```

**HTML entry points:** [index.html](index.html) (main app), [embed.html](embed.html) (embed editor), [features.html](features.html) (marketing/ERC-8004 page).

**Config glue you should know:**
- [vite.config.js](vite.config.js) — `TARGET=lib` switches to library build. Multi-entry for the three HTML files. PWA plugin + Workbox.
- [vercel.json](vercel.json) — routes for `/oauth/*`, `/dashboard/*`, `/agent/:id`, `/agent/:id/embed`, `/.well-known/*`. **Fallback `/(.*)` is last — never insert above it.**
- [cors.json](cors.json) — R2 bucket CORS (GET only, localhost + prod origins).
- [.env.example](.env.example) — every env var, grouped below.

---

## Environment variables

**Server (no prefix, read via `process.env.X`):**
- `DATABASE_URL` — Neon Postgres
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`
- `JWT_SECRET`, `JWT_KID` (default `k1`)
- `PASSWORD_ROUNDS` (default `11`)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (falls back to in-memory for local dev)
- `PUBLIC_APP_ORIGIN` (default `https://3dagent.vercel.app`)
- `BASE_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `BASESCAN_API_KEY`, `DEPLOYER_PK` (contracts only)

**Client (`VITE_` prefix, read via `import.meta.env.VITE_X`):**
- `VITE_AVATURN_SUBDOMAIN` (avatar creator)
- `VITE_PRIVY_APP_ID` (wallet login)

All loaded via [api/_lib/env.js](api/_lib/env.js) server-side — import from there, don't touch `process.env` directly.

---

## Canonical patterns (copy these, don't invent new ones)

### New API endpoint → see [api/CLAUDE.md](api/CLAUDE.md) for the full template.

### New agent skill
1. `src/skills/my-skill/manifest.json` — `{ spec: "skill/0.1", name, version, author, dependencies, provides: { tools } }`
2. `src/skills/my-skill/SKILL.md` — frontmatter (name, description, triggers, cost) + markdown instructions injected into LLM prompt
3. `src/skills/my-skill/tools.json` — Anthropic tool-use schema: `[{ name, description, input_schema }]`
4. `src/skills/my-skill/handlers.js` — `export default { toolName: async (args, ctx) => ({ ok: true, ... }) }` where `ctx` gives you `{ viewer, memory, llm, speak, listen, fetch, loadGLB, loadClip, loadJSON, call }`
5. Reference in the agent's manifest: `skills: [{ uri: "skills/my-skill/", version: "0.1.0" }]`

### New standalone page under `public/`
Follow [public/dashboard/dashboard.js](public/dashboard/dashboard.js). Pattern: one HTML file + one module JS + inline styles on top of global [style.css](style.css). Auth via `credentials: 'include'` + session cookies, never Bearer tokens in browser code. Hash-based tab routing (`#avatars`, `#keys`). vhtml for templating if JSX helps.

### New URL-driven viewer feature
Parse the hash in [src/app.js](src/app.js) — existing keys: `model`, `widget`, `agent`, `kiosk`, `brain`, `proxyURL`, `preset`, `cameraPosition`, `register`. Add your key next to those, don't invent a new routing layer.

### New protocol action
Add to `ACTION_TYPES` in [src/agent-protocol.js](src/agent-protocol.js), emit via `protocol.emit({ type, payload })`, subscribe in avatar/identity/home/memory as needed. **Never add direct module-to-module coupling.** Full event vocabulary in [src/CLAUDE.md](src/CLAUDE.md).

---

## Pre-answered questions (stop asking these)

**"Should I use TypeScript?"** No. JS + JSDoc if you want types.

**"Should I add tests?"** No test suite exists. `npm test` is a no-op. Verify manually by running `npm run dev` and exercising the feature. Don't add Jest/Vitest/Playwright without asking.

**"React component or vanilla DOM?"** Vanilla DOM or vhtml JSX. Never React.

**"Should I make this reusable / add abstractions?"** No. Three similar lines beat a premature abstraction. Inline first, refactor when a third use case shows up.

**"Should I add error handling for [edge case]?"** Only validate at system boundaries (user input, external APIs). Trust internal calls. No defensive `try/catch` around code that can't throw.

**"Tabs or spaces?"** Tabs. Always. 4-wide.

**"Should I add comments?"** Default no. Only when *why* is non-obvious (hidden constraint, workaround, surprising invariant). Never describe *what* the code does.

**"Where should I put this new file?"** Look at what it's most similar to and put it next to that. `src/agent-*.js` for agent-runtime concerns. `src/skills/` for skills. `api/` for serverless. `public/<app>/` for a standalone native-DOM page.

**"Should I run the build?"** Yes, if you changed runtime code. `npm run build` must pass before you declare done. There is a pre-existing `@avaturn/sdk` resolution warning — ignore it, it's unrelated.

**"Should I commit?"** Only when I explicitly say so. Until then: edit, show diff, stop.

**"Should I update docs / README?"** No, unless I asked. Never create new `.md` files unless I asked.

**"Should I rename this for consistency while I'm here?"** No. Scope creep. Do the task I gave you.

**"Which env var holds X?"** Grep [.env.example](.env.example) first. Server-side → `process.env.X` (via [api/_lib/env.js](api/_lib/env.js)). Client-side → `import.meta.env.VITE_X`.

**"Should I split this into multiple PRs?"** Do whatever makes the diff easiest to review. One focused PR > three fragmented ones.

**"Does /studio exist?"** No — it's the deliverable of [prompts/widget-studio/00-studio-foundation.md](prompts/widget-studio/00-studio-foundation.md). Don't assume it's there when reading other code.

---

## Running things

| Command | What |
|---|---|
| `npm run dev` | Vite dev server on :3000 |
| `npm run build` | Production build → `dist/` |
| `npm run build:lib` | Library build → `dist-lib/` (ES + UMD, Three.js + ethers bundled) |
| `npm run build:all` | Both |
| `npm run clean` | Wipe `dist/`, `dist-lib/` |
| `npm run fetch-animations` | Download Mixamo bundle (calls [scripts/download-animations.mjs](scripts/download-animations.mjs)) |
| `npm run generate-icons` | PWA icons via Sharp from [public/3d.png](public/3d.png) |
| `npm run deploy` | **Do not run without explicit ask.** |

No test suite. When you change runtime behavior, verify by running `npm run dev` and exercising the feature in the browser. Build success is not proof the feature works.

---

## Don't touch without explicit ask

- [dist/](dist/), [dist-lib/](dist-lib/) — regenerated by build
- [contracts/out/](contracts/out/), [contracts/cache/](contracts/cache/) — Foundry artifacts
- `.env*` files — secrets
- [public/avatars/](public/avatars/) binary assets — check before replacing
- Deployed contract addresses in [src/erc8004/abi.js](src/erc8004/abi.js) — immutable on-chain
- [gitpretty.sh](gitpretty.sh) — destructive history rewrite, never run casually
- The fallback `/(.*)` route at the bottom of [vercel.json](vercel.json) — never insert new routes below it

---

## Prompts workflow

When I hand you a file from [prompts/](prompts/), it is the full brief. Don't second-guess it.

1. Read the subdir's `README.md` first (execution order, ownership guardrails)
2. Parse the prompt: Goal → Prerequisites → "Read these first" (follow the line pointers, don't skip) → "Build this" → **"Do not do this"** (scope-creep guard — respect religiously) → Deliverables → Acceptance → Test plan
3. Read every file listed in "Read these first" before writing anything
4. Implement to the deliverables list exactly — filenames as stated
5. Respect file-ownership guardrails (cross-prompt merge safety depends on it)
6. Verify: `node --check` each JS file, `npx vite build`, manual test plan from the prompt
7. Report in the format the prompt's "Reporting" section asks for

**Subdir scopes at a glance:**
- [prompts/embed/](prompts/embed/) — OG images, oEmbed, agent-id resolver, referrer allowlist
- [prompts/pretext/](prompts/pretext/) — `@chenglou/pretext` text-wrap around avatar on `/features` hero
- [prompts/scalability/](prompts/scalability/) — viewer dispose, render-on-demand, module split, web-component wrap, shared renderer
- [prompts/widget-studio/](prompts/widget-studio/) — `/studio` no-code widget authoring (does not exist yet)

Scope creep from prompts is the second-biggest way agents waste my time. "While I'm here let me also…" — no. Do the task I gave you.

---

## Commit style

Short, imperative, conventional-ish: `feat:`, `fix:`, `refactor:`, `chore:`. One-line summary, optional body. No emoji. See recent `git log` for tone.

---

## TL;DR

1. Read this file + the relevant scoped CLAUDE.md ([api/](api/CLAUDE.md), [src/](src/CLAUDE.md), [contracts/](contracts/CLAUDE.md))
2. Read the target files
3. Make the change
4. Show me the diff
5. If something genuinely needed a decision, flag it in one line *after* the work

Don't ask. Don't plan. Don't propose. Just ship.
