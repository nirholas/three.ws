> **Internal Planning Document** — Not part of the public documentation.

> **Outdated**: The Talky Show system has been removed from this project. See [architecture-overview.md](./architecture-overview.md) for current architecture.

# Talky Show System (NOT for standalone repo)

This documents the parts you want to **exclude** from the standalone repo.

---

## What It Is

An "AI comedy show" where 5 AI characters roast each other in a retro terminal web interface. Features:
- Auto-conversation: AIs talk to each other every 10 seconds
- User chat: visitors can send messages that AIs respond to
- Live Solana token data: market cap, trades, pump.fun chat
- Twitter reply monitoring
- ElevenLabs TTS for distinct character voices

---

## Server Code (server.js lines 547-943)

### AI Cast (line 575-581)
5 characters: Grok, GPT, Deepseek, Claude, Gemini
Each has: name, model (all use gpt-4o-mini), logo path, ASCII face, ElevenLabs voiceId

### /talky Namespace (line 598-658)
- On connection: sends cast, history, chat history
- Sends config flags (LIVE_TRADE, LIVE_CHAT, LIVE_MC)
- Handles `userChatMessage` with rate limiting (SPAM_SECONDS, default 30s)
- Spam keyword filter
- HTML sanitization

### processTalkyEvent() (line 660-791)
Two modes:
1. **Chat message response**: Random cast member replies to user. Prompt includes market data, conversation history, personality instructions. 45 token max.
2. **Auto-conversation**: "Director" AI picks speaker and target. Speaker generates roast. Both use OpenRouter/OpenAI (talkyAI client).

### Audio Pipeline (line 793-845)
- `getTalkyMP3Duration()` — Parse MP3 frame headers to estimate duration
- `sendTalkyAudio()` — ElevenLabs TTS via VOICE_API_KEY, broadcasts audio + dialogue

### Event System (line 847-883)
- Event queue with priority (chat messages processed first)
- 10-second idle countdown triggers auto-conversation
- Countdown broadcast to frontend for display

### Data Services (line 885-929)
- Birdeye: WebSocket price feed → `priceUpdate` events
- PumpPortal: WebSocket trade feed → `newTrade` events
- Pump.fun Chat: WebSocket chat → `newMessage` events + triggers AI conversation
- Twitter: Apify scraper → `newMessage` events + triggers AI conversation

---

## Services Directory

### services/birdeyeClient.js (218 lines)
- WebSocket connection to Birdeye's Solana API
- Subscribes to 1-minute price candles for the token
- Calculates market cap (price × 1B supply)
- Auto-reconnect on disconnect (5s delay)
- `fetchInitialTokenData()` — REST API call for initial price/marketcap

### services/pumpPortalClient.js (104 lines)
- WebSocket connection to PumpPortal trade feed
- Subscribes to token trades
- Emits buy/sell events with USD values
- Falls back to calculating USD from Birdeye price if pumpPortal doesn't provide it
- Auto-reconnect on close (5s)

### services/pumpFunChatClient.js (154 lines)
- Socket.IO client to `livechat.pump.fun`
- Joins chat room for the token contract
- Listens on 12 different event names (pump.fun's protocol is undocumented)
- Emits `chatMessage` events with username/text

### services/twitterClient.js (250 lines)
- Uses Apify's Twitter Scraper Lite actor
- Monitors replies to TARGET_TWEET
- Polls at RETWEET_READ_INTERVAL (default 10 seconds)
- Deduplicates by reply ID
- Cleans up @ mentions from reply text
- Emits as chat messages with `twitter_` prefix on username

### pumpFunChat.js (90 lines) — LEGACY
- Standalone pump.fun chat client
- Used by server.js X Space section (line 10, 399-418)
- Functionally identical to services/pumpFunChatClient.js
- Can be replaced by the services/ version when separating

---

## Frontend Files

### public/talky.html (58 lines)
- Simple layout: trades bar, header with ASCII logo, AI panel, chat sidebar
- Links to talky.css and talky.js

### public/talky.js (653 lines)
- Connects to `/talky` namespace
- Renders ASCII faces for each AI character
- Typewriter text effect for new messages
- Live price updates with color flash (green=up, red=down)
- Live trade ticker
- Chat input with cooldown timer
- Audio playback for TTS responses

### public/talky.css / public/style.css (857 lines each — IDENTICAL)
- Retro MS-DOS terminal theme
- Orange/red accent color (#ff4500)
- CRT scanline overlay effect
- 80/20 grid layout (stage | chat sidebar)
- Responsive breakpoints for mobile

### public/main.js (653 lines)
- DUPLICATE of talky.js but connects to default namespace (`io()`)
- Used by index.html
- Contains same ASCII faces, same chat/trade/price logic
- This is the "old" version before talky was split out


