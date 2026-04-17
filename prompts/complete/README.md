# Completion Sprint — Parallel Prompts

11 self-contained prompts designed to push every priority band toward 100%. **All can be run in parallel** — each prompt owns a distinct set of files. If one fails or stalls, the others still merge cleanly.

## Why these files don't collide

Each prompt only creates new files under a unique path, or edits exactly one file that no sibling prompt touches. The conflict matrix is in [MATRIX.md](MATRIX.md).

## Prompts

| #   | Title                                                                  | Band    | Primary output                                                |
| --- | ---------------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| 01  | [WalletConnect SIWE bridge](01-walletconnect-siwe.md)                  | 1       | `src/auth/walletconnect-bridge.js`                            |
| 02  | [EDITOR_SPEC spec doc](02-editor-spec.md)                              | 3, 4    | `specs/EDITOR_SPEC.md`                                        |
| 03  | [Claude.ai artifact HTML](03-claude-artifact.md)                       | 5       | `api/artifact.js`, `public/artifact/`                         |
| 04  | [LobeHub plugin manifest + handshake](04-lobehub-plugin.md)            | 5       | `public/lobehub/`, `api/lobehub/*`                            |
| 05  | [Reputation dashboard UI](05-reputation-dashboard.md)                  | 6       | `public/reputation/`, `src/reputation-ui.js`                  |
| 06  | [Validation dashboard UI](06-validation-dashboard.md)                  | 6       | `public/validation/`, `src/validation-ui.js`                  |
| 07  | [Avatar regenerate endpoint + UI](07-avatar-regenerate.md)             | 3       | `api/avatars/regenerate.js`, `src/editor/regenerate-panel.js` |
| 08  | [Server-side registration prep endpoint](08-register-prep-endpoint.md) | 6       | `api/agents/register-prep.js`                                 |
| 09  | [CZ landing + claim flow](09-cz-landing-claim.md)                      | cz-demo | `public/cz/`, `src/cz-flow.js`                                |
| 10  | [CZ demo runbook](10-cz-runbook.md)                                    | cz-demo | `docs/CZ_DEMO_RUNBOOK.md`                                     |
| 11  | [Public agents directory](11-agents-directory.md)                      | 4, 6    | `public/agents/`, `src/agents-directory.js`                   |

## House rules

- ESM only, tabs (4-wide), single quotes, vhtml JSX, JSDoc for public APIs.
- `node --check` every JS file modified. `npm run build` before reporting done.
- Reporting block at the end: files touched, commands run, what was skipped.
- **Do not** edit files outside your prompt's "Files you own" list. If you need to, stop and report.
- **Never** run `forge script --broadcast` or any tx-broadcasting command.
