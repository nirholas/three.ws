# CLAUDE.md

**Read this first. Then act. Do not ask me questions that this file answers.**

---

## The one rule

**Stop asking me questions before you start working.** If a task is under ~50 lines, just do it. If you see an obvious default, take it. If a file obviously fits, use it. If you have a hunch about where something lives, grep — don't ask.

You are allowed to make judgment calls. I hired you to make them. Asking "should I proceed?", "which approach do you prefer?", "do you want me to also…?" before touching a single file is the #1 way you waste my time.

**What to do instead of asking:**
- Edit the file, show the diff, and *then* tell me if there was a judgment call worth flagging.
- If you genuinely cannot proceed without an answer, ask **one** specific question — not a menu of options and sub-options. Not "A, B, or C?" — pick the one you'd do and say "going with B unless you say otherwise."
- If you're unsure about a name or placement, take the obvious default and mention it in one line.

**What counts as "I must ask first" — short list, memorize it:**
1. Schema changes to Neon tables (`users`, `avatars`, `widgets`, `agent_identities`, `agent_memories`, `agent_actions`).
2. Renames of public APIs, event bus names, manifest fields, or on-chain ABI.
3. Adding a dependency to [package.json](package.json) (we are zero-dep by principle — exhaust alternatives first).
4. `git push`, `npm run deploy`, publishing, tagging, touching deployed contract addresses.
5. Deleting files I didn't tell you to delete. Binary assets in [public/avatars/](public/avatars/).

Everything else: **do the work.**

---

## What this project is

**3D Agent** — a browser-native 3D viewer that doubles as a runtime for *embodied agents*: 3D avatars with identity, memory, skills, and an emotional presence layer. Started as a glTF/GLB viewer; evolving into a universal frontend that renders agents from other frameworks (MCP, A2A, Claude skills).

The viewer is the vehicle. The agent runtime is the product.

**Production domain:** `3dagent.vercel.app` (also `3d.irish`). **Local dev:** `http://localhost:3000` via `npm run dev`.

---

## The stack (don't ask, don't change)

| Layer | What | Why I picked it |
|---|---|---|
| Renderer | three.js + dat.gui | Existing viewer; no replacement needed. |
| Client JSX | **vhtml** (not React) | Zero runtime overhead. See `src/components/*.jsx`. |
| Bundler | Vite 8 | Already configured. `npm run dev` / `npm run build`. |
| Backend | Vercel serverless functions in [api/](api/) | Keep endpoints small; reuse helpers in [api/_lib/](api/_lib/). |
| DB | Neon (Postgres) | Access via `@neondatabase/serverless`. `DATABASE_URL` env var. |
| Object storage | Cloudflare R2 (S3-compatible) | Avatars, assets. Use `@aws-sdk/client-s3`. |
| Auth | JWT via `jose` + `bcryptjs` | Helper lives in [api/_lib/](api/_lib/). **Never hand-roll auth — use `requireAuth()`.** |
| Rate limit | Upstash Redis | `@upstash/ratelimit`. |
| Web3 | `ethers` v6, ERC-8004 identity, Privy wallets | Contracts in [contracts/](contracts/). |
| Validation | `zod` | Use it on every request body. |
| Styling | Plain CSS + tokens in [style.css](style.css) | **No Tailwind. No CSS-in-JS. No new design system.** |
| Modules | ESM only (`"type": "module"`) | No CommonJS in `src/`. |
| Indentation | **Tabs, not spaces** | Match surrounding style. |

**Frameworks we do NOT use and will NOT add:** React, Next.js, Tailwind, TypeScript, CSS-in-JS, Redux, SWR, shadcn, any ORM.

---

## Where code lives

- [src/viewer.js](src/viewer.js), [src/viewer/](src/viewer/) — three.js renderer, scene, GUI. The original viewer. `Viewer` class has `load()`, `setCamera()`, `setBackgroundColor()`, `setEnvironment()`.
- [src/app.js](src/app.js) — SPA entry: dropzone, URL hash parsing (`#model=`, `#widget=`, `#agent=`), orchestration. This is the integration point for new URL-driven features.
- [src/agent-*.js](src/) — agent runtime modules:
  - `agent-protocol.js` — event bus (`EventTarget`-based). **Everything routes through here.**
  - `agent-memory.js` — 4-type memory (user / feedback / project / reference). Canonical, don't invent new types.
  - `agent-identity.js` — ERC-8004 + wallet.
  - `agent-skills.js` — skill execution.
  - `agent-avatar.js` — Empathy Layer (emotional presence, gaze, hero text wrap).
  - `agent-home.js` — identity card + timeline UI.
  - `agent-resolver.js` — resolves agent IDs → manifests.
- [src/runtime/](src/runtime/), [src/skills/](src/skills/), [src/memory/](src/memory/) — composable runtime bits for embedders.
- [src/element.js](src/element.js), [src/manifest.js](src/manifest.js) — `<agent-3d>` web component + manifest loader.
- [src/components/](src/components/) — vhtml JSX components.
- [src/nich-agent.js](src/nich-agent.js) — the reference agent (me).
- [src/account.js](src/account.js) — client for authenticated API calls (avatars). **Mirror this pattern for any new user-scoped resource.**
- [api/](api/) — Vercel serverless. Auth helpers in [api/_lib/](api/_lib/). Mirror `api/avatars/index.js` for new CRUD endpoints.
- [contracts/](contracts/) — Foundry project for ERC-8004 identity contracts.
- [specs/](specs/) — source-of-truth for manifest, skill, memory, embed formats.
- [examples/coach-leo/](examples/coach-leo/) — reference agent (manifest + instructions + skills).
- [prompts/](prompts/) — task prompts for agents (widget-studio, pretext, embed, scalability).
- [public/studio/](public/studio/), [public/dashboard/](public/dashboard/) — native-DOM apps (no framework).
- [dist/](dist/), [dist-lib/](dist-lib/) — build output. **Never edit.**

