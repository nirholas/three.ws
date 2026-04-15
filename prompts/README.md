# Build prompts — priority stack

Self-contained task prompts for building the 3D Agent platform toward the **CZ demo**: a user (starting with CZ) signs in with their wallet, sees their own embodied avatar agent, can embed it into LobeHub / Claude, and its identity lives onchain.

Each file is designed to be dropped into a fresh Claude Code agent without extra context.

## The priority stack (build in this order)

| Layer | Directory | Ship state |
|---|---|---|
| 1. Wallet auth 100% | [wallet-auth/](./wallet-auth/) | Foundation. SIWE login + link-to-user + fix `/api/agents/me` 500. |
| 2. Selfie → agent | [selfie-agent/](./selfie-agent/) | The magic moment — photo capture becomes a personal avatar. |
| 3. Edit avatar | [avatar-edit/](./avatar-edit/) | Post-creation morph / outfit / accessory editing. |
| 4. View + embed | existing `/agent/:id` + [embed/](./embed/) | Mostly working. Polish prompts exist in `embed/`. |
| 5. Claude / LobeHub embed | [lobehub-embed/](./lobehub-embed/), [claude-artifact/](./claude-artifact/) | Agent renders embodied inside host chats. Primary integration target. |
| 6. Onchain | [onchain/](./onchain/) | Deploy ERC-8004 contracts, register, hydrate agent from chain. |
| 🎯 CZ demo | [cz-demo/](./cz-demo/) | Bespoke landing + pre-registered cz.glb onchain + scripted first interaction. |

## Side lanes (not blockers for CZ demo)

Do not open these while anything in the priority stack above is broken:

- [pretext/](./pretext/) — hero text / dragon / gaze-follow polish
- [scalability/](./scalability/) — dispose / render-on-demand / module-split
- [widget-studio/](./widget-studio/) — turntable, animation gallery, passport, hotspot tour
- [embed/03-embed-allowlist.md](./embed/03-embed-allowlist.md) — referrer allowlist

## Rules that apply to every task

- No new runtime dependencies unless the task file explicitly allows them.
- No new docs (README.md, CLAUDE.md) unless the task says so.
- `node --check` every modified JS file before reporting done.
- `npx vite build` and report the result. The pre-existing `@avaturn/sdk` resolution warning is unrelated — ignore.
- Respect `Files off-limits` sections — other tasks may be editing them.
- If you discover an unrelated bug, note it in your report. Do not fix it in the same change.
- Stay on one task end-to-end. Do not silently hop to adjacent concerns.

## Reporting

Each task ends with a short report: files created, files edited (which sections), commands run and their output, manual verification URLs, any surprises.
