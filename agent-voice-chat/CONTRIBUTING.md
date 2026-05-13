# Contributing to X Space Agent

Thanks for your interest in contributing! This guide will help you get started.

## Quick Start

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/xspace-agent.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b my-feature`
5. Make your changes
6. Run tests: `pnpm test`
7. Run type check: `pnpm typecheck`
8. Commit: `git commit -m "feat: add cool thing"`
9. Push: `git push origin my-feature`
10. Open a PR

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 8+
- Chromium (for E2E tests — Puppeteer downloads this automatically)

### Install

```bash
pnpm install
```

### Run in dev mode

```bash
pnpm dev          # starts all packages in dev/watch mode via Turbo
```

### Run tests

```bash
pnpm test         # all tests
pnpm test:watch   # watch mode
pnpm test:coverage # with coverage
```

### Build

```bash
pnpm build        # compile all packages via Turbo
pnpm typecheck    # type check without emitting
pnpm lint         # lint all files
pnpm format       # format with Prettier
```

## Project Structure

```
packages/
  core/       ← SDK library (most contributions go here)
  cli/        ← Command-line tool (@xspace/cli)
  server/     ← Admin panel + WebSocket API (@xspace/server)
examples/     ← Example projects (basic-join, multi-agent, discord-bridge, etc.)
docs/         ← Project documentation
agent-voice-chat/ ← Voice chat agent implementation
```

## What to Contribute

### Good First Issues

Look for issues labeled `good first issue`. These are specifically selected for new contributors.

### Areas We Need Help

- **New AI providers** — add support for Mistral, Cohere, Together, etc.
- **New TTS providers** — add support for Cartesia, PlayHT, LMNT, etc.
- **Examples** — build example projects showing creative uses
- **Documentation** — fix typos, improve guides, add screenshots
- **Bug fixes** — check open issues
- **Tests** — increase coverage, especially in the audio pipeline

### Adding a New Provider

This is the easiest way to make a meaningful contribution:

1. Create `packages/core/src/providers/your-provider.ts`
2. Implement the `LLMProvider` interface:

```typescript
import { LLMProvider, Message } from '../types';

export class YourProvider implements LLMProvider {
  readonly type = 'socket';
  readonly name = 'your-provider';

  async generateResponse({ messages, systemPrompt }) {
    // Call your API
    return responseText;
  }
}
```

3. Register in `packages/core/src/providers/index.ts`
4. Add tests in `packages/core/tests/unit/providers/`
5. Add to docs: `docs/guide/providers.md`
6. Submit PR!

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `test:` — adding tests
- `refactor:` — code change that doesn't fix a bug or add a feature
- `chore:` — maintenance (deps, CI, etc.)

Examples:

- `feat: add Mistral provider`
- `fix: handle empty STT response`
- `docs: add authentication screenshots`

## Pull Request Process

1. Fill out the PR template
2. Ensure CI passes (lint + typecheck + build + tests)
3. Add tests for new functionality
4. Update docs if you changed the public API
5. One approval required for merge

## Code Style

- TypeScript strict mode
- No `any` in public APIs
- Meaningful variable names
- Comments only for non-obvious logic
- Export types from `types.ts`, not individual files
- Format with Prettier before committing (`pnpm format`)

## Need Help?

- Open a [Discussion](https://github.com/xspace-agent/xspace-agent/discussions)
- Tag `@maintainers` in your PR


