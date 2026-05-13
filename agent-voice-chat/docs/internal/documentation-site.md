> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Documentation Site

## Why
A project with a docs site looks professional. A project with only a README looks like a weekend hack. Docs sites are also the #1 way people evaluate whether to adopt a project.

## Tool: VitePress
Lightweight, fast, Markdown-based, great for TypeScript projects. Ships as static HTML (free hosting on GitHub Pages, Vercel, or Netlify).

## Site Structure

```
docs/
├── .vitepress/
│   └── config.ts              ← VitePress configuration
├── index.md                   ← Landing page (hero + features)
├── guide/
│   ├── getting-started.md     ← 5-minute quickstart
│   ├── installation.md        ← npm, Docker, from source
│   ├── configuration.md       ← All config options explained
│   ├── authentication.md      ← How to get X auth tokens
│   ├── providers.md           ← AI provider setup (OpenAI, Claude, Groq)
│   ├── custom-providers.md    ← Building your own provider
│   ├── multi-agent.md         ← AgentTeam usage
│   ├── middleware.md           ← Pipeline hooks/middleware
│   └── deployment.md          ← Docker, Railway, VPS
├── api/
│   ├── agent.md               ← XSpaceAgent class reference
│   ├── team.md                ← AgentTeam class reference
│   ├── config.md              ← Configuration types reference
│   ├── events.md              ← All events reference
│   ├── rest-api.md            ← REST API reference
│   └── websocket-api.md       ← WebSocket API reference
├── examples/
│   ├── index.md               ← Examples overview
│   ├── basic-join.md
│   ├── transcription.md
│   ├── multi-agent-debate.md
│   ├── custom-provider.md
│   ├── discord-bridge.md
│   └── express-integration.md
├── advanced/
│   ├── architecture.md        ← How it works internally
│   ├── audio-pipeline.md      ← Deep dive into audio bridge
│   ├── browser-automation.md  ← Puppeteer/stealth details
│   └── troubleshooting.md     ← Common issues + solutions
└── public/
    ├── logo.svg
    └── og-image.png
```

## Key Pages

### Landing Page (index.md)
```markdown
---
layout: home
hero:
  name: X Space Agent
  text: AI agents that join and talk in X Spaces
  tagline: Ship an autonomous AI participant in 12 lines of code
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/your-org/xspace-agent
features:
  - icon: 🤖
    title: Multi-Provider AI
    details: OpenAI, Claude, Groq, or bring your own model. Switch providers with one line.
  - icon: 🎙️
    title: Real-Time Audio Pipeline
    details: Bidirectional audio bridge captures Space speakers and injects AI responses with natural voice.
  - icon: 🔌
    title: Middleware Hooks
    details: Intercept any pipeline stage — filter, translate, moderate, or add custom logic.
  - icon: 👥
    title: Multi-Agent Teams
    details: Run multiple AI personalities in the same Space with automatic turn management.
  - icon: 📦
    title: SDK + CLI + Server
    details: Use as a library, command-line tool, or full admin panel — your choice.
  - icon: 🔧
    title: Custom Providers
    details: Plug in Ollama, vLLM, or any custom AI. Simple interface, infinite flexibility.
---
```

### Getting Started (5-minute quickstart)
This is the most important page. If someone can't get running in 5 minutes, they bounce.

```markdown
# Getting Started

## Quick Start (30 seconds)

\```bash
npx xspace-agent init
npx xspace-agent join https://x.com/i/spaces/your-space-url
\```

## Programmatic Usage (2 minutes)

\```bash
npm install xspace-agent
\```

\```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    systemPrompt: 'You are a friendly AI assistant.'
  }
})

await agent.join('https://x.com/i/spaces/...')
\```

## Getting Your X Auth Token

1. Open x.com in Chrome
2. Open DevTools (F12) → Application → Cookies
3. Find `auth_token` — copy its value
4. Find `ct0` — copy its value

[Detailed guide with screenshots →](/guide/authentication)

## Next Steps
- [Configure AI providers →](/guide/providers)
- [Run multiple agents →](/guide/multi-agent)
- [Deploy with Docker →](/guide/deployment)
- [Browse examples →](/examples/)
```

### Authentication Page
This is the page people will struggle with most. Make it bulletproof:

