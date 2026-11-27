# parity 09: remaining owner steps for the three-ws CLI

Re-checked 2026-11-14. The unscoped `three-ws` launcher package in `packages/three-ws/` (pins `@three-ws/cli@0.1.1`) is committed (2859eb153) and already on `threews/main`. `npx vitest run packages/three-ws/tests/launcher.test.js` passes 4/4, `npm pack --dry-run` builds a 4-file 5.0 kB tarball, and `@three-ws/cli@0.1.1` is live on npm.

## Done

1. Push: 2859eb153 is on `threews/main`.
2. Deploy: no deploy is needed for the launcher. The `npx three-ws setup` hint in `api/_mcp/auth.js` dates from 2026-09-22 and has gone out in earlier deploys.

## Remaining (owner only: needs the owner's npm account)

3. `cd packages/three-ws && npm login && npm publish --access public`. The name `three-ws` is still unclaimed on npm (404 on 2026-11-14), there is no npm token on the dev machine or in GCP Secret Manager, and `npm whoami` is unauthenticated, so an agent cannot do this step. The first publish of a new name sits behind a 0.0.0-stage hold for a few minutes; wait for it to clear.
4. Verify: `npx three-ws --version` prints 0.1.1, then `npm run smoke:prod`.

Close out: when 3 and 4 pass, `git rm` this file in its own commit and log it in `_context/parity-PROGRESS.md`.
