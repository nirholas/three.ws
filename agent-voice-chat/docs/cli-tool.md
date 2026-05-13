# Prompt: CLI Tool

## Why
A CLI is the fastest path from "I found this project" to "I'm using it." Zero code required.

```bash
npx xspace-agent join https://x.com/i/spaces/1abc... --provider claude
```

That one-liner in a README is worth more than 10 pages of documentation.

## Commands

### `xspace-agent init`
Interactive setup wizard:
```
$ npx xspace-agent init

  🎙️  X Space Agent — Setup

  ? AI Provider: (use arrows)
    ❯ OpenAI (gpt-4o-mini)
      Claude (claude-sonnet)
      Groq (llama-3.3-70b)

  ? OpenAI API Key: sk-...
  ? System prompt: You are a helpful AI agent...
  ? TTS Provider:
    ❯ OpenAI TTS (built-in, no extra key)
      ElevenLabs (premium voices)
      Browser (free, lower quality)

  ? X Auth Token: (paste from browser DevTools)

  ✅ Config saved to ./xspace.config.json
  Run: npx xspace-agent start
```

Generates `xspace.config.json`:
```json
{
  "$schema": "https://unpkg.com/xspace-agent/config-schema.json",
  "ai": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "systemPrompt": "You are a helpful AI agent..."
  },
  "voice": {
    "provider": "openai"
  },
  "auth": {
    "cookiePath": "./.cookies.json"
  },
  "behavior": {
    "autoRespond": true,
    "silenceThreshold": 1.5
  }
}
```

### `xspace-agent auth`
Interactive X login:
```
$ npx xspace-agent auth

  ? Login method:
    ❯ Paste auth_token (easiest)
      Login with username/password
      Import cookies from browser

  ? auth_token: 2b66fc63cc...

  ✅ Authenticated as @yourusername
  Cookies saved to ./.cookies.json
```

### `xspace-agent start`
Start with admin panel:
```
$ npx xspace-agent start

  🎙️  X Space Agent running
  Admin panel: http://localhost:3000/admin
  Dashboard:   http://localhost:3000

  Waiting for Space URL...
```

### `xspace-agent join <url>`
Join a Space directly (no admin panel):
```
$ npx xspace-agent join https://x.com/i/spaces/1abc...

  🎙️  Launching browser...
  ✅ Logged in as @yourusername
  ✅ Joined Space: "Crypto Morning Show"
  🎤 Listening... (Ctrl+C to leave)

  [@host]: Welcome everyone to the show
  [Agent]: Thanks for having me! Great to be here.
  [@user1]: What do you think about ETH?
  [Agent]: ETH is showing strong momentum...
```

### `xspace-agent join <url> --listen-only`
Join but only transcribe (no AI responses):
```
$ npx xspace-agent join https://x.com/i/spaces/1abc... --listen-only

  📝 Transcription mode (listen only)

  [@host]: Welcome to the Space
  [@user1]: Hey everyone
  [@user2]: What's the topic today?
```

### `xspace-agent dashboard`
Launch just the web dashboard without joining a Space:
```
$ npx xspace-agent dashboard --port 8080
  Dashboard: http://localhost:8080
```

## CLI Architecture

```
packages/cli/
├── src/
│   ├── index.ts              ← Entry point, command registration
│   ├── commands/
│   │   ├── init.ts           ← Interactive setup wizard
│   │   ├── auth.ts           ← X authentication
│   │   ├── start.ts          ← Start with admin panel
│   │   ├── join.ts           ← Direct Space join
│   │   └── dashboard.ts      ← Web dashboard only
│   ├── config.ts             ← Config file loader (xspace.config.json + env vars)
│   ├── logger.ts             ← Pretty terminal output with colors
│   └── prompts.ts            ← Interactive prompts (inquirer)
├── package.json
└── bin/
    └── xspace-agent          ← #!/usr/bin/env node entry
```

## Dependencies
```json
{
  "dependencies": {
    "xspace-agent": "workspace:*",
    "commander": "^12.0.0",
    "inquirer": "^9.0.0",
    "chalk": "^5.0.0",
    "ora": "^8.0.0"
  },
  "bin": {
    "xspace-agent": "./bin/xspace-agent"
  }
}
```

## Config Resolution Order
1. CLI flags (highest priority)
2. `xspace.config.json` in current directory
3. `.env` file in current directory
4. Environment variables
5. Defaults

```typescript
function resolveConfig(cliFlags: Partial<AgentConfig>): AgentConfig {
  const fileConfig = loadConfigFile('./xspace.config.json')
  const envConfig = loadEnvConfig()
  const defaults = getDefaults()

  return deepMerge(defaults, envConfig, fileConfig, cliFlags)
}
```

## Global Options
```
--config, -c <path>    Path to config file (default: ./xspace.config.json)
--port, -p <number>    Server port (default: 3000)
--verbose, -v          Enable debug logging
--headless             Run browser headless (default: true)
--no-headless          Show browser window (for debugging)
--quiet, -q            Suppress all output except errors
```

## Implementation Steps
1. Set up `packages/cli/` with Commander.js
2. Implement `init` command with Inquirer prompts
3. Implement config file loader with schema validation
4. Implement `auth` command wrapping core's auth module
5. Implement `join` command wrapping core's XSpaceAgent
6. Implement `start` command wrapping server package
7. Add pretty logging with chalk + ora spinners
8. Test `npx` execution
9. Add to monorepo build pipeline

## Validation
- [ ] `npx xspace-agent init` creates valid config file
- [ ] `npx xspace-agent auth` successfully authenticates
- [ ] `npx xspace-agent join <url>` joins Space and responds
- [ ] `npx xspace-agent start` launches admin panel
- [ ] Config file + env vars + CLI flags all work together
- [ ] `--help` shows clear usage information
- [ ] Ctrl+C gracefully leaves Space and cleans up


