# Admin Panel Guide

The admin panel is a browser-based dashboard for controlling, monitoring, and configuring xspace-agent in real time. It communicates with the server over Socket.IO for live updates and provides quick access to agent lifecycle controls, transcript viewing, provider settings, and more.

---

## Accessing the Admin Panel

**URL:** `http://localhost:3000/admin` (adjust the port if you changed the `PORT` environment variable).

### Authentication

All admin endpoints and Socket.IO connections are protected by the `ADMIN_API_KEY` environment variable. You must set this before starting the server:

```bash
# Generate a strong key
export ADMIN_API_KEY=$(openssl rand -hex 32)
```

The key must be at least 16 characters. The server will refuse to start if `ADMIN_API_KEY` is not set, and will warn if it is shorter than 16 characters.

For REST API calls, provide the key via any of these methods:

| Method | Example |
|--------|---------|
| `X-API-Key` header | `curl -H "X-API-Key: <key>" http://localhost:3000/admin/providers` |
| `Authorization` header | `curl -H "Authorization: Bearer <key>" http://localhost:3000/state` |
| Query parameter | `http://localhost:3000/config?apiKey=<key>` |

For Socket.IO connections (including the admin panel itself), the key is passed in the handshake auth object (`socket.handshake.auth.apiKey`) or via the `x-api-key` handshake header. The admin panel JavaScript handles this automatically when the key is configured in Settings.

### Connection Indicator

The header bar shows two indicators:

- **Connection badge** (top-right) -- a colored dot with "Connected" or "Disconnected" text showing whether the Socket.IO WebSocket is live.
- **Agent status badge** -- displays the current agent state. Possible values and their colors:

| Badge | Meaning |
|-------|---------|
| Offline (grey) | No agent running |
| Launching (yellow) | Browser is starting |
| Authenticating (yellow) | Logging into X |
| Ready (blue) | Logged in, waiting for a Space URL |
| Joining (yellow) | Navigating to the Space |
| Listening (green) | In the Space, capturing audio |
| In Space (green) | Actively speaking in the Space |
| Space Ended (red) | The Space has closed |

---

## Dashboard Page

**Route:** `#/` (the default landing page)

The Dashboard is the main control surface. It is divided into four sections.

### Stat Cards

Four cards across the top show at-a-glance metrics:

| Card | Description |
|------|-------------|
| **Status** | Current agent state in plain language (e.g., "Listening", "Speaking", "Offline"). Includes a colored status dot. |
| **Uptime** | How long the agent has been running since it entered a Space. Updates every second. Displays `--` when no agent is active. |
| **Messages** | Running count of transcribed and generated messages during the current session. |
| **Cost** | Accumulated provider cost in USD (e.g., `$0.042`), updated in real time via `provider:cost` events from the agent. |

### Quick Actions

This card contains the agent lifecycle controls:

- **Space URL** input field -- paste the full URL of an X Space (e.g., `https://x.com/i/spaces/1eaKbrPAqbwKX`).
- **Start** button -- launches the browser, authenticates with X, and prepares the agent. Disabled while an agent is already running.
- **Stop** button -- destroys the running agent and resets all state. Disabled when no agent is running.
- **Join Space** button -- sends the agent into the Space at the provided URL. If the agent has not been started yet, clicking Join will automatically start the agent first and then join once authentication completes.
- **Leave** button -- exits the current Space without stopping the agent entirely. The agent remains logged in and can join another Space. Only enabled while the agent is actively in a Space.
- **2FA section** -- appears automatically when the server emits a `xSpaces2faRequired` event (i.e., X requests a two-factor authentication code). Enter the 6-digit code and click Submit. The section hides itself after submission.

### Audio Pipeline

Real-time audio monitoring:

