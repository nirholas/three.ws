# Build prompts — the real stack

Prompts in this directory are scoped to the product priority stack. If a prompt isn't here, it's not on the critical path. Ignore `prompts/embed/`, `prompts/pretext/`, `prompts/scalability/`, and `prompts/widget-studio/` unless explicitly asked — they rat-hole on secondary concerns.

## Priority stack (build in this order)

1. **Wallet auth** — user can sign in with MetaMask and have a real backend session. Largely shipped (2026-04-15); gap-fills in `01-*`.
2. **Selfie → agent** — take a photo, get a 3D avatar. The magic moment. `02-*`.
3. **Edit avatar** — swap, regenerate, tweak without destroying identity. `03-*`.
4. **View & embed** — agent page polish and iframe/oEmbed so the avatar can be shared. `04-*`.
5. **Host embed** — avatar lives inside Claude.ai Artifacts and Lobehub chat (user has a Lobehub fork — primary integration target). `05-*`.
6. **Onchain portability** — the agent is pulled *from chain* into any host. The novel unlock. `06-*`.

## Prompt file format

Each prompt is self-contained. An agent should be able to implement it without reading the others. Every prompt declares:

- **Why it matters** (one paragraph, tied to the stack)
- **What to build** (concrete files and behaviors)
- **Out of scope** (to prevent drift)
- **Acceptance** (verifiable)

## Rules for agents executing these prompts

- Do **not** add features, refactors, or abstractions beyond what's specified.
- Do **not** write tests unless explicitly required.
- Do **not** create documentation files unless explicitly required.
- If the spec conflicts with reality (file moved, dep missing, API changed), stop and report — don't improvise.
- If you finish early, stop. Don't find extra work.

## Sequencing

Pillars 1–3 are mostly sequential (auth → selfie → edit). Pillars 4–6 can proceed in parallel once 1–3 are solid.

Within a pillar, suffix numbers indicate sequence: `02-01-*` before `02-02-*`.

## Prompts

**Stack-wide**
- [00-stack-e2e-smoke.md](./00-stack-e2e-smoke.md) — end-to-end smoke script

**Pillar 1 — Wallet auth**
- [01-01-wallet-auth-smoke-test.md](./01-01-wallet-auth-smoke-test.md)
- [01-02-email-password-parity.md](./01-02-email-password-parity.md)
- [01-03-link-wallet-to-existing-account.md](./01-03-link-wallet-to-existing-account.md)
- [01-04-session-expiry-ux.md](./01-04-session-expiry-ux.md)

**Pillar 2 — Selfie → agent**
- [02-01-selfie-capture-ui.md](./02-01-selfie-capture-ui.md)
- [02-02-selfie-upload-r2.md](./02-02-selfie-upload-r2.md)
- [02-03-selfie-to-avatar-pipeline.md](./02-03-selfie-to-avatar-pipeline.md)
- [02-04-first-agent-landing.md](./02-04-first-agent-landing.md)

**Pillar 3 — Edit avatar**
- [03-01-avatar-swap.md](./03-01-avatar-swap.md)
- [03-02-avatar-regenerate.md](./03-02-avatar-regenerate.md)
- [03-03-edit-agent-metadata.md](./03-03-edit-agent-metadata.md)

**Pillar 4 — View & embed**
- [04-01-agent-public-page-polish.md](./04-01-agent-public-page-polish.md)
- [04-02-og-oembed.md](./04-02-og-oembed.md)
- [04-03-embed-reliability.md](./04-03-embed-reliability.md)
- [04-04-agent-card-json.md](./04-04-agent-card-json.md)

**Pillar 5 — Host embed**
- [05-01-claude-artifact-embed.md](./05-01-claude-artifact-embed.md)
- [05-02-lobehub-plugin.md](./05-02-lobehub-plugin.md)
- [05-03-mcp-spawn-agent-tool.md](./05-03-mcp-spawn-agent-tool.md)
- [05-04-postmessage-bridge-spec.md](./05-04-postmessage-bridge-spec.md)

**Pillar 6 — Onchain portability**
- [06-01-erc8004-mint-from-ui.md](./06-01-erc8004-mint-from-ui.md)
- [06-02-pin-card-to-ipfs.md](./06-02-pin-card-to-ipfs.md)
- [06-03-resolve-agent-from-chain.md](./06-03-resolve-agent-from-chain.md)
- [06-04-lobehub-onchain-import.md](./06-04-lobehub-onchain-import.md)
- [06-05-signed-action-log.md](./06-05-signed-action-log.md)
