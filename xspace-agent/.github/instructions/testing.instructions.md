---
description: "Use when writing or running tests — Vitest configuration, test patterns, mocking, coverage targets."
applyTo: "**/*.test.ts,**/*.spec.ts,**/tests/**,**/__tests__/**"
---
# Testing Conventions

## Framework

- **Vitest** with `@vitest/coverage-v8`
- Tests in `packages/core/tests/` and `packages/core/src/__tests__/`
- E2E tests in `packages/core/src/__tests__/e2e/` (require API keys, run on CI `main` only)

## Commands

```bash
pnpm test                                                  # Turbo: all tests
cd packages/core && npx vitest run                         # Core tests
cd packages/core && npx vitest run --coverage              # With coverage
cd packages/core && npx vitest run src/__tests__/e2e/      # E2E only
```

## Patterns

- Use mock providers — never call real APIs in unit tests
- Test timeout: 10 seconds
- Coverage targets: ~80% statements/functions/lines, ~70% branches
- CI matrix: Node 18, 20, 22
- Use Socket.IO test helpers and test app factories for server tests

## Rules

- New features should include tests
- Mock external dependencies (LLM/STT/TTS providers, Puppeteer)
- E2E tests must be gated behind environment variable checks