- **Input Level** -- a horizontal meter showing the amplitude of incoming audio from the Space. Next to it, a "chunks/s" counter shows the current audio processing rate.
- **Output Level** -- a meter showing the amplitude of audio being sent to the Space (TTS output).
- **VAD State** -- shows the current Voice Activity Detection status (Idle, Speech Detected, etc.).
- **WebRTC Stats** -- displays bytes received, bytes sent, and packets lost from the underlying WebRTC connection.

### Live Transcript

A scrolling panel showing the conversation in real time:

- Each entry shows the **speaker name** (color-coded per speaker), the **message text**, and a **timestamp**.
- The transcript auto-scrolls to the bottom as new messages arrive. Scrolling up manually pauses auto-scroll; scrolling back to the bottom re-enables it.
- **Clear** button -- empties the transcript display.
- **Message input** -- type a message and press Enter or click Send. The agent will speak this text in the Space via TTS. Your sent messages appear in the transcript with the label "You".

### Event Log

A reverse-chronological log of system events:

- Status transitions (e.g., `State: idle -> launching`)
- Connection events
- Errors and warnings from the agent or server
- Provider cost updates

Each entry is timestamped. The log retains up to 500 entries. Click **Clear** to empty it.

---

## Agents Page

**Route:** `#/agents`

This page provides agent-level configuration and a manual message interface.

### Agent Overview Cards

When agents are active, cards appear showing each agent's name, provider, active/idle status, message count, uptime, and accumulated cost. If no agents are running, an empty state message directs you to start a bot from the Dashboard.

### System Prompt

Configure the agent's personality and behavior:

- **Agent Personality** dropdown -- quick presets:
  - Default Assistant
  - Domain Expert
  - Casual Conversationalist
  - Interviewer
  - Custom (enables free-form editing below)
- **System Prompt** textarea -- the full system prompt sent to the LLM before each response. A character counter below the field shows the current length.
- **Save Prompt** button -- saves the prompt to the current session state.

For persistent personality management with hot-swapping, use the REST API:

```bash
# List available personalities
curl -H "X-API-Key: $KEY" http://localhost:3000/api/personalities

# Set an agent's personality (hot-swaps if agent is running)
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"personalityId": "expert", "clearHistory": false}' \
  http://localhost:3000/api/agents/0/personality
```

### Voice Settings

- **TTS Provider** -- select ElevenLabs, OpenAI TTS, or Browser (free, lower quality).
- **Voice ID** -- the provider-specific voice identifier (e.g., an ElevenLabs voice ID like `EXAVITQu4vr4xnSDxMaL`).
- **Speed** -- a slider from 0.5x to 2.0x controlling speech rate.

### LLM Provider

- **Provider** dropdown -- OpenAI, Claude, or Groq.
- **Model** text field -- specify the model name (e.g., `gpt-4o`, `claude-sonnet-4-20250514`, `llama-3.3-70b-versatile`).

### Manual Message (Force-Speak)

The "Manual Message" card at the bottom of the page lets you type arbitrary text and make the agent speak it immediately in the Space. Type the message, then press Enter or click **Speak**. This bypasses the LLM -- the text is sent directly to TTS and injected into the Space audio.

For programmatic force-speak, emit the Socket.IO event:

```js
socket.emit('orchestrator:force-speak', { botId: 'default' })
```

---

## Builder Page

**Route:** `http://localhost:3000/builder` (separate page, not inside the admin SPA)

The Builder provides a no-code interface for creating agent flows -- visual configurations that define how an agent behaves, what personality it has, and where it deploys.

### Templates

Browse pre-built flow templates to start from:

```bash
# List all templates
curl -H "X-API-Key: $KEY" http://localhost:3000/api/builder/templates

# Get templates by category
curl -H "X-API-Key: $KEY" http://localhost:3000/api/builder/templates/category/conversation

# Create a flow from a template
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "My Agent"}' \
  http://localhost:3000/api/builder/flows/from-template/<templateId>
```

### Flows CRUD

