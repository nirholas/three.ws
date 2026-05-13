# Express Integration Example

Embed the X Space agent into an **existing Express application** as a mounted sub-router. Your app keeps its own routes while gaining a full agent admin panel and API.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open in your browser:
   - App: http://localhost:3000/
   - Agent Admin Panel: http://localhost:3000/agent/admin
   - Agent Status: http://localhost:3000/agent/api/status

## Routes Added

| Route | Method | Description |
|-------|--------|-------------|
| `/agent/admin` | GET | Admin panel UI |
| `/agent/api/status` | GET | Agent status JSON |
| `/agent/api/join` | POST | Join a Space (`{ url }`) |
| `/agent/api/leave` | POST | Leave the current Space |
| `/agent/api/say` | POST | Speak text (`{ text }`) |

Socket.IO is attached to the same HTTP server for real-time transcription streaming.

## How to Adapt

Replace the example routes with your own application logic. The agent mounts cleanly at any path:

```typescript
app.use('/my-custom-path', router)
```


