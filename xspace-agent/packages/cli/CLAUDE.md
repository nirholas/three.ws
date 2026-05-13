# CLAUDE.md — packages/cli (@xspace/cli)

CLI tool for xspace-agent. Provides interactive setup, authentication, and Space joining from the terminal.

## Commands

```bash
npm run build   # tsc → dist/
npm run dev     # tsc --watch
npm run clean   # rm -rf dist
npm run test    # vitest run (no tests yet)
```

## CLI Usage

```bash
xspace-agent init                    # Interactive setup wizard → creates xspace.config.json
xspace-agent auth                    # Save X credentials to .env (token or username/password)
xspace-agent join <url>              # Join an X Space directly
  --provider <openai|claude|groq>    # Override AI provider
  --listen-only                      # Transcription only, no responses
  --browser <managed|connect>        # Browser mode
  --cdp-endpoint <ws://...>          # CDP WebSocket URL
  --cdp-port <9222>                  # CDP port for auto-discovery
xspace-agent start                   # Start server with admin panel
xspace-agent dashboard               # Launch dashboard only (no Space connection)

# Global options (all commands):
-c, --config <path>                  # Config file (default: xspace.config.json)
-p, --port <number>                  # Server port (default: 3000)
-v, --verbose                        # Debug logging
-q, --quiet                          # Errors only
--headless / --no-headless           # Browser visibility (default: headless)
```

## Module Map

```
src/
├── index.ts        Commander program definition + global pre-action hooks
├── config.ts       Config loading: CLI flags > file > env vars > defaults. Zod validation.
├── logger.ts       Colored console logging (debug/info/success/warn/error), verbose/quiet modes
├── paths.ts        Monorepo root resolution (walks up from __dirname looking for .git)
├── prompts.ts      Inquirer interactive prompts for init and auth
└── commands/
    ├── init.ts     Setup wizard → writes xspace.config.json (chmod 600)
    ├── auth.ts     Save X credentials to .env file
    ├── join.ts     Load config → create provider → join Space → STT/LLM/TTS loop
    ├── start.ts    Load config → require server.js → start Express
    └── dashboard.ts  Standalone Express server serving public/ static files
```

## Config Resolution Priority

1. CLI flags (highest)
2. Config file (`xspace.config.json`)
3. Environment variables (`.env`)
4. Defaults (lowest): openai/gpt-4o-mini, autoRespond=true, silenceThreshold=1.5s

## Dependencies

- `commander` — CLI framework
- `inquirer` — Interactive prompts
- `chalk` — Terminal colors
- `ora` — Spinners
- `dotenv` — .env loading
- `express` — Dashboard server
- `zod` — Schema validation (available but not yet used in source)

## Notes

- No tests exist yet. Test infrastructure is configured (vitest + coverage).
- The `join` command loads legacy modules (`x-spaces`, `createProvider`, `tts`) from the monorepo root via `resolveFromRoot()`.
- The `start` command requires `server.js` directly — the legacy monolithic server.
- Config files are written with `0o600` permissions. A warning is logged if config is world-readable.


