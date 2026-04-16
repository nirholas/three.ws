# CLAUDE.md

Root guidance for agents working in this repo. Read this first. Then read the scoped CLAUDE.md closest to the code you're touching.

---

## How to work here

1. **Move on your own.** You have broad permissions (see [.claude/settings.json](.claude/settings.json)). Don't ask before running builds, tests, formatters, git commits, or reads — just do them. Ask only before destructive ops, on-chain broadcasts, or production deploys.
2. **Work hard, then verify.** Don't stop at "the build passed." Open the URL, click the thing, check the network tab, tail the log. If you can't actually test the change (e.g., no browser), say so — don't fake confidence.
3. **Be intelligent about scope.** If a one-line fix needs a 200-line refactor to be safe, say so and ask. If the task is underspecified, pick the most useful interpretation and say which one.
4. **Don't delete the user's work.** Unfamiliar files / branches / comments may be in-progress. Investigate before removing. Deny list in [.claude/settings.json](.claude/settings.json) blocks the worst footguns (`rm -rf`, `git reset --hard`, `git push --force`, `forge script --broadcast`, etc.) — don't try to bypass them.
5. **One command to check yourself:** `npm run verify` (prettier + build). Run before reporting done.

---

## What this repo is

**3D Agent** is a browser-native glTF/GLB viewer that grew a full embodied-agent platform on top of it. Two halves, one codebase:

- **Viewer** — client-side three.js app that renders glTF 2.0 / GLB with Draco, KTX2, Meshopt. 100% in-browser.
- **Agent platform** — persona + memory + skills + wallet identity + ERC-8004 on-chain registration. LLM brain in `src/runtime/`, embodied rendering in `src/agent-avatar.js`, protocol bus in `src/agent-protocol.js`.

Live at <https://3dagent.vercel.app>. Backend is Vercel serverless (`api/`) + Neon Postgres + Cloudflare R2 + Upstash Redis. Contracts are Foundry / Solidity 0.8.24.

---

## Directory map — where things live

| Path | What it is | Scoped doc |
|---|---|---|
| [src/](src/) | Browser app — viewer + agent runtime + web component | [src/CLAUDE.md](src/CLAUDE.md) |
| [api/](api/) | Vercel serverless endpoints (auth, avatars, OAuth, MCP, agents) | [api/CLAUDE.md](api/CLAUDE.md) |
| [contracts/](contracts/) | Foundry project — ERC-8004 registries (Solidity) | [contracts/CLAUDE.md](contracts/CLAUDE.md) |
| [specs/](specs/) | Format specs: `AGENT_MANIFEST.md`, `SKILL_SPEC.md`, `EMBED_SPEC.md`, `MEMORY_SPEC.md` | — |
| [docs/](docs/) | User-facing docs: `ARCHITECTURE.md`, `API.md`, `DEPLOYMENT.md`, `DEVELOPMENT.md`, `WIDGETS.md`, `MCP.md` | — |
| [prompts/](prompts/) | Build prompts organized by priority band — see [prompts/INDEX.md](prompts/INDEX.md) | — |
| [public/](public/) | Static assets, separate HTML pages (`login.html`, `dashboard/`, `studio/`, `widgets-gallery/`) | — |
| [sdk/](sdk/) | `@3dagent/sdk` — public TS client (separate npm package) | — |
| [scripts/](scripts/) | One-off node scripts (schema apply, icon gen, animation fetchers) | — |
| [.github/skills/](.github/skills/) | GitHub Copilot `SKILL.md` bundles (viewer, features, validation, deploy) | — |
| [.github/prompts/](.github/prompts/) | Copilot prompt library for one-shot features | — |

Top-level HTML entry points: `index.html` (app), `features.html`, `embed.html`, `agent-home.html`, `agent-embed.html`. Additional routes served from `public/` — wiring is in [vite.config.js](vite.config.js) `vercel-rewrites` plugin, mirrored in [vercel.json](vercel.json).

---

## Current priorities (don't freelance)

