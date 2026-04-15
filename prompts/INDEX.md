# Priority Stack — Dispatch Index

The **only** goal. Six bands, in order. Everything else is secondary until these ship.

1. **Wallet auth, 100%** — SIWE end-to-end. A user can sign in with MetaMask / Privy / WalletConnect and stay signed in. No email required.
2. **Selfie → agent** — User takes a photo in-browser; we return a rigged 3D avatar bound to their identity.
3. **Edit avatars** — Material/texture/scene editing on an existing avatar (partially shipped), plus regenerate-from-photo and variants.
4. **View + embed** — Public viewer and embeddable snippet (partially shipped); polish, share flow, and per-agent settings.
5. **Portable embed (Claude.ai + LobeHub)** — The agent shows up *inside* a chat surface looking embodied, not as JSON.
6. **On-chain deployment** — Agent identity lives on-chain; any host (LobeHub, Claude) can summon the same avatar from the address alone.

## Dispatch order

Each band is a folder. Prompts inside a band can run in parallel unless they touch the same file.

- [wallet-auth/](./wallet-auth/) — band 1
- [selfie-onboarding/](./selfie-onboarding/) — band 2
- [avatar-editing/](./avatar-editing/) — band 3
- [portable-embed/](./portable-embed/) — band 4 (view + embed polish)
- [claude-lobehub/](./claude-lobehub/) — band 5 (chat-surface integration)
- [onchain/](./onchain/) — band 6

Don't skip bands. Band 2 depends on band 1 (we need to know *who* owns the agent before generating one). Band 5 depends on band 4 (embed must work on a regular page before it works inside Claude). Band 6 depends on band 1 (wallet = onchain identity).

## House rules for every prompt

- One deliverable per prompt, one PR per prompt.
- No scope creep. If something outside the prompt needs fixing, note it in the reporting section — do not fix it.
- Cite exact file paths and line numbers. Don't invent APIs; read the existing code.
- Prefer editing existing files to creating new ones.
- Test path: `node --check` the new JS, `npx vite build`, then manual smoke.
- Output a reporting block at the end: what shipped, what was skipped, what broke, unrelated bugs noticed.

## What's already shipped (don't redo)

- `src/editor/*` — material editor, scene explorer, texture inspector (see `.github/prompts/material-editor.md`, `scene-graph-explorer.md`, `texture-inspector.md`)
- `api/mcp.js` — MCP tools including `validate_model`, `inspect_model`, `optimize_model`
- `api/_lib/fetch-model.js` — SSRF-hardened URL fetcher
- `public/.well-known/agent-card.json` — A2A discovery with 8 skills
- `src/erc8004/agent-registry.js` — wallet connect via Privy / injected provider (used for ERC-8004 registration, *not yet* for user auth)
- `src/agent-identity.js`, `src/agent-memory.js`, `src/agent-protocol.js`, `src/agent-avatar.js`, `src/agent-home.js` — the agent runtime (Empathy Layer etc.)

## What we are NOT prioritizing right now

- Pretext rebrand (`prompts/pretext/`) — shipped / shelved
- Widget studio (`prompts/widget-studio/`) — secondary
- Scalability (`prompts/scalability/`) — revisit when traffic shape is known
- Embed referrer allowlist (`prompts/embed/03-embed-allowlist.md`) — nice-to-have, not core
- CLI tool, AR quick-look, side-by-side diff, screenshot export — all secondary

Agents should not start those without explicit user direction.
