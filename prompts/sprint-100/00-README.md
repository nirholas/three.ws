# Sprint-100 — Parallel-safe prompts to 100%

Every prompt in this folder is designed to run **in parallel** with every other prompt in this folder. No prompt depends on any other prompt completing. Each prompt owns a distinct set of files; where a shared file must be touched, the edit is surgical and additive.

## How to use

- Spin up one agent chat per `.md` file.
- Run them all at once. If one fails or stalls, the others still ship value.
- Each prompt reports what landed + what it skipped. Integration (wiring modules together in `src/app.js`, etc.) is a separate, later step — **do not** wire new modules into `src/app.js` from inside these prompts unless the prompt explicitly says so.

## House rules (every prompt)

1. **Own only the files listed under "Files you own"**. Treat everything else as read-only.
2. **No bundler / build-config changes**. No new runtime deps unless the prompt explicitly lists them.
3. **Prettier** (tabs, 4-wide, single quotes, 100-col) — run `npx prettier --write` on every file you touch.
4. **Verify**: `node --check <file>` on every JS file you modify, then `npm run build`. Paste both outputs into the report.
5. **Report** at the end: files changed, commands run, what you skipped, unrelated bugs noticed.
6. If a required upstream piece (endpoint, table, module) doesn't exist yet, **stub it** and note the stub in the report. Don't reach out of scope to build it.

## Map

| #   | Band | Title                         | Primary file(s)                          |
| --- | ---- | ----------------------------- | ---------------------------------------- |
| 01  | 1    | Wallet signin button          | `src/wallet-auth.js`                     |
| 02  | 1    | Session refresh + logout-all  | `api/auth/session/*`                     |
| 03  | 1    | Link/unlink wallet to account | `api/auth/wallet/*`                      |
| 04  | 2    | Camera capture module         | `src/camera-capture.js`                  |
| 05  | 2    | Avaturn client bridge         | `src/avaturn-client.js`                  |
| 06  | 2    | Agent naming form module      | `src/agent-naming.js`                    |
| 07  | 2    | First-meet celebration        | `src/first-meet.js`                      |
| 08  | 3    | Avatar PATCH endpoint         | `api/avatars/[id].js` (additive)         |
| 09  | 3    | Editor save button            | `src/editor/save-back.js`                |
| 10  | 3    | Avatar version history        | `api/avatars/[id]/versions.js`           |
| 11  | 4    | Share panel module            | `src/share-panel.js`                     |
| 12  | 4    | `agent-id` attribute resolver | `src/agent-3d-element.js`                |
| 13  | 5    | Claude.ai artifact bundle     | `public/artifact.js`                     |
| 14  | 5    | Idle animation loop           | `src/idle-animation.js`                  |
| 15  | 5    | Embed postMessage bridge      | `src/embed-host-bridge.js`               |
| 16  | 5    | LobeHub plugin manifest       | `public/.well-known/chat-plugin.json` |
| 17  | 6    | On-chain deploy button        | `src/erc8004/deploy-button.js`           |
| 18  | 6    | IPFS pinning endpoint         | `api/pinning/pin.js`                     |
| 19  | 6    | Address resolver API          | `api/agents/by-address/[addr].js`        |
| 20  | 6    | ENS name resolver             | `api/agents/ens/[name].js`               |
| 21  | 4    | OG/oEmbed polish              | `api/a-og.js` (additive)                 |
| 22  | 7    | CZ claim landing page         | `public/cz/`                             |
| 23  | 5    | Action passthrough bridge     | `src/embed-action-bridge.js`             |
| 24  | 5    | `@agent` suggest endpoint     | `api/agents/suggest.js`                  |
| 25  | 6    | Claim transfer flow           | `src/claim-transfer.js`                  |
