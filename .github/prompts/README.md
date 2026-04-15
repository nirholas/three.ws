# Prompts

Task specs for agents working on 3D Agent. Each prompt is a self-contained brief: problem, implementation steps, validation, and what **not** to do.

Prompts are prioritized by the product stack from [memory/project_vision.md](../../.. /home/codespace/.claude/projects/-workspaces-3D/memory/project_vision.md). When in doubt, work the lowest-numbered unfinished `stack-*` prompt first.

## Priority stack prompts

### Layer 1 — Wallet auth 100%
- [stack-01-siwe-wallet-login.md](stack-01-siwe-wallet-login.md)
- [stack-02-privy-unified-auth.md](stack-02-privy-unified-auth.md)
- [stack-03-auth-session-recovery.md](stack-03-auth-session-recovery.md)
- [stack-04-auth-error-ux.md](stack-04-auth-error-ux.md)

### Layer 2 — Selfie → agent creation (the magic moment)
- [stack-05-selfie-capture.md](stack-05-selfie-capture.md)
- [stack-06-face-to-avatar-backend.md](stack-06-face-to-avatar-backend.md)
- [stack-07-avatar-creation-progress.md](stack-07-avatar-creation-progress.md)
- [stack-08-avatar-save-and-slug.md](stack-08-avatar-save-and-slug.md)
- [stack-28-first-run-tour.md](stack-28-first-run-tour.md) (onboarding)
- [stack-29-biometric-consent.md](stack-29-biometric-consent.md) (legal, ship with stack-05)

### Layer 3 — Edit avatar
- [stack-09-avatar-editor-shell.md](stack-09-avatar-editor-shell.md)
- [stack-10-avatar-identity-tab.md](stack-10-avatar-identity-tab.md)
- [stack-11-avatar-skills-tab.md](stack-11-avatar-skills-tab.md)
- [stack-12-avatar-memory-seed.md](stack-12-avatar-memory-seed.md)
- [stack-13-avatar-animation-tab.md](stack-13-avatar-animation-tab.md)
- [stack-14-avatar-mesh-replace.md](stack-14-avatar-mesh-replace.md)

### Layer 4 — View + embed
- [stack-15-agent-public-page.md](stack-15-agent-public-page.md)
- [stack-16-embed-code-generator.md](stack-16-embed-code-generator.md)
- [stack-17-kiosk-mode-polish.md](stack-17-kiosk-mode-polish.md)
- [stack-18-embed-telemetry.md](stack-18-embed-telemetry.md)
- [stack-27-agents-gallery.md](stack-27-agents-gallery.md) (discovery)

### Layer 5 — Embed in Claude.ai & LobeHub (the novel integration)
- [stack-19-artifacts-single-file.md](stack-19-artifacts-single-file.md)
- [stack-20-lobehub-plugin.md](stack-20-lobehub-plugin.md)
- [stack-21-host-chat-bridge.md](stack-21-host-chat-bridge.md)
- [stack-22-mcp-embodied-responses.md](stack-22-mcp-embodied-responses.md)

### Layer 6 — Onchain portable identity (the novel unlock)
- [stack-23-manifest-to-ipfs.md](stack-23-manifest-to-ipfs.md)
- [stack-24-onchain-identity-register.md](stack-24-onchain-identity-register.md)
- [stack-25-hydrate-from-chain.md](stack-25-hydrate-from-chain.md)
- [stack-26-signed-action-log.md](stack-26-signed-action-log.md)

## Side tasks (lower priority — do NOT rat-hole on these while stack is broken)

Existing viewer/feature prompts: ai-model-analysis, ar-quick-look, cli-tool, material-editor, measurement-tools, scene-graph-explorer, screenshot-video-export, side-by-side-diff, texture-inspector, file-format-expansion, add-tests, complete-mcp-tools.

## Stale — do not use

These describe work already done or targeting deleted files:
- ai-chat-agent.md (targets deleted src/avaturn-agent.js)
- cleanup-dead-code.md (already applied)
- create-agent-card.md (file now exists)
- fix-security-xss.md (already fixed)
- fix-validator-lightbox.md (already fixed)
- deploy-erc8004-contracts.md (contracts deployed)
- complete-openapi-spec.md (spec fully documented)
- update-docs.md (references deleted files)

## How to use a prompt

1. Read the prompt top to bottom.
2. Confirm against [CLAUDE.md](../../CLAUDE.md) — zero-dep, native DOM, tabs, reuse auth helpers.
3. Ship the prompt's scope and nothing more. "Do not do this" sections are load-bearing.
4. Verify via the prompt's Validation checklist before declaring done.
