---
description: "Use when editing the @xspace/cli tool — Commander.js commands, config loading, interactive prompts."
applyTo: "packages/cli/**"
---
# CLI Package (packages/cli/)

Published as `@xspace/cli`. See `packages/cli/CLAUDE.md` for the module map.

## Commands

- `init` — Setup wizard → writes `xspace.config.json` (chmod 600)
- `auth` — Save X credentials to `.env`
- `join <url>` — Join an X Space with provider flags
- `start` — Start server with admin panel
- `dashboard` — Standalone dashboard server

## Patterns

- **Config precedence**: CLI flags > config file > env vars > defaults
- **Config validation**: Zod schemas in `src/config.ts`
- **Interactive prompts**: Inquirer in `src/prompts.ts`
- **Logging**: Colored console with verbose/quiet modes in `src/logger.ts`
- **Path resolution**: Walks up from `__dirname` looking for `.git` in `src/paths.ts`

## Rules

- New commands go in `src/commands/` using Commander.js
- Config files must be written with restrictive permissions (chmod 600) when containing credentials