Flows are the core unit of the Builder. Each flow contains nodes (processing steps), connections (edges between nodes), variables, and a personality configuration (name, role, tone, energy, detail, humor, knowledge areas, excluded topics, example conversations).

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List flows | `/api/builder/flows` | GET |
| Get a flow | `/api/builder/flows/:id` | GET |
| Create a flow | `/api/builder/flows` | POST |
| Update a flow | `/api/builder/flows/:id` | PUT |
| Delete a flow | `/api/builder/flows/:id` | DELETE |

Each update increments the flow's version number automatically.

### Validation

Before deploying, validate a flow to check for structural errors (missing connections, invalid node configurations, etc.):

```bash
# Validate a saved flow
curl -X POST -H "X-API-Key: $KEY" http://localhost:3000/api/builder/flows/<id>/validate

# Validate without saving
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{ ... flow object ... }' \
  http://localhost:3000/api/builder/validate
```

### Transpiling

Convert a validated flow into an `AgentConfig` object that the SDK can consume directly:

```bash
curl -X POST -H "X-API-Key: $KEY" http://localhost:3000/api/builder/flows/<id>/transpile
```

### Deploying Flows

Deploy a validated flow as a running agent:

```bash
# Full deployment
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"platform": "x_spaces", "mode": "api_triggered", "credentials": {}}' \
  http://localhost:3000/api/builder/flows/<id>/deploy

# Preview deployment (auto-stops after 30 minutes)
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"platform": "x_spaces"}' \
  http://localhost:3000/api/builder/flows/<id>/preview

# List deployments
curl -H "X-API-Key: $KEY" http://localhost:3000/api/builder/deployments

# Stop a deployment
curl -X POST -H "X-API-Key: $KEY" http://localhost:3000/api/builder/deployments/<id>/stop
```

Preview deployments are useful for testing -- they automatically shut down after 30 minutes and return a preview URL you can share.

---

## Analytics Page

**Route:** available via the REST API at `/api/analytics/*`

The analytics system provides conversation intelligence -- post-session analysis of transcripts including sentiment scoring, topic extraction, speaker metrics, and AI-generated insights.

### Session Analytics

Retrieve full analytics for a completed session:

```bash
curl -H "X-API-Key: $KEY" http://localhost:3000/api/analytics/sessions/<sessionId>
```

Returns duration, speaking time, silence time, participant count, turn count, average turn length, sentiment stats (average/min/max/trend), topics, speakers, summary, key decisions, action items, and recommendations.

### Sentiment Tracking

Get a timeseries of sentiment scores across a session, optionally filtered by speaker:

```bash
curl -H "X-API-Key: $KEY" \
  "http://localhost:3000/api/analytics/sessions/<id>/sentiment?speaker=Alice"
```

### Topic Breakdown

```bash
curl -H "X-API-Key: $KEY" http://localhost:3000/api/analytics/sessions/<id>/topics
```

Returns the primary topic and a list of all detected topics with message counts.

### Speaker Analytics

```bash
curl -H "X-API-Key: $KEY" http://localhost:3000/api/analytics/sessions/<id>/speakers
```

Returns per-speaker metrics including talk time percentage and engagement score.

### AI-Generated Insights

```bash
curl -H "X-API-Key: $KEY" http://localhost:3000/api/analytics/sessions/<id>/insights
```

Returns a natural-language summary, key decisions, action items, recommendations, conversation highlights, and risk flags.

### Annotated Transcript

```bash
curl -H "X-API-Key: $KEY" http://localhost:3000/api/analytics/sessions/<id>/transcript
```

Returns every message annotated with per-message sentiment scores and topic labels.

### Aggregate & Trends

```bash
# Aggregate stats across all sessions
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/analytics/aggregate?period=30d"

# Daily trend analysis
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/analytics/trends?days=30"
```

Trends return daily averages for sentiment, session count, and duration.

### Weekly Report

```bash
# Current week
curl -H "X-API-Key: $KEY" http://localhost:3000/api/analytics/reports/weekly

# Previous week
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/analytics/reports/weekly?weeksBack=1"
```

