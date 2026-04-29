# Prompt: Contributing Guide & Community Infrastructure

## Why
Open-source projects don't grow from code alone — they grow from contributors. A great CONTRIBUTING.md is the difference between "I want to help but don't know how" and someone's first PR.

## Files to Create

### CONTRIBUTING.md
```markdown
# Contributing to X Space Agent

Thanks for your interest in contributing! This guide will help you get started.

## Quick Start

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/xspace-agent`
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
- Node.js 20+
- pnpm 8+
- Chromium (for E2E tests)

### Install
\```bash
pnpm install
\```

### Run in dev mode
\```bash
pnpm dev          # starts server with hot reload
\```

### Run tests
\```bash
pnpm test         # all tests
pnpm test:watch   # watch mode
pnpm test:coverage # with coverage
\```

### Build
\```bash
pnpm build        # compile TypeScript
pnpm typecheck    # type check without emitting
pnpm lint         # lint all files
\```

## Project Structure

\```
packages/
  core/     ← SDK library (most contributions go here)
  cli/      ← Command-line tool
  server/   ← Admin panel + API server
examples/   ← Example projects
docs/       ← Documentation site (VitePress)
\```

## What to Contribute

### Good First Issues
Look for issues labeled `good first issue`. These are specifically selected for new contributors.

### Areas We Need Help
- **New AI providers** — add support for Mistral, Cohere, Together, etc.
- **New TTS providers** — add support for Cartesia, PlayHT, LMNT, etc.
- **Examples** — build example projects showing creative uses
- **Documentation** — fix typos, improve guides, add screenshots
- **Bug fixes** — check open issues
- **Tests** — increase coverage, especially in audio pipeline

### Adding a New Provider
This is the easiest way to make a meaningful contribution:

1. Create `packages/core/src/providers/your-provider.ts`
2. Implement the `LLMProvider` interface:
\```typescript
import { LLMProvider, Message } from '../types'

export class YourProvider implements LLMProvider {
  readonly type = 'socket'
  readonly name = 'your-provider'

  async generateResponse({ messages, systemPrompt }) {
    // Call your API
    return responseText
  }
}
\```
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
2. Ensure CI passes (lint + typecheck + tests)
3. Add tests for new functionality
4. Update docs if you changed the public API
5. One approval required for merge

## Code Style
- TypeScript strict mode
- No `any` in public APIs
- Meaningful variable names
- Comments only for non-obvious logic
- Export types from `types.ts`, not individual files

## Need Help?
- Open a [Discussion](https://github.com/org/xspace-agent/discussions)
- Ask in [Discord #contributing](https://discord.gg/YOUR_INVITE_CODE)
- Tag @maintainers in your PR
```

### .github/ISSUE_TEMPLATE/bug_report.md
```markdown
---
name: Bug Report
about: Something isn't working
labels: bug
---

## Description
What happened?

## Steps to Reproduce
1.
2.
3.

## Expected Behavior
What should have happened?

## Environment
- OS:
- Node version:
- Package version:
- AI Provider:
- Browser (if relevant):

## Logs
\```
Paste relevant logs here
\```
```

### .github/ISSUE_TEMPLATE/feature_request.md
```markdown
---
name: Feature Request
about: Suggest a new feature
labels: enhancement
---

## Problem
What problem does this solve?

## Proposed Solution
How should it work?

## Alternatives Considered
Other approaches you've thought about.

## Additional Context
Screenshots, examples, references.
```

### .github/PULL_REQUEST_TEMPLATE.md
```markdown
## What
Brief description of the change.

## Why
What problem does this solve?

## How
Brief technical explanation (if non-obvious).

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing done

## Checklist
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] Docs updated (if public API changed)
- [ ] Commit messages follow conventional commits
```

### .github/ISSUE_TEMPLATE/config.yml
```yaml
blank_issues_enabled: false
contact_links:
  - name: Question / Help
    url: https://github.com/org/xspace-agent/discussions/categories/q-a
    about: Ask questions in Discussions, not Issues
  - name: Discord
    url: https://discord.gg/YOUR_INVITE_CODE
    about: Chat with the community
```

### CODE_OF_CONDUCT.md
Use the standard Contributor Covenant (https://www.contributor-covenant.org/).

### SECURITY.md
```markdown
# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities via email to security@yourproject.dev.

Do NOT open a public GitHub issue for security vulnerabilities.

We will respond within 48 hours and provide a fix within 7 days for critical issues.
```

### LICENSE
All Rights Reserved. Proprietary license.

## GitHub Repository Settings
- Enable Discussions
- Enable "Require PR reviews" (1 reviewer)
- Enable "Require status checks" (CI must pass)
- Protect `main` branch
- Enable "Auto-delete head branches"
- Add topics: `ai`, `twitter`, `x-spaces`, `puppeteer`, `typescript`, `voice-ai`, `sdk`, `agent`

## Labels
Create these labels for issue triage:
```
good first issue    — green  — Beginner-friendly
bug                 — red    — Something isn't working
enhancement         — blue   — New feature
documentation       — purple — Docs improvement
provider            — teal   — New/improved AI provider
help wanted         — yellow — Community help needed
wontfix             — gray   — Decided against
duplicate           — gray   — Already exists
priority: high      — orange — Needs immediate attention
```

## Implementation Steps
1. Create CONTRIBUTING.md
2. Create .github/ directory with templates
3. Create CODE_OF_CONDUCT.md (Contributor Covenant)
4. Create SECURITY.md
5. Create LICENSE (MIT)
6. Configure GitHub repo settings
7. Create labels
8. Enable Discussions with categories (Q&A, Ideas, Show & Tell)
9. Write 5+ "good first issue" issues

## Validation
- [ ] New contributor can follow CONTRIBUTING.md and submit a PR
- [ ] Issue templates appear when creating new issues
- [ ] PR template auto-fills when opening a PR
- [ ] "good first issue" label exists with open issues
- [ ] Branch protection requires CI + review


