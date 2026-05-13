> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Branding, Landing Page & Launch Strategy

## Why
The best open-source projects are **brands**, not repos. Puppeteer has a logo. Playwright has a docs site. Langchain has a community. You need the same.

## Project Name
The npm package name matters. It needs to be:
- Short (1-2 words)
- Memorable
- Available on npm
- Descriptive enough to guess what it does

Candidates:
- `xspace-agent` — descriptive, clear
- `spacebot` — short, catchy
- `voxspace` — "vox" = voice, unique
- `spacevoice` — self-explanatory
- `twitterspace` — SEO-friendly but long

**Pick one. Register it on npm immediately** (`npm publish --access public` with a placeholder package.json).

## Logo
A simple, recognizable mark. Think:
- A microphone icon with a speech bubble
- A waveform inside a space/circle
- An AI face with headphones

Use a tool like Figma or commission on Fiverr. Need:
- SVG for docs site
- PNG 128x128 for npm
- PNG 1200x630 for social sharing (og:image)

## README Structure (Critical for Stars)

The README is your landing page. GitHub visitors decide in **5 seconds** whether to star or leave.

```markdown
<p align="center">
  <img src="logo.svg" width="120" />
</p>

<h1 align="center">X Space Agent</h1>
<p align="center">
  <b>AI agents that join and talk in X/Twitter Spaces</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/xspace-agent"><img src="https://img.shields.io/npm/v/xspace-agent" /></a>
  <a href="https://github.com/org/xspace-agent/actions"><img src="https://github.com/org/xspace-agent/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://discord.gg/YOUR_INVITE_CODE"><img src="https://img.shields.io/discord/YOUR_SERVER_ID?color=5865F2&logo=discord&label=Discord" /></a>
  <a href="https://github.com/org/xspace-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

<p align="center">
  <a href="https://xspace-agent.dev">Docs</a> •
  <a href="https://xspace-agent.dev/guide/getting-started">Getting Started</a> •
  <a href="https://discord.gg/YOUR_INVITE_CODE">Discord</a> •
  <a href="https://xspace-agent.dev/examples">Examples</a>
</p>

---

## What is this?

X Space Agent is a TypeScript SDK that lets you build AI agents that autonomously join, listen, and speak in X/Twitter Spaces. 12 lines to ship an agent. Bring any AI model.

\```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN },
  ai: { provider: 'openai', systemPrompt: 'You are a helpful AI.' },
  voice: { provider: 'elevenlabs', voiceId: 'your-voice' }
})

await agent.join('https://x.com/i/spaces/...')
\```

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider** | OpenAI, Claude, Groq, or bring your own model |
| **Real-Time Audio** | Bidirectional audio bridge — hears speakers, speaks back |
| **Multi-Agent** | Run teams of AI personalities with turn management |
| **Middleware** | Hook into any pipeline stage (STT, LLM, TTS) |
| **CLI** | `npx xspace-agent join <url>` — zero code needed |
| **Admin Panel** | Web dashboard to control agents in real-time |
| **Custom Providers** | Ollama, vLLM, any OpenAI-compatible API |
| **TypeScript** | Full type safety and autocomplete |

## Quick Start

\```bash
npm install xspace-agent
\```

[→ Full getting started guide](https://xspace-agent.dev/guide/getting-started)

## Examples

- [Basic join](examples/basic-join/) — Hello world
- [Transcription logger](examples/transcription-logger/) — Record Space conversations
- [Multi-agent debate](examples/multi-agent-debate/) — Two AIs arguing
- [Custom provider (Ollama)](examples/custom-provider/) — Local LLM
- [Discord bridge](examples/discord-bridge/) — Control from Discord
- [Express integration](examples/express-integration/) — Embed in your app

[→ All examples](https://xspace-agent.dev/examples)

## Architecture

\```
Space Audio → STT → LLM → TTS → Space Audio
                ↑           ↑
            Middleware   Middleware
\```

[→ Architecture deep dive](https://xspace-agent.dev/advanced/architecture)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © 2026
```

## Landing Page (Optional but High Impact)
A single-page site at `xspace-agent.dev`:

```
┌─────────────────────────────────────────────┐
│  [Logo] X Space Agent        [GitHub] [Docs]│
├─────────────────────────────────────────────┤
│                                             │
│     AI agents that join and talk            │
│     in X/Twitter Spaces                     │
│                                             │
│     [Get Started]  [View on GitHub]         │
│                                             │
│     ┌─ code example with syntax highlight ─┐│
│     │ const agent = new XSpaceAgent({...}) ││
│     └──────────────────────────────────────┘│
│                                             │
│  ── Features ──                             │
│  [icon] Multi-Provider  [icon] Real-Time    │
│  [icon] Multi-Agent     [icon] Middleware   │
│  [icon] CLI             [icon] TypeScript   │
│                                             │
│  ── Demo Video ──                           │
│  [Embedded video: agent joining a Space]    │
│                                             │
│  ── Trusted By ──                           │
│  [logos of projects/people using it]        │
│                                             │
│  All Rights Reserved • GitHub • Discord • npm       │
└─────────────────────────────────────────────┘
```

Can be the VitePress docs site itself (index.md hero layout covers this).

## Launch Strategy

### Week -2: Prep
- [ ] README polished with badges, hero code, feature table
- [ ] Docs site deployed
- [ ] npm package published (even if 0.1.0)
- [ ] 3+ working examples in repo
- [ ] Demo video recorded (screen recording of agent joining Space)
- [ ] Discord server created

### Week -1: Seed
- [ ] Tweet thread from your account: "I built an open-source SDK that..."
- [ ] DM 5-10 people in AI/crypto Twitter who would find this useful
- [ ] Post in relevant Discord servers (AI, Web3, TypeScript communities)

### Launch Day
- [ ] Post to Hacker News (Show HN: X Space Agent — AI agents that join Twitter Spaces)
- [ ] Post to r/programming, r/node, r/MachineLearning
- [ ] Tweet with demo video
- [ ] Product Hunt launch (optional but great for visibility)
- [ ] Dev.to blog post: "How I built an AI that talks in Twitter Spaces"

### Week +1: Sustain
- [ ] Respond to every GitHub issue within 24h
- [ ] Respond to every HN comment
- [ ] Ship fixes for bugs people report
- [ ] Tweet about interesting use cases

### Ongoing
- [ ] Ship one improvement per week (keeps project visible on GitHub trending)
- [ ] Retweet/share anyone who uses the project
- [ ] Write a "v0.2.0" blog post with new features

## Community Setup

### Discord Server
```
#announcements  — release notes, updates
#general         — discussion
#help            — support questions
#showcase        — "here's what I built"
#feature-requests
#contributors
```

### GitHub Setup
- Issue templates: Bug Report, Feature Request
- PR template
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- SECURITY.md (for reporting vulnerabilities)
- Discussions enabled (GitHub Discussions)

## Implementation Steps
1. Decide on project name, register npm package
2. Create logo (or commission one)
3. Write the README following the template above
4. Set up Discord server
5. Create GitHub issue/PR templates
6. Record demo video
7. Deploy docs site
8. Write launch blog post
9. Execute launch plan

## Validation
- [ ] README renders beautifully on GitHub
- [ ] npm package is published and installable
- [ ] Docs site is live
- [ ] Discord invite link works
- [ ] Demo video shows end-to-end flow
- [ ] At least 3 examples run out of the box