---

## Core conventions

- **Zero-dep runtime.** Agent modules use `EventTarget`, `localStorage`, `fetch`. Keep it that way. If you think you need a new dep, you probably don't.
- **Event-bus everything.** Actions flow through the protocol bus in [src/agent-protocol.js](src/agent-protocol.js); anything that wants to react (avatar, home, memory) subscribes. **Do not add direct coupling between agent modules.**
- **Auth: reuse the helper.** There is a `requireAuth()` (or equivalent) in [api/_lib/](api/_lib/). Use it. Do not write JWT code in a new endpoint.
- **Validation: always zod.** Every request body, every config blob. Reject unknowns.
- **Neon: use the shared client from [api/_lib/](api/_lib/).** Don't instantiate a new Pool.
- **New CRUD endpoint?** Copy the shape of [api/avatars/index.js](api/avatars/index.js) and [api/avatars/presign.js](api/avatars/presign.js). Same error conventions, same response helpers.
- **Public pages are native DOM.** Follow [public/dashboard/dashboard.js](public/dashboard/dashboard.js). vhtml is fine for templating; no client-side framework.
- **URL hash is the SPA routing layer** for viewer features. `#model=...`, `#widget=...`, `#agent=...`. Parse in [src/app.js](src/app.js).
- **Mobile-first.** Embed iframes run on mobile. Touch must work. Kiosk mode hides controls.

---

## Pre-answered questions (stop asking these)

**"Should I use TypeScript?"** No. JS + JSDoc if you want types.

**"Should I add tests?"** No test suite exists. `npm test` is a no-op. Verify manually by running `npm run dev` and exercising the feature. Don't add Jest/Vitest/Playwright without asking.

**"React component or vanilla DOM?"** Vanilla DOM or vhtml JSX. Never React.

**"Should I make this reusable / add abstractions?"** No. Three similar lines beat a premature abstraction. Inline first, refactor only when a third use case shows up.

**"Should I add error handling for [edge case]?"** Only validate at system boundaries (user input, external APIs). Trust internal calls. No defensive `try/catch` around code that can't throw.

**"Tabs or spaces?"** Tabs. Always.

**"Should I add comments?"** Default: no. Only add a comment when the *why* is non-obvious (a hidden constraint, a workaround, a surprising invariant). Never describe *what* the code does.

**"Should I split this into multiple PRs?"** Do whatever makes the diff easiest to review. One focused PR > three fragmented ones.

**"Where should I put this new file?"** Look at what it's most similar to and put it next to that. [src/agent-*.js](src/) for agent-runtime concerns. [src/skills/](src/skills/) for skills. [api/](api/) for serverless. [public/<app>/](public/) for a standalone native-DOM page.

**"Should I run the build?"** Yes, if you changed runtime code. `npm run build` must pass before you declare done.

**"Should I commit?"** Only when I explicitly say so. Until then: edit, show diff, stop.

**"Should I update docs / README?"** No, unless I asked. Never create new `.md` files unless I asked.

**"Should I rename this for consistency while I'm here?"** No. Scope creep. Do the task I gave you.

**"Which environment variable holds X?"** Grep `.env.example` or `vercel.json`. Then use `process.env.X` server-side, `import.meta.env.VITE_X` client-side.

---

## Running things

| Command | What |
|---|---|
| `npm run dev` | Vite dev server on :3000 |
| `npm run build` | Production build → `dist/` |
| `npm run build:lib` | Library build → `dist-lib/` |
| `npm run build:all` | Both |
| `npm run clean` | Wipe `dist/`, `dist-lib/` |
| `npm run fetch-animations` | Download Mixamo animation bundle |
| `npm run deploy` | **Do not run without explicit ask.** |

No test suite. When you change runtime behavior, verify by opening the dev server and exercising the feature. Type-check / build success is not proof the feature works.

---

## Don't touch without explicit ask

- [dist/](dist/), [dist-lib/](dist-lib/) — regenerated by build.
- [contracts/out/](contracts/out/), [contracts/cache/](contracts/cache/) — Foundry artifacts.
- `.env*` files — secrets.
- [public/avatars/](public/avatars/) binary assets — check before replacing.
- Deployed contract addresses in [contracts/](contracts/).

---

## Prompts directory

[prompts/](prompts/) contains self-contained task specs (widget-studio, pretext, embed, scalability). If I hand you a file from here, treat it as the full brief — it tells you what to read, what to build, and what not to build. **Follow the "Do not do this" section in each prompt religiously.** Scope creep from those prompts is the second biggest way agents waste my time.

---

## Commit style

Short, imperative, conventional-ish: `feat:`, `fix:`, `refactor:`, `chore:`. One-line summary, optional body. No emoji. See recent `git log` for tone.

---

## TL;DR

1. Read this file.
2. Read the target files.
3. Make the change.
4. Show me the diff.
5. If something genuinely needed a decision, flag it in one line *after* the work.

Don't ask. Don't plan. Don't propose. Just ship.
