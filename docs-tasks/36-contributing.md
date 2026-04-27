# Agent Task: Write "Contributing" Documentation

## Output file
`public/docs/contributing.md`

## Target audience
Developers who want to contribute to the three.ws open-source project — bug fixes, features, documentation, skill contributions. Covers the full contribution workflow.

## Word count
1500–2000 words

## What this document must cover

### 1. Ways to contribute
- **Bug reports** — report issues on GitHub
- **Bug fixes** — fix an open issue and submit a PR
- **New features** — discuss first in an issue, then implement
- **Documentation** — improve or extend these docs
- **Skills** — build and share a new agent skill
- **3D assets** — contribute to the Character Studio asset library
- **Smart contracts** — improve the ERC-8004 contracts (requires security audit)
- **Translations** — localize the UI

### 2. Before you start
- Read the project README and CLAUDE.md coding guidelines
- Check open issues — someone may already be working on it
- For significant features, open a discussion issue first — avoid building something that won't be merged

### 3. Development setup
```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/3dagent.git
cd 3dagent

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.example .env.local
# Minimum required: DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY

# 4. Start development server
npm run dev
# App: http://localhost:5173
```

**Optional but useful:**
- Neon DB account for a real test database
- Anthropic API key for LLM testing
- Upstash Redis for rate limiting

Without optional services, most features still work — the app degrades gracefully.

### 4. Project structure
Point contributors to the key directories:
```
src/              — client-side JavaScript (agent system, viewer, UI)
api/              — serverless API routes (Node.js)
public/           — static pages and assets
contracts/        — Solidity smart contracts (Foundry)
character-studio/ — avatar builder (separate React SPA)
specs/            — design specifications
docs/             — internal documentation
tests/            — unit and API tests
scripts/          — build and maintenance scripts
examples/         — working code examples
```

Reference the Architecture overview doc for deeper understanding.

### 5. Coding guidelines (from CLAUDE.md)
Summarize the key rules:
- **Simplicity first** — minimum code that solves the problem
- **Surgical changes** — touch only what you must; don't "improve" adjacent code
- **No speculative features** — only build what was asked
- **No comments** unless the WHY is non-obvious
- **Match existing style** — don't reformat code you didn't change
- **Remove orphans** — clean up imports/vars YOUR changes made unused

### 6. Running tests
```bash
# Run all tests
npm test

# Run specific test file
npm test tests/src/manifest.test.js

# Run API tests only
npm test tests/api/

# Watch mode
npm test -- --watch

# With coverage
npm test -- --coverage
```

Tests use Vitest. API tests use real endpoints (ensure dev server is running or use mocks).

E2E tests (Playwright):
```bash
npx playwright test
```

### 7. Writing tests
- Unit tests in `tests/src/` for pure functions
- API tests in `tests/api/` for endpoint behavior
- Test file name matches source: `src/manifest.js` → `tests/src/manifest.test.js`
- Use `vitest` describe/it/expect patterns
- Don't mock the database in API tests — use a test database

### 8. Submitting a pull request
1. Create a branch: `git checkout -b feat/your-feature-name`
2. Make your changes
3. Run tests: `npm test`
4. Run the linter: `npm run lint` (Prettier)
5. Commit with a clear message:
   ```
   feat: add hotspot click animation to tour widget
   fix: correct morph target decay rate for empathy emotion
   docs: add AR guide to contributing section
   ```
6. Push to your fork: `git push origin feat/your-feature-name`
7. Open a PR on GitHub against the `main` branch
8. Fill in the PR template (what changed, how to test, screenshots if UI)

### 9. Commit message format
Follow conventional commits:
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or updating tests
- `chore:` — maintenance (dep updates, config changes)

One subject line, imperative mood ("add" not "added"), no period at end. Under 72 characters.

### 10. Contributing a skill
Skills are the best way to extend three.ws without touching core code:

1. Create your skill directory (see Skills documentation for format)
2. Host it on GitHub Pages, Vercel, or any CDN
3. Share in the `#skills` Discord channel or open a PR to add it to the official skill registry
4. Include a `SKILL.md` documenting what it does and how to install it

Use `/examples/skills/wave/` as a template.

### 11. Contributing to Character Studio assets
The avatar asset library welcomes contributions:
1. Use Blender with the base mesh template (link in `/character-studio/README.md`)
2. Create your asset (clothing, hair, accessory)
3. Export as GLB following the naming conventions
4. Place in `/character-studio/public/<category>/`
5. Add to the asset manifest JSON
6. Submit PR with screenshots of the asset in-context

### 12. Reporting bugs
Open a GitHub issue with:
- Browser and OS version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Console errors (screenshot or paste)
- A link to a GLB that reproduces the issue (if applicable)

For security vulnerabilities — do NOT open a public issue. See the Security documentation for responsible disclosure.

### 13. Getting help
- GitHub Discussions — general questions, design discussions
- GitHub Issues — bug reports and feature requests
- Discord — real-time chat (link in README)

Response times: core team typically replies within 2-3 business days on GitHub; faster in Discord.

## Tone
Welcoming and precise. Developers should feel this is an organized, well-run project worth contributing to. The CLAUDE.md guidelines summary is important — contributors need to match the code style.

## Files to read for accuracy
- `/CONTRIBUTING.md` — existing contributing guide (expand significantly)
- `/CLAUDE.md` — coding guidelines
- `/README.md` — project overview
- `/docs/DEVELOPMENT.md` — development guide
- `/docs/SETUP.md` — setup instructions
- `/package.json` — available scripts
- `/vitest.config.js` — test configuration
- `/tests/` — existing test examples
- `/examples/skills/wave/` — skill template
