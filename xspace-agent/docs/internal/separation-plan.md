> **Internal Planning Document** — Not part of the public documentation.

> **Outdated**: This separation has been completed. The codebase is now a monorepo. See [architecture-overview.md](./architecture-overview.md) for current architecture.

# Separation Plan — What to Keep for Standalone Repo

## Goal
Create a standalone repo with ONLY the X Space agent + admin page functionality.

---

## Files to KEEP (copy to new repo)

### Core
- `server.js` — but HEAVILY trimmed (see below)
- `package.json` — trimmed dependencies
- `Procfile` — unchanged
- `.gitignore` — unchanged

### x-spaces/ (entire directory)
- `x-spaces/index.js`
- `x-spaces/browser.js`
- `x-spaces/auth.js`
- `x-spaces/selectors.js`
- `x-spaces/space-ui.js`
- `x-spaces/audio-bridge.js`
- `x-spaces/.cookies.json` — **EXCLUDE** (contains session data)

### providers/ (entire directory)
- `providers/index.js`
- `providers/openai-realtime.js`
- `providers/openai-chat.js`
- `providers/groq.js`
- `providers/claude.js`
- `providers/stt.js`
- `providers/tts.js`

### public/ (selective)
- `public/admin.html` — X Spaces admin panel
- `public/index.html` — X Space dashboard (needs cleanup of Talky references)
- `public/agent1.html`
- `public/agent2.html`
- `public/style.css` — shared styles
- `public/js/agent-common.js`
- `public/js/agent-loader.js`
- `public/js/provider-openai-realtime.js`
- `public/js/provider-socket.js`

---

## Files to REMOVE

- `pumpFunChat.js` — legacy, only used for X Space pump.fun chat (can be made optional)
- `services/` — entire directory (Talky-only)
- `public/talky.html`
- `public/talky.js`
- `public/talky.css`
- `public/main.js` — duplicate of talky.js

---

## server.js Changes Needed

### Remove entirely (lines 547-943):
- `/talky` namespace
- All Talky AI show logic
- All data service connections (Birdeye, PumpPortal, Pump.fun chat, Twitter)
- `startTalkyServices()`
- AI cast definitions
- Event queue / countdown system

### Remove imports (lines 17-21):
```js
// DELETE these:
const { connectToBirdeye, birdeyeEmitter, fetchInitialTokenData } = require("./services/birdeyeClient")
const { connectToPumpPortal, pumpPortalEmitter } = require("./services/pumpPortalClient")
const { connectToPumpFunChat, pumpFunChatEmitter } = require("./services/pumpFunChatClient")
const { startTwitterClient, twitterClientEmitter } = require("./services/twitterClient")
```

### Remove/simplify config vars:
- Remove: `OPENROUTER_API_KEY`, `VOICE_API_KEY`, `VOICE_STATUS`, `BIRDEYE_API_KEY`, `PUMPORTAL_API_KEY`
- Remove: `openrouter`, `talkyAI` clients
- Keep: All X Space related vars

### Simplify routes:
- Remove: `/talky` route
- Keep: `/`, `/admin`, `/agent1`, `/agent2`, `/config`, `/state`, `/session/:agentId`

### Optional: PumpFun chat for X Space
Lines 398-418 integrate pump.fun chat messages into X Space conversations. This is optional — remove if you don't want pump.fun chat feeding into agent conversations.

---

## package.json Changes

### Remove these deps:
```json
"apify-client": "^2.8.2"          // Twitter scraper (Talky only)
"websocket": "^1.0.35"            // Birdeye client (Talky only)
"socket.io-client": "^4.7.5"     // Pump.fun chat clients (keep if keeping pumpFunChat)
```

### Keep these deps:
```json
"@anthropic-ai/sdk": "^0.80.0"   // Claude provider
"axios": "^1.6.0"                // HTTP requests
"dotenv": "^16.3.1"              // Env vars
"express": "^4.18.2"             // Web server
"form-data": "^4.0.5"            // STT file upload
"openai": "^4.52.7"              // OpenAI providers
"puppeteer": "^24.40.0"          // X Spaces browser
"puppeteer-extra": "^3.3.6"      // Stealth plugin base
"puppeteer-extra-plugin-stealth": "^2.11.2"  // Anti-detection
"socket.io": "^4.7.5"            // Real-time communication
"ws": "^8.18.3"                  // WebSocket (may be used by socket.io)
```

---

## index.html Cleanup

The current index.html has references to Talky (trades bar, chat sidebar with pump.fun messages, navigation links to /talky). For the standalone repo:
- Remove trades bar section
- Simplify chat sidebar (keep as agent message display only, remove pump.fun references)
- Remove /talky nav link
- Keep core X Space agent display functionality