Returns a comprehensive report with total sessions, summary text, aggregated metrics, sentiment distribution (positive/neutral/negative), top topics, top speakers, risk flags, and recommendations.

### Export

```bash
# CSV export (last 30 days)
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/analytics/reports/export?format=csv&period=30d"

# JSON export
curl -H "X-API-Key: $KEY" "http://localhost:3000/api/analytics/reports/export?format=json&period=7d"
```

### Reprocessing

Re-run the analytics pipeline on a session (useful after pipeline upgrades):

```bash
curl -X POST -H "X-API-Key: $KEY" \
  http://localhost:3000/api/analytics/sessions/<id>/reprocess
```

---

## Settings Page

**Route:** `#/settings`

The Settings page configures authentication, API keys, provider selection, and server behavior.

### X Authentication

Two authentication methods are available for the Puppeteer browser that joins X Spaces:

- **Cookie Auth (recommended)** -- provide the `auth_token` and `ct0` cookies extracted from a logged-in X session in your browser. These are pasted into the Auth Token and CT0 Token fields.
- **Username / Password** -- provide X account credentials. The agent will log in through the browser. This method may trigger 2FA prompts (handled on the Dashboard page).

Credentials are held in server memory only and are not persisted to disk. For production use, set them as environment variables (`X_AUTH_TOKEN`, `X_CT0`, or `X_USERNAME`, `X_PASSWORD`).

### API Keys

Enter keys for the AI providers you intend to use:

| Field | Environment Variable | Used By |
|-------|---------------------|---------|
| OpenAI API Key | `OPENAI_API_KEY` | LLM (GPT), STT (Whisper), TTS |
| Anthropic API Key | `ANTHROPIC_API_KEY` | LLM (Claude) |
| Groq API Key | `GROQ_API_KEY` | LLM (Llama), STT (Whisper) |
| ElevenLabs API Key | `ELEVENLABS_API_KEY` | TTS |

Keys entered in the UI are stored in server memory for the current session. Set them as environment variables for persistence across restarts.

### Behavior

Provider selection dropdowns:

- **AI Provider** -- the LLM used for generating responses. Options: OpenAI, OpenAI Chat, Claude, Groq.
- **STT Provider** -- speech-to-text engine. Options: Groq Whisper, OpenAI Whisper.
- **TTS Provider** -- text-to-speech engine. Options: ElevenLabs, OpenAI TTS, Browser.

Toggle switches:

- **Headless Browser** -- when enabled (default), the Puppeteer browser runs without a visible window. Disable for debugging to see the browser UI.
- **Auto-join on Start** -- when enabled, the agent will automatically join the Space URL from the Dashboard when started.

### Server Info

A key-value list showing server version, Node.js version, uptime, and agent status. This section is populated by clicking **Check Health**, which calls the `GET /health` endpoint.

### Provider Status

Click **Provider Status** to call `GET /admin/providers` (requires authentication). This returns:

- Provider health and status for each configured provider (LLM, STT, TTS)
- Cost summary for the current session
- Session duration

For detailed cost tracking via the REST API:

```bash
# Current cost summary with hourly estimate and recent entries
curl -H "X-API-Key: $KEY" http://localhost:3000/admin/providers/costs

# Costs since a specific timestamp
curl -H "X-API-Key: $KEY" "http://localhost:3000/admin/providers/costs?since=1711500000000"

# Provider health check results
curl -H "X-API-Key: $KEY" http://localhost:3000/admin/providers/health
```

### Selector Health

The agent relies on CSS selectors to interact with the X Spaces UI. When X updates their frontend, selectors can break. The server provides endpoints to monitor and fix this:

```bash
# Validate all selectors against the live page
curl -H "X-API-Key: $KEY" http://localhost:3000/admin/selectors/health

# View recent selector failures
curl -H "X-API-Key: $KEY" http://localhost:3000/admin/selectors/failures

# Override a broken selector
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"selector": "[data-testid=\"new-selector\"]"}' \
  http://localhost:3000/admin/selectors/joinButton
```

