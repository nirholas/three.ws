---
name: 3d-viewer
description: 'Full project workflow for the three.ws platform. Use when: developing features, debugging, modifying UI, understanding architecture, running dev server, or making code changes anywhere in the repo (viewer, agent runtime, API, contracts).'
argument-hint: 'Describe what you want to do'
---

# three.ws — Project Workflow

## Overview

**three.ws** started as a glTF 2.0 / GLB viewer and grew into a full embodied-agent platform. Live at [three.ws](https://three.ws/). Read [/CLAUDE.md](../../../CLAUDE.md) first — this skill is an index; the CLAUDE.md files are the source of truth.

## Two halves

- **Viewer half** — pure three.js. GLB loading, lighting, animations, validation, dat.gui.
- **Agent half** — persona (`agent-identity.js`), memory (`agent-memory.js`), skills (`agent-skills.js`), avatar emotion (`agent-avatar.js`), LLM runtime (`runtime/`), wallet identity (`erc8004/`), protocol bus (`agent-protocol.js`).

The viewer never imports the agent half. The agent layer wraps the viewer through `runtime/scene.js` (`SceneController`).

## Where code lives

| Area                         | Path         | Scoped doc                                          |
| ---------------------------- | ------------ | --------------------------------------------------- |
| Browser app (viewer + agent) | `src/`       | [src/CLAUDE.md](../../../src/CLAUDE.md)             |
| Vercel serverless API        | `api/`       | [api/CLAUDE.md](../../../api/CLAUDE.md)             |
| ERC-8004 Solidity registries | `contracts/` | [contracts/CLAUDE.md](../../../contracts/CLAUDE.md) |
| Format specs                 | `specs/`     | —                                                   |
| Priority-stack build prompts | `prompts/`   | [prompts/INDEX.md](../../../prompts/INDEX.md)       |
| User-facing docs             | `docs/`      | —                                                   |
| Static pages / assets        | `public/`    | —                                                   |
| SDK package                  | `sdk/`       | —                                                   |

Top-level HTML entries: `index.html`, `features.html`, `embed.html`, `agent-home.html`, `agent-embed.html`. Additional routes are rewritten by the `vercel-rewrites` middleware in [vite.config.js](../../../vite.config.js) and mirrored in [vercel.json](../../../vercel.json).

## Tech stack

- **three.js** r176 — WebGL2 rendering + `GLTFLoader`, `DRACOLoader`, `KTX2Loader`, `MeshoptDecoder`, `OrbitControls`
- **dat.gui** + **tweakpane** — control panels
- **simple-dropzone** — file drops
- **vhtml** — JSX → HTML string rendering (no virtual DOM)
- **gltf-validator** — KhronosGroup validation
- **Vite 7** — dev server + build (two targets: `app` and `lib`)
- **vite-plugin-pwa** — service worker + manifest
- **ethers v6**, **viem**, **@privy-io/js-sdk-core** — wallet + on-chain
- **Neon Postgres**, **Upstash Redis**, **Cloudflare R2**, **Vercel** — backend
- **Foundry** + **OpenZeppelin** (contracts)

## Commands

```bash
npm install
npm run dev         # app dev server on :3000
npm run dev:lib     # library build watch
npm run build       # app → dist/
npm run build:lib   # web component → dist-lib/
npm run build:all   # both
npm run deploy      # build + vercel --prod
npx prettier --write <file>
node --check <file.js>
```

No automated test suite (`npm test` exits 0). Verify with `node --check`, `npm run build`, and manual smoke at `localhost:3000`.

## Conventions

- ESM only (no CommonJS in `src/` or `api/`)
- Prettier: **tabs**, 4-wide, single quotes, 100-col print width
- No TypeScript in the main app (JSDoc for public APIs); `sdk/` may use TS
- Components are **vhtml JSX**, not React — `.jsx` files, `jsxFactory: 'vhtml'`
- URL hash params live in `src/app.js`: `model`, `widget`, `agent`, `kiosk`, `brain`, `proxyURL`, `preset`, `cameraPosition`, `register`
- Tool result shape: `{ ok: true, ... }` or `{ ok: false, error: 'msg' }`
- Naming: CamelCase classes, camelCase methods, UPPER_CASE constants, `_underscore` private

## Priority stack — before you start

The order of work is fixed in [prompts/INDEX.md](../../../prompts/INDEX.md):

1. Wallet auth (SIWE / Privy)
2. Selfie → agent
3. Edit avatars
4. View + embed
5. Portable embed (Claude.ai / LobeHub)
6. On-chain deployment (ERC-8004)

If a task isn't in a band, ask first. Side lanes (`pretext/`, `scalability/`, `widget-studio/` polish, CLI, AR, screenshot export) are explicitly deprioritized.

## Where to change what

- Rendering / GUI / display toggles → `src/viewer.js` and `src/viewer/*.js` (see [3d-features](../3d-features/SKILL.md))
- Validation → `src/validator.js` + `src/components/validator-*.jsx` (see [model-validation](../model-validation/SKILL.md))
- Build / deploy / Vercel routes → see [build-deploy](../build-deploy/SKILL.md)
- Agent persona / memory / skills → `src/agent-*.js`, `src/runtime/`, `src/skills/`, `src/memory/` — read [src/CLAUDE.md](../../../src/CLAUDE.md)
- Auth / avatars / OAuth / MCP / rate-limit / R2 → `api/` — read [api/CLAUDE.md](../../../api/CLAUDE.md)
- ERC-8004 registries → `contracts/` — read [contracts/CLAUDE.md](../../../contracts/CLAUDE.md)
- Top-level routing / URL hash params → `src/app.js` (don't create a new routing layer)

## Ground rules

- One task, one PR. Note unrelated bugs in the report — don't fix them inline.
- Edit existing files before creating new ones. No new top-level `.md` files unless asked.
- No new runtime deps without approval.
- `node --check` every modified JS. `npm run build` before reporting done. Report both outputs.
- Respect `Files off-limits` in prompt files — parallel work may touch them.
- Never `forge script --broadcast` without explicit user approval. Deployed contract addresses are immutable.
- Report what changed, what you skipped, what broke, and any surprises.
