# Codex work orders

Bounded, mechanically verifiable work sized for Codex sessions, so Claude sessions stay free for
work that needs deep repo context. Each file is pasted whole into a fresh Codex session opened in
`/workspaces/three.ws`.

| Order | Scope | Done when |
|---|---|---|
| [02-i18n-lint-clean.md](02-i18n-lint-clean.md) | Fill missing and empty translation keys | `npm run i18n:lint` exits 0 |

Rules for Codex live in [AGENTS.md](../../AGENTS.md), which points at [CLAUDE.md](../../CLAUDE.md).