Work follows the six-band priority stack in [prompts/INDEX.md](prompts/INDEX.md):

1. **Wallet auth** (SIWE / Privy / WalletConnect)
2. **Selfie → agent** (photo → rigged avatar)
3. **Edit avatars** (material, mesh, regenerate)
4. **View + embed** polish
5. **Portable embed** (Claude.ai artifact + LobeHub plugin)
6. **On-chain deployment** (ERC-8004)

If the task isn't in a band or isn't listed in INDEX.md, **ask before doing it.** Bands 1 and 2 block most downstream work — don't start band 4+ if band 1 is broken.

Side lanes explicitly deprioritized: `pretext/`, `scalability/`, `widget-studio/` polish, CLI tool, AR quick-look, screenshot export. Don't open those without direction.

---

## Commands

```bash
npm install                       # install deps
npm run dev                       # Vite dev server on :3000 (app build)
npm run dev:lib                   # library build watch (dist-lib/agent-3d.js)
npm run build                     # production build → dist/
npm run build:lib                 # library build → dist-lib/
npm run build:all                 # both
npm run deploy                    # build + vercel --prod
npx prettier --write <file>       # format (tabs, 4-wide, single quotes, 100 cols)
node --check <file.js>            # syntax check — run this on every JS you modify

# Contracts (cd contracts/)
forge build && forge test         # always before a deploy
forge script script/Deploy.s.sol --rpc-url base_sepolia   # dry-run
```

No test suite is configured (`npm test` exits 0). Verification = `node --check` + `npm run build` + manual smoke at `localhost:3000`. Say so explicitly when you can't browser-test a UI change — don't claim a UI works just because the build passed.

---

## Conventions

| Topic | Rule |
|---|---|
| Modules | **ESM only.** No CommonJS in `src/` or `api/`. |
| Formatting | Prettier: **tabs**, 4-wide, single quotes, 100-col print width, `bracketSpacing`. Run `npx prettier --write` before committing. |
| Typing | **No TypeScript** in the main app. JSDoc for public APIs. (SDK in `sdk/` may use TS — check locally.) |
| Templating | **vhtml JSX** — string-based, no virtual DOM. Files end in `.jsx`. `jsxFactory: 'vhtml'`. |
| Naming | CamelCase classes, camelCase methods, UPPER_CASE constants, `_underscore` for private. |
| State | Classes over factories where there's state. `EventTarget` for buses. |
| SQL | Always tagged-template via `sql\`...\`` from [api/_lib/db.js](api/_lib/db.js). Never concat. |
| HTTP responses | Use `json()` / `error()` / `wrap()` from [api/_lib/http.js](api/_lib/http.js). Never `res.end(JSON.stringify(...))`. |
| Auth | Use `getSessionUser` / `authenticateBearer` from [api/_lib/auth.js](api/_lib/auth.js). Never hand-roll JWT. |
| Tool result shape | `{ ok: true, ... }` or `{ ok: false, error: 'msg' }`. |
| Errors | `error(res, status, code, message)` — OAuth-style string codes. See `api/CLAUDE.md`. |

---

## Ground rules for agents

1. **One task, one PR.** If you notice an unrelated bug, write it in your report; don't fix it.
2. **Edit existing files before creating new ones.** No new top-level docs (`README.md`, `CLAUDE.md`, design docs) unless the task explicitly asks for them.
3. **No new runtime deps** unless the task says so. The bundle is a user-facing concern.
4. **Cite exact paths + line numbers** when referencing code. Don't invent APIs — read the file first.
5. **Trust but verify** — `node --check` and `npm run build` any modified JS. Report both outputs.
6. **Files off-limits per task** — respect `Files off-limits` sections in `prompts/*/` if present. Parallel tasks may be editing them.
7. **On-chain = immutable.** Any change to contract ABI, storage layout, or deployed address requires explicit user approval. See [contracts/CLAUDE.md](contracts/CLAUDE.md).
8. **Never `forge script --broadcast`** without approval.
9. **Secrets live in `.env.local` / Vercel**, never in code. See [.env.example](.env.example) for the full list.
10. **Reporting block at the end of every task:** files changed, commands run + their output, what you skipped, unrelated bugs observed.