```markdown
# Authentication

X Space Agent needs to log into X/Twitter to join Spaces. Three methods are supported:

## Method 1: Auth Token (Recommended)
Easiest and most reliable. Copy tokens from your browser.

### Step-by-step:
1. Log into x.com in Chrome
2. Open DevTools: F12 (or Cmd+Option+I on Mac)
3. Go to Application tab → Cookies → x.com
4. Copy these values:
   - `auth_token` → `X_AUTH_TOKEN`
   - `ct0` → `X_CT0`

[Screenshot showing where to find cookies]

### Usage:
\```typescript
const agent = new XSpaceAgent({
  auth: {
    token: 'your-auth-token-value',
    ct0: 'your-ct0-value'
  }
})
\```

### Token Expiry
Auth tokens typically last 1-5 years. If you get logged out, grab fresh tokens.

## Method 2: Username/Password
Automated form login. Supports 2FA.

\```typescript
const agent = new XSpaceAgent({
  auth: {
    username: 'your_username',
    password: 'your_password',
    email: 'your@email.com' // for verification step
  }
})
\```

**2FA**: If your account has 2FA enabled, the agent will emit a `2fa-required` event.
Listen for it and provide the code.

## Method 3: Cookie Persistence
Log in once, then reuse cookies automatically.

\```typescript
const agent = new XSpaceAgent({
  auth: {
    token: 'initial-token',
    cookiePath: './.cookies.json' // saves and reloads cookies
  }
})
\```
```

### Troubleshooting Page
Capture every error people will hit:

```markdown
# Troubleshooting

## Browser won't launch
**Error**: `Failed to launch the browser process`
**Fix**: Install Chromium deps: `sudo apt install chromium-browser`
Or use Docker: `docker compose up`

## Can't join Space
**Error**: `Could not find join button`
**Causes**:
- Space hasn't started yet (wait for host to start)
- Space URL is wrong (must be `x.com/i/spaces/...` format)
- Account is suspended or restricted

## No audio / Agent not responding
**Check**:
1. Is the agent unmuted? Check admin panel status
2. Is STT working? Check logs for transcription output
3. Is the AI provider key valid? Check for 401 errors in logs

## Audio quality is bad
- Increase `silenceThreshold` to 2.0 for noisy Spaces
- Check if ffmpeg is installed: `ffmpeg -version`

## High latency (slow responses)
- Switch to Groq (fastest) or gpt-4o-mini
- Reduce `maxTokens` to limit response length
- Check your internet connection to API providers

## 2FA not working
- Make sure you're sending the code within 60 seconds
- Use authenticator app codes, not SMS (more reliable)
```

## VitePress Configuration

```typescript
// docs/.vitepress/config.ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'X Space Agent',
  description: 'AI agents that join and talk in X Spaces',
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/agent' },
      { text: 'Examples', link: '/examples/' },
      { text: 'GitHub', link: 'https://github.com/your-org/xspace-agent' }
    ],
    sidebar: {
      '/guide/': [
        { text: 'Introduction', items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Authentication', link: '/guide/authentication' },
          { text: 'Configuration', link: '/guide/configuration' }
        ]},
        { text: 'Features', items: [
          { text: 'AI Providers', link: '/guide/providers' },
          { text: 'Custom Providers', link: '/guide/custom-providers' },
          { text: 'Multi-Agent Teams', link: '/guide/multi-agent' },
          { text: 'Middleware & Hooks', link: '/guide/middleware' }
        ]},
        { text: 'Deployment', items: [
          { text: 'Docker', link: '/guide/deployment' }
        ]}
      ],
      '/api/': [
        { text: 'API Reference', items: [
          { text: 'XSpaceAgent', link: '/api/agent' },
          { text: 'AgentTeam', link: '/api/team' },
          { text: 'Configuration', link: '/api/config' },
          { text: 'Events', link: '/api/events' },
          { text: 'REST API', link: '/api/rest-api' },
          { text: 'WebSocket API', link: '/api/websocket-api' }
        ]}
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-org/xspace-agent' },
      { icon: 'twitter', link: 'https://x.com/your-handle' },
      { icon: 'discord', link: 'https://discord.gg/your-server' }
    ],
    search: { provider: 'local' },
    footer: {
      message: 'All Rights Reserved.',
      copyright: 'Copyright © 2026 nirholas'
    }
  }
})
```

## Hosting
Deploy docs as static site:
- **GitHub Pages**: Free, auto-deploy from `docs/` branch
- **Vercel**: Auto-deploy on push, custom domain
- **Netlify**: Same as Vercel

## Implementation Steps
1. `pnpm add -D vitepress` in docs workspace
2. Create `.vitepress/config.ts` with nav/sidebar
3. Write landing page (index.md) with hero section
4. Write getting-started.md (most important page)
5. Write authentication.md with screenshots
6. Write provider setup guides
7. Write API reference pages
8. Port examples to docs with explanations
9. Write troubleshooting page
10. Deploy to GitHub Pages or Vercel

## Validation
- [ ] `pnpm docs:dev` launches local docs site
- [ ] Landing page loads with hero + features
- [ ] Getting started guide is followable in < 5 minutes
- [ ] All sidebar links work
- [ ] Search works
- [ ] Deploys to static hosting successfully
- [ ] Mobile responsive


