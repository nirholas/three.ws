---
description: "Use when editing the legacy server in src/ — migration context, architecture of the original monolith."
applyTo: "src/**"
---
# Legacy Server (src/)

**Status**: Being migrated into `packages/`. For new features, prefer `packages/core/`.

This code still works and powers the dev server (`pnpm dev`) and CLI `start` command.

## Architecture

- `src/server/` — Express + Socket.IO, routes, socket handlers, turn manager, provider factory
- `src/client/` — Browser client: Socket.IO + Web Audio API + WebRTC
- `src/browser/` — Puppeteer automation for X Spaces (being migrated to `packages/core/src/browser/`)
- `src/audio/` — Audio bridge, PCM capture, WAV encoding

## Rules

- Don't add new features here — implement in `packages/core/` instead
- Don't modify `server.js` (root) — it's the compiled legacy entry point
- Keep changes minimal: bug fixes and migration work only


