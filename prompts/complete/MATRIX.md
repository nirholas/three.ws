# Parallel-safety Matrix

Each prompt lists its owned files. No two prompts may write to the same file. Shared reads are fine.

| File / dir                                | Owner |
| ----------------------------------------- | ----- |
| `src/auth/walletconnect-bridge.js`        | 01    |
| `src/auth/walletconnect-bridge.test.html` | 01    |
| `specs/EDITOR_SPEC.md`                    | 02    |
| `api/artifact.js`                         | 03    |
| `public/artifact/`                        | 03    |
| `public/lobehub/`                         | 04    |
| `api/lobehub/handshake.js`                | 04    |
| `api/lobehub/manifest.js`                 | 04    |
| `public/reputation/`                      | 05    |
| `src/reputation-ui.js`                    | 05    |
| `public/validation/`                      | 06    |
| `src/validation-ui.js`                    | 06    |
| `api/avatars/regenerate.js`               | 07    |
| `src/editor/regenerate-panel.js`          | 07    |
| `api/agents/register-prep.js`             | 08    |
| `public/cz/`                              | 09    |
| `src/cz-flow.js`                          | 09    |
| `docs/CZ_DEMO_RUNBOOK.md`                 | 10    |
| `scripts/cz-demo/runbook.sh`              | 10    |
| `public/agents/`                          | 11    |
| `src/agents-directory.js`                 | 11    |

## Read-only (shared) modules — do not modify

- `src/erc8004/*` — ABIs, registration helpers, queries.
- `src/agent-*.js` — runtime (protocol, identity, memory, avatar, home).
- `api/_lib/*` — db, http, auth, cors, limits.
- `api/auth/siwe/*` — SIWE endpoints (prompt 01 consumes nonce + verify only).
- `src/account.js` — auth hint helpers.
- `src/manifest.js` — agent manifest loader.
- `contracts/*` — Solidity sources + deployment scripts (read-only; do not edit ABIs).

## Files no one may edit

- `vite.config.js` — if your prompt needs a route, create it under `public/<name>/index.html` so it's served by default. If you truly need a top-level file rewrite, stop and report.
- `vercel.json` — same rule.
- `package.json` — no new deps unless the prompt explicitly says so.
- `.env.example` — document any new env vars in your prompt's README instead.
