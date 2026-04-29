# xspace-agent Monorepo

TypeScript SDK + CLI for AI voice agents in X (Twitter) Spaces. Puppeteer browser automation, multi-LLM support, speech pipeline.

## Terminal Rule

**Kill every terminal** — always use `isBackground: true`, then kill the terminal after output is captured.

## Monorepo Structure

- `packages/core/` → `xspace-agent` — Main SDK (agent, audio, browser, FSM, providers, intelligence, turns)
- `packages/server/` → `@xspace/server` — Express + Socket.IO admin panel
- `packages/cli/` → `@xspace/cli` — CLI tool (init, auth, join, start, dashboard)
- `packages/widget/` → UI widget (early stage)
- `packages/create-xspace-agent/` → Scaffolding template
- `src/` → Legacy server (being migrated into packages/, still functional)
- `agent-voice-chat/` → Standalone voice chat agent (independent project)
- `examples/` → 10+ runnable example projects

Package manager: **pnpm**. Workspace config in `pnpm-workspace.yaml`. Build orchestration via **Turborepo** (`turbo.json`).

## Commands

```bash
pnpm install             # Install all deps
pnpm dev                 # Start dev server (tsx watch src/server/index.ts)
pnpm build               # Turbo: tsc → dist/ across all packages
pnpm test                # Turbo: vitest run (packages/core)
pnpm typecheck           # tsc --noEmit (server + client tsconfigs)
pnpm lint                # eslint
pnpm lint:fix            # eslint --fix
```

## TypeScript

- Target: ES2022, Module: NodeNext, Strict: true
- Root `tsconfig.json` for server code, `tsconfig.base.json` inherited by packages
- `tsconfig.client.json` for browser/client code

## Coding Conventions

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **Unused vars**: `_`-prefixed allowed, others warned by ESLint
- **No explicit `any`**: warned by ESLint
- **Provider interfaces**: All providers implement `streamResponse()`/`transcribe()`/`synthesize()`, `checkHealth()`, `getMetrics()`, `estimateCost()`
- **Error hierarchy**: All SDK errors extend `XSpaceError` with `code`, `message`, `hint`, `docsUrl`
- **State machines**: Agent lifecycle goes through FSM (`packages/core/src/fsm/`), never ad-hoc flags
- **Self-healing selectors**: Use `SelectorEngine` with multiple fallback strategies, never hardcode CSS selectors
- **File-based persistence**: No databases — JSON + gzip by design

## What NOT to Do

- Don't commit `.env`, API keys, or auth tokens
- Don't modify `server.js` (legacy) — work in `packages/` or `src/` TypeScript
- Don't add database dependencies
- Don't break provider interface contracts
- Don't hardcode X Space CSS selectors — use SelectorEngine
- Don't bypass the FSM for agent state transitions
- Don't work in `src/` for new features — prefer `packages/core/`

## Key References

- Architecture details: see `CLAUDE.md` at root and in each package
- Dev setup: see `CONTRIBUTING.md`
- Environment variables: see `.env.example` (~215 vars with comments)
- Docs: see `docs/` (43 markdown files on architecture, deployment, API reference)