---

## Architectural invariants — don't violate these

- **Viewer doesn't know about agents.** The agent layer wraps the viewer via `runtime/scene.js` (`SceneController`). Never import agent code from `viewer.js`.
- **All cross-module agent events flow through [src/agent-protocol.js](src/agent-protocol.js).** Don't add direct module-to-module coupling; emit typed events (`ACTION_TYPES`).
- **The Empathy Layer is a continuous weighted blend**, not an emotion FSM. See [src/CLAUDE.md](src/CLAUDE.md) for the decay + stimulus rules.
- **Manifest `_baseURI`** must end with `/` for relative resolution to work.
- **Skills default to `owned-only` trust** — manifest `author` must match `ownerAddress`. Mismatch → skill load throws.
- **Avatar `.glb` uploads must be verified via `headObject()`** before registering in the `avatars` table (blocks R2-bypass attacks).
- **MCP endpoints emit to `usage_events`** and respect `hasScope()`. Adding a tool without those = rejected.
- **`window.VIEWER` is a debug global only.** Never rely on it in production code paths — use closures / DI.

---

## Anti-patterns (these will get reverted)

- `res.end(JSON.stringify(...))` — use `json(res, ...)`.
- Instantiating a new Postgres `Pool` / `neon()` — import `sql` from `api/_lib/db.js`.
- Hand-rolled JWT extraction — use `authenticateBearer()`.
- String-concat SQL — tagged templates only.
- Inline CORS — use `cors(req, res, ...)`.
- Missing rate-limit on a public endpoint — use `limits.*` presets.
- Adding a discrete "emotion state" to the avatar — break the continuous blend.
- New top-level markdown file (README, design doc, "PLAN.md") without user asking.
- Adding TypeScript to the main app.
- Importing agent modules from the viewer half.
- Writing a new routing layer instead of extending the URL-hash params in [src/app.js](src/app.js).
- Long multi-paragraph comments / docstrings explaining *what* code does. Keep it tight.

---

## Common gotchas

- **`@avaturn/sdk` resolution warning at build time** — pre-existing, ignore.
- **`npm run dev` port 3000** — if taken, kill the other process; don't silently change the port.
- **SpeechRecognition** silently no-ops if unavailable — check `window.SpeechRecognition || window.webkitSpeechRecognition`.
- **Morph traversal runs every frame, every mesh.** Cheap on Mixamo avatars, expensive on scene-scale models.
- **`memory.recall()` is substring search** — no embeddings yet. Don't assume semantic.
- **`protocol.emit()` has no rate limit** — a runaway skill loop will cascade. Guard in the handler.
- **ERC-8004 addresses are CREATE2-deterministic** — same bytes on every chain. Check `REGISTRY_DEPLOYMENTS` in [src/erc8004/abi.js](src/erc8004/abi.js) before hardcoding anything.
- **Contract ABIs are hand-maintained ethers v6 human-readable strings** in `src/erc8004/abi.js`. No codegen. Sol change → abi.js edit.

---

## If you're stuck

- Unknown API — check `api/CLAUDE.md` and `api/_lib/` exports.
- Unknown viewer/agent pattern — check `src/CLAUDE.md` and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Unknown on-chain behavior — check `contracts/CLAUDE.md` and [specs/AGENT_MANIFEST.md](specs/AGENT_MANIFEST.md).
- Unknown skill shape — check [specs/SKILL_SPEC.md](specs/SKILL_SPEC.md).
- Unknown embed attribute — check [specs/EMBED_SPEC.md](specs/EMBED_SPEC.md).
- Which prompt to run next — check [prompts/INDEX.md](prompts/INDEX.md).
- Can't find something — `rg`/Grep first, then ask. Don't invent it.
