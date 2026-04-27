# Embed & share task prompts

Self-contained prompt files for follow-up work on the "share/embed any agent avatar" feature. Each file is designed to be dropped into a fresh Claude Code agent prompt without extra context.

## What already exists (do not redo)

- Route `/agent/:id/embed` → [public/agent/embed.html](../../public/agent/embed.html) — bare 3D avatar, empathy layer, transparent-bg capable, `postMessage` bridge.
- Share panel on [public/agent/index.html](../../public/agent/index.html) — three tabs (iframe / link / `<agent-3d>`) with a copy button.
- Web component `<agent-3d>` in [src/element.js](../../src/element.js) — currently requires a manifest URL via `src="..."`.
- Avatar fetch: `GET /api/avatars/:id` returns `{ avatar: { url, ... } }` — the `url` is the GLB.
- Identity fetch: `AgentIdentity.load()` from [src/agent-identity.js](../../src/agent-identity.js) resolves agent record by id, exposes `avatarId`, `name`, `description`, `skills`, `walletAddress`.

## Tasks — designed to run in parallel

All three tasks can run simultaneously in separate chats. File ownership is disjoint except for `vercel.json` (each task adds routes in a distinct block, so git merges cleanly).

| Task                                                 | What it ships                                                                                        | File ownership                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [01-og-oembed.md](./01-og-oembed.md)                 | Link unfurls — OG image + oembed endpoint so pasted `/agent/:id` links preview on Slack/X/Discord    | owns `api/agent-og.js`, `api/agent-oembed.js`; edits `<head>` of `public/agent/index.html` + `vercel.json`   |
| [02-agent-id-resolver.md](./02-agent-id-resolver.md) | Native `<agent-three.ws-id="...">` attribute so the web-component embed works without a manifest URL | owns `src/agent-resolver.js`; edits `src/element.js` only                                                    |
| [03-embed-allowlist.md](./03-embed-allowlist.md)     | Per-agent embed referrer allowlist + dashboard UI for owners to gate where their avatar renders      | owns `api/agents/[id]/embed-policy.js`, new dashboard panel; edits `public/agent/embed.html` + `vercel.json` |

## Rules that apply to all tasks

- No new runtime dependencies (devDeps only if strictly needed for the task).
- No new docs files (no README.md, no CLAUDE.md) unless explicitly stated in the task.
- `node --check` every modified JS file before reporting done.
- Run `npx vite build` and note whether the build breaks. Pre-existing `@avaturn/sdk` resolution error in `src/avatar-creator.js` is unrelated — ignore it.
- Respect file ownership in the table above. If you need to touch a file outside your ownership, stop and report instead — another task may be editing it.
- For `vercel.json` edits, add routes in the block indicated by your task (task 01 puts them near the `/api/agent-*` group; task 03 puts them with `/api/agents/...` group). Do not reorder existing routes.
- If you discover an unrelated bug during your task, note it in the reporting section. Do not fix it in the same change.

## Reporting

Each task ends with a short report of: files created, files edited, files checked, manual test URLs to hit, and any surprises.
