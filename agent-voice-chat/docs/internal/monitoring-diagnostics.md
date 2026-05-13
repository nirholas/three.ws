> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Monitoring, Diagnostics & Observability

## Problem
When something goes wrong (audio not working, LLM not responding, bot stuck), there's limited visibility into what's happening. Debugging requires reading server logs and guessing.

## Goal
Real-time diagnostics dashboard showing system health, audio pipeline status, API metrics, and browser state — all accessible from the admin panel.

## Features

### 1. System Health Dashboard
Add a diagnostics section to admin panel:

```
┌─ SYSTEM HEALTH ──────────────────────────────┐
│                                               │
│  Server Uptime: 4h 23m 17s                   │
│  Memory: 487MB / 2048MB ████████░░░ (24%)    │
│  CPU: 12% ██░░░░░░░░                         │
│                                               │
│  ┌─ Browser ────────────────────────────────┐ │
│  │ Status: ● Running                         │ │
│  │ Pages: 1 open | Memory: 312MB            │ │
│  │ Cookie age: 2h 14m (valid)               │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ Audio Pipeline ────────────────────────┐  │
│  │ Capture: ● Active (16kHz, mono)          │  │
│  │ Inject:  ● Ready                         │  │
│  │ Chunks/sec: 24 in | 0 out               │  │
│  │ VAD state: silence (3.2s)                │  │
│  │ Last STT: 420ms ago                      │  │
│  │ Queue depth: 0                           │  │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ API Metrics (last hour) ───────────────┐  │
│  │                                          │  │
│  │  STT  │ calls: 47 │ avg: 450ms │ err: 0 │  │
│  │  LLM  │ calls: 42 │ avg: 1.2s  │ err: 1 │  │
│  │  TTS  │ calls: 41 │ avg: 890ms │ err: 0 │  │
│  │                                          │  │
│  │  Total cost est: $0.47                   │  │
│  │  Tokens used: 12,340 in / 4,560 out      │  │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ Recent Errors ─────────────────────────┐  │
│  │ 14:23:05 LLM timeout (agent 0, 15.2s)   │  │
│  │ 13:45:12 STT empty response              │  │
│  └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

### 2. Metrics Collection Module

```
monitoring/
├── metrics.js          ← Metrics collector (counters, histograms, gauges)
├── health.js           ← Health check aggregator
├── cost-tracker.js     ← API cost estimation
└── browser-monitor.js  ← Puppeteer browser health
```

#### metrics.js
```js
class Metrics {
  // Counters
  incrementCounter(name, labels)           // e.g. 'stt_calls', { provider: 'groq' }

  // Histograms (latency tracking)
  recordLatency(name, durationMs, labels)  // e.g. 'llm_latency', 1200, { model: 'claude' }

  // Gauges
  setGauge(name, value)                    // e.g. 'turn_queue_depth', 2

  // Getters
  getSnapshot()                            // All current metrics
  getTimeSeries(name, windowMinutes)       // Last N minutes of a metric

  // Reset
  reset()                                  // Clear all metrics (for testing)
}
```

**Where to instrument:**
- `stt.js`: STT call latency, error count
- `providers/*.js`: LLM call latency, tokens used, error count
- `tts.js`: TTS call latency, error count
- `x-spaces/audio-bridge.js`: Audio chunks captured/injected per second, VAD state changes
- `server.js`: Turn requests, turn grants, turn queue depth
- `x-spaces/index.js`: Status transitions, reconnection count

#### cost-tracker.js
Estimate API costs per call:
```js
const COSTS = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },      // per 1M tokens
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'whisper-large-v3-turbo': { perMinute: 0.04 },
  'elevenlabs': { perCharacter: 0.00003 },
  'tts-1': { perCharacter: 0.000015 }
}
```

Track cumulative cost per session and per day. Show in admin panel.

#### browser-monitor.js
Monitor Puppeteer browser health:
```js
class BrowserMonitor {
  getMemoryUsage()          // Chrome process memory
  getPageCount()            // Open tabs
  getCookieStatus()         // Cookie age and validity
  getNetworkActivity()      // Active connections
  isResponsive()            // Can we evaluate JS in the page?
  getConsoleErrors()        // Recent browser console errors
}
```

### 3. API Endpoints

```
GET /api/metrics                  → current metrics snapshot
GET /api/metrics/timeseries/:name → time series for specific metric
GET /api/health                   → health check (for uptime monitors)
GET /api/diagnostics              → full diagnostic dump
GET /api/costs                    → API cost breakdown
```

### 4. Real-Time Metrics via Socket.IO
Push metrics updates to admin panel every 5 seconds:
```js
setInterval(() => {
  io.of('/space').emit('metrics', metrics.getSnapshot())
}, 5000)
```

Admin panel renders live-updating charts using lightweight library (e.g., sparklines or simple CSS bar charts — no heavy charting library needed).

### 5. Audio Pipeline Visualizer
Show real-time audio flow in admin panel:

```
┌─ AUDIO FLOW ─────────────────────────────────┐
│                                               │
│  Space Audio ──▶ [████████░░] ──▶ VAD         │
│                   amplitude                    │
│                                               │
│  VAD ──▶ [SPEECH] ──▶ Buffer ──▶ STT          │
│          1.2s                    [processing]  │
│                                               │
│  LLM ──▶ [idle] ──▶ TTS ──▶ [idle]           │
│                                               │
│  Inject ──▶ [░░░░░░░░░░] ──▶ Space           │
│              no audio queued                   │
└───────────────────────────────────────────────┘
```

This gives immediate visual feedback on where audio is in the pipeline and where bottlenecks are.

### 6. Structured Logging
Replace `console.log` with structured logger:

```js
const logger = require('./monitoring/logger')

// Instead of: console.log('STT result:', text)
logger.info('STT transcription complete', {
  agentId: 0,
  text: text.substring(0, 50),
  latencyMs: 450,
  provider: 'groq',
  requestId: 'req-abc123'
})
```

Log levels: error, warn, info, debug
Output format: JSON (for log aggregation services) or pretty (for development)

```env
LOG_LEVEL=info            # error, warn, info, debug
LOG_FORMAT=pretty         # json or pretty
```

### 7. Error Alerting
When critical errors occur, push notifications to admin panel immediately:

```js
// Error categories
const CRITICAL = ['browser_crash', 'auth_expired', 'space_kicked']
const WARNING = ['stt_timeout', 'llm_timeout', 'tts_error', 'high_memory']
const INFO = ['space_joined', 'space_left', 'agent_speaking']
```

Critical errors show a red banner in admin panel. Warnings show amber indicators.

## Implementation Steps
1. Create metrics collector module
2. Instrument existing code (STT, LLM, TTS, audio bridge)
3. Add /api/metrics and /api/health endpoints
4. Add Socket.IO metrics push to admin panel
5. Build admin panel diagnostics section
6. Add cost tracking
7. Add browser health monitoring
8. Replace console.log with structured logger
9. Add audio pipeline visualizer

## Validation
- [ ] /api/health returns meaningful status
- [ ] Metrics update in real-time on admin panel
- [ ] STT/LLM/TTS latencies are tracked accurately
- [ ] Cost estimates match actual API usage
- [ ] Browser memory usage is reported
- [ ] Errors appear in admin panel immediately
- [ ] Structured logs work in both JSON and pretty format
- [ ] Diagnostics help identify actual issues (test by introducing latency)


