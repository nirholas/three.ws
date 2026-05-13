> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Create Clean Public Repository

## Context
The current repo contains sensitive files (X auth cookies, session data) and a messy git history. We need a clean public-facing copy with a fresh git history.

## Task
Create a clean copy of this project in a new folder called `public-release/` within this workspace. This will be initialized as a fresh git repo and pushed to a new public repository.

## Steps

### 1. Create the directory structure
```
public-release/
├── server.js
├── package.json
├── package-lock.json
├── Procfile
├── .gitignore
├── .env.example          ← NEW: template with all env vars (no values)
├── README.md             ← NEW: proper public-facing README
├── x-spaces/
│   ├── index.js
│   ├── browser.js
│   ├── auth.js
│   ├── selectors.js
│   ├── space-ui.js
│   └── audio-bridge.js
│   (EXCLUDE .cookies.json)
├── providers/
│   ├── index.js
│   ├── openai-realtime.js
│   ├── openai-chat.js
│   ├── groq.js
│   ├── claude.js
│   ├── stt.js
│   └── tts.js
├── public/
│   ├── admin.html
│   ├── index.html
│   ├── agent1.html
│   ├── agent2.html
│   ├── style.css
│   └── js/
│       ├── agent-common.js
│       ├── agent-loader.js
│       ├── provider-openai-realtime.js
│       └── provider-socket.js
└── docs/                 ← OPTIONAL: include architecture docs
```

### 2. Files to EXCLUDE (sensitive/unnecessary)
- `x-spaces/.cookies.json` — contains live X/Twitter auth tokens
- `.env` / `.env.*` (except `.env.example`) — contains API keys
- `node_modules/` — will be installed fresh
- `docs/` — optional, only include architecture docs if desired (exclude separation plan as it references internal decisions)

### 3. Create `.env.example`
Create a template file with every env var the project uses, with empty values and comments explaining each one. Reference docs/env-vars-reference.md for the complete list. Only include X Space agent vars (not Talky vars).

### 4. Create public `README.md`
Write a proper README covering:
- **What it does**: Autonomous AI agent that joins and participates in X/Twitter Spaces
- **Features list**: Multi-provider AI (OpenAI, Claude, Groq), Puppeteer-based browser automation, real-time audio pipeline, admin control panel, 2FA support
- **Architecture diagram**: Simplified version of the audio flow from docs/data-flow-diagrams.md
- **Quick start**: Clone, `npm install`, configure `.env`, `node server.js`, open `/admin`
- **Provider options**: Table of AI providers with trade-offs
- **Environment variables**: Summary table pointing to `.env.example`
- **How it works**: Brief explanation of the Puppeteer → audio bridge → AI pipeline
- **Screenshots**: Placeholder for admin panel screenshot

### 5. Update `.gitignore` for public repo
Ensure these are included:
```
.cookies.json
.env
.env.*
!.env.example
node_modules/
```

### 6. Initialize fresh git
```bash
cd public-release/
git init
git add .
git commit -m "Initial commit: X Space AI Agent"
```

## Validation
- [ ] No `.cookies.json` in the copy
- [ ] No `.env` files with real values
- [ ] No references to Talky system in any file
- [ ] `npm install` works
- [ ] `node server.js` starts without errors (with proper env vars)
- [ ] All imports resolve correctly


