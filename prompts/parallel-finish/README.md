# Parallel Finish — 14 independent prompts to close the audit gaps

These prompts are designed to run **simultaneously in separate agent chats** with zero inter-task blocking. Each one:

- Creates only new files, OR edits a single file that no other prompt in this folder touches.
- Produces a self-contained deliverable. If any single prompt fails to complete, nothing else breaks.
- Never modifies shared files like [src/element.js](../../src/element.js), [src/app.js](../../src/app.js), [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js), or [public/dashboard/index.html](../../public/dashboard/index.html). Integration of these features into the main dashboard sidebar is a later merge step (see `zz-integration.md`).

## File ownership map (no overlaps)

| Prompt                             | Owns (create/edit)                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `01-siwe-csrf-hardening.md`        | `api/auth/siwe/verify.js`, `api/auth/siwe/nonce.js`                                       |
| `02-sessions-management.md`        | `api/auth/sessions/` (new), `public/dashboard/sessions.html` (new)                        |
| `03-privy-backend-verify.md`       | `api/auth/privy/` (new)                                                                   |
| `04-link-wallet-api.md`            | `api/auth/wallets/` (new), `public/dashboard/wallets.html` (new)                          |
| `05-first-meet-flow.md`            | `public/first-meet/` (new)                                                                |
| `06-selfie-progress-ui.md`         | `src/selfie-pipeline.js`, `src/selfie-capture.js`                                         |
| `07-avatar-agent-link.md`          | `api/avatars/index.js` (post-create hook only), `api/onboarding/link-avatar.js` (new)     |
| `08-artifact-bundle.md`            | `public/artifact/` (new), `vite.config.artifact.js` (new)                                 |
| `09-chat-plugin.md`             | `chat-plugin/` (new top-level package)                                                 |
| `10-reputation-ui.md`              | `public/reputation/` (new)                                                                |
| `11-validation-registry-deploy.md` | `contracts/script/DeployValidationMainnet.s.sol` (new), `docs/VALIDATION_DEPLOY.md` (new) |
| `12-hydrate-from-chain.md`         | `public/hydrate/` (new), `src/erc8004/hydrate.js` (new)                                   |
| `13-signed-action-log-ui.md`       | `public/dashboard/actions.html` (new)                                                     |
| `14-ipfs-pinning-real.md`          | `api/erc8004/pin.js`                                                                      |

## Running them

Open 14 agent chats. In each, paste the corresponding prompt as the first message. Run `npm run verify` when each finishes. Collect reports; merge serially.

## After all are done

Run `zz-integration.md` (written after these land) to wire the new standalone pages into the dashboard sidebar. That single final merge is NOT safe to run in parallel with the 14 — it intentionally touches `public/dashboard/index.html` and `public/dashboard/dashboard.js`.
