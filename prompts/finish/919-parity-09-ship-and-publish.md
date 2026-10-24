# parity 09: remaining owner steps for the three-ws CLI

Trimmed 2026-10-23. Built and committed: the unscoped `three-ws` launcher package in `packages/three-ws/` (pins `@three-ws/cli@0.1.1`, 4 tests passing). What remains is owner-gated (CLAUDE.md gate 2: push, deploy, publish).

## Remaining

1. `git push threews main` (owner approval).
2. Deploy per the `deploy-runbook` skill (`npm run deploy:gcp:full`).
3. `cd packages/three-ws && npm login && npm publish --access public`. The first publish of a new name sits behind a 0.0.0-stage hold for a few minutes; wait for it to clear.
4. Verify: `npx three-ws --version` prints 0.1.1, then `npm run smoke:prod`.

Close out: when 1 to 4 pass, `git rm` this file in its own commit and log it in `_context/parity-PROGRESS.md`.