The `SelectorEngine` tries multiple strategies (CSS, text content, ARIA attributes) for each element. When overriding, you are adding a highest-priority selector that is tried first.

---

## History Page

**Route:** `#/history`

The History page shows past conversations and transcripts. Currently, transcripts are stored in-memory during the active session. The page displays an empty state with an **Export Current Session** button.

Clicking **Export Current Session** downloads a JSON file containing all messages from the current session. The file is named `transcript-YYYY-MM-DD.json` and contains an array of message objects with speaker, text, timestamp, and role information.

For persistent history across sessions, configure a PostgreSQL database via the `DATABASE_URL` environment variable. Session data and conversation archives will then be stored in the database and accessible through the analytics API.

---

## Keyboard Shortcuts & Tips

### Keyboard Shortcuts

- **Enter** in the Space URL field (Dashboard) -- no built-in shortcut, but you can tab to the Join button and press Enter.
- **Enter** in the message input (Dashboard or Agents page) -- sends the message immediately.
- **Enter** in the 2FA code field -- does not auto-submit; click the Submit button.

### Tips

- **Multiple dashboards**: Multiple browser tabs can connect to the admin panel simultaneously. All receive the same real-time events via Socket.IO broadcast.
- **Mobile support**: The admin panel includes a responsive bottom navigation bar that replaces the sidebar on small screens. All pages are usable on mobile.
- **Reconnection**: Socket.IO automatically reconnects if the connection drops. The connection badge updates to reflect the current state.
- **Message history on connect**: When you open the admin panel (or reconnect), the server sends the last 50 messages and the last 20 FSM state transitions, so you see recent context immediately.
- **Rate limiting**: Socket.IO events are rate-limited to 30 events per 10 seconds per connection. HTTP API requests are limited to 100 per minute per IP (configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`).
- **Secret redaction**: Error messages sent to the admin panel are automatically redacted to prevent API keys or tokens from appearing in logs.
- **Cost monitoring**: The Dashboard cost card updates in real time. For detailed per-provider breakdowns and hourly cost estimates, use the `GET /admin/providers/costs` endpoint.
- **Prometheus metrics**: For production monitoring, scrape `GET /metrics` (Prometheus text format) or `GET /metrics/json` (JSON). These endpoints do not require authentication and are suitable for load balancer health checks and Grafana dashboards.

### REST API Quick Reference

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Server health, uptime, agent status |
| `GET /metrics` | No | Prometheus metrics |
| `GET /metrics/json` | No | Metrics in JSON |
| `GET /config` | Yes | AI provider and agent status |
| `GET /state` | Yes | Current state with last 50 messages |
| `GET /admin/providers` | Yes | Provider status and cost summary |
| `GET /admin/providers/costs` | Yes | Detailed cost tracking |
| `GET /admin/providers/health` | Yes | Provider health checks |
| `GET /admin/selectors/health` | Yes | Selector validation |
| `GET /admin/selectors/failures` | Yes | Selector failure report |
| `POST /admin/selectors/:name` | Yes | Override a CSS selector |
| `GET /api/agents/:id/personality` | Yes | Get agent personality |
| `POST /api/agents/:id/personality` | Yes | Set agent personality (hot-swap) |
| `GET /api/builder/templates` | Yes | List flow templates |
| `GET /api/builder/flows` | Yes | List saved flows |
| `POST /api/builder/flows` | Yes | Create a flow |
| `PUT /api/builder/flows/:id` | Yes | Update a flow |
| `POST /api/builder/flows/:id/deploy` | Yes | Deploy a flow |
| `GET /api/analytics/sessions/:id` | Yes | Session analytics |
| `GET /api/analytics/aggregate` | Yes | Aggregate analytics |
| `GET /api/analytics/trends` | Yes | Trend analysis |
| `GET /api/analytics/reports/weekly` | Yes | Weekly report |
| `GET /api/analytics/reports/export` | Yes | CSV/JSON export |


