# 45 — Lint and format: ensure all changes pass prettier and eslint

## Status
Required — all modified files must pass the project's linter and formatter before merging. Failing lint in CI blocks deployment.

## Files
All modified: `src/element.js`, `src/runtime/index.js`, `src/runtime/providers.js`, `src/agent-protocol.js`, `src/CLAUDE.md`, `specs/EMBED_SPEC.md`

## Commands to run

```bash
# Format all changed files
npx prettier --write src/element.js src/runtime/index.js src/runtime/providers.js src/agent-protocol.js

# Check (don't auto-fix) — confirm no remaining issues
npx prettier --check src/element.js src/runtime/index.js src/runtime/providers.js

# If eslint is configured:
npx eslint src/element.js src/runtime/index.js src/runtime/providers.js
```

## Common issues to watch for

**Tabs vs spaces:** The project uses tabs (4-wide) per src/CLAUDE.md. All new code must use tabs, not spaces. Prettier should enforce this if `.prettierrc` is configured correctly.

**No trailing commas in function params:** Check the project's trailing comma preference.

**JSDoc format:** New `/** */` comments must use the project's JSDoc style (see existing methods for reference).

**Line length:** If the project has a line-length rule, the long CSS strings in BASE_STYLE may need wrapping.

## What to do

1. Run `npx prettier --write` on all changed files
2. Run `npx eslint` on all changed JS files
3. Fix any reported issues
4. Re-run to confirm zero errors

## Verification
```bash
npx prettier --check src/element.js src/runtime/index.js src/runtime/providers.js
# Output: All matched files use Prettier code style!
```
