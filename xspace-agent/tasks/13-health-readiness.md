# Task 13: Health, Readiness & Metrics Endpoints

## Context
Production deployments need health checks for load balancers and orchestrators, readiness checks for rolling deploys, and metrics for monitoring.

## Requirements

### GET /health
Lightweight liveness check. Returns immediately, no external calls.
```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "0.1.0",
  "timestamp": "2026-03-24T12:00:00Z"
}
```
- Returns 200 if the process is alive
- Returns 503 if the server is shutting down (graceful shutdown in progress)
- No authentication required
- Response time < 5ms

### GET /ready
Readiness check. Verifies the server can handle requests.
```json
{
  "status": "ready",
  "checks": {
    "server": { "status": "ok" },
    "browser": { "status": "ok", "connected": true },
    "providers": {
      "llm": { "status": "ok", "provider": "openai", "latency": 120 },
      "stt": { "status": "ok", "provider": "groq", "latency": 85 },
      "tts": { "status": "ok", "provider": "elevenlabs", "latency": 200 }
    },
    "socketio": { "status": "ok", "connections": 12 }
  }
}
```
- Returns 200 when all critical checks pass
- Returns 503 when any critical check fails (browser disconnected, no LLM provider)
- Non-critical failures (TTS not configured) still return 200 but show the specific check as "degraded"
- Cache results for 5 seconds (don't hit providers on every call)
- No authentication required

### GET /metrics (Prometheus format)
Expose metrics in Prometheus text exposition format:
```
# HELP xspace_agents_active Number of currently active agents
# TYPE xspace_agents_active gauge
xspace_agents_active 2

# HELP xspace_messages_total Total messages processed
# TYPE xspace_messages_total counter
xspace_messages_total{type="ai"} 1234
xspace_messages_total{type="user"} 567

# HELP xspace_provider_requests_total Total provider API calls
# TYPE xspace_provider_requests_total counter
xspace_provider_requests_total{provider="openai",type="llm",status="success"} 890
xspace_provider_requests_total{provider="openai",type="llm",status="error"} 12

# HELP xspace_provider_latency_seconds Provider response latency
# TYPE xspace_provider_latency_seconds histogram
xspace_provider_latency_seconds_bucket{provider="openai",type="llm",le="0.5"} 200
xspace_provider_latency_seconds_bucket{provider="openai",type="llm",le="1"} 450
xspace_provider_latency_seconds_bucket{provider="openai",type="llm",le="2"} 488
xspace_provider_latency_seconds_bucket{provider="openai",type="llm",le="+Inf"} 490

# HELP xspace_audio_pipeline_duration_seconds Audio pipeline processing time
# TYPE xspace_audio_pipeline_duration_seconds histogram

# HELP xspace_websocket_connections Active WebSocket connections
# TYPE xspace_websocket_connections gauge
xspace_websocket_connections{namespace="/space"} 8
xspace_websocket_connections{namespace="/admin"} 2

# HELP xspace_provider_cost_usd Estimated provider costs
# TYPE xspace_provider_cost_usd counter
xspace_provider_cost_usd{provider="openai"} 0.45
xspace_provider_cost_usd{provider="elevenlabs"} 0.12

# HELP xspace_uptime_seconds Server uptime
# TYPE xspace_uptime_seconds gauge
xspace_uptime_seconds 3600
```

Use `prom-client` library for metric collection.

### Metrics to Track
- **Counters**: messages total, provider requests total (by provider/type/status), errors total, auth attempts
- **Gauges**: active agents, websocket connections, audio level (last value)
- **Histograms**: provider latency, audio pipeline duration, request duration

### Graceful Shutdown
- On SIGTERM/SIGINT:
  1. Set health to "shutting_down" (health returns 503)
  2. Stop accepting new connections
  3. Wait for active requests to complete (30s timeout)
  4. Close browser sessions gracefully
  5. Close Socket.IO connections
  6. Exit process

### Docker Integration
- Update the Dockerfile health check to use `/health`
- Update docker-compose health check configuration
- Verify Prometheus scrape config in `docker/prometheus.yml` points to `/metrics`

## Dependencies to Add
- `prom-client` — Prometheus metrics library

## Files to Create
- `src/server/routes/health.ts`
- `src/server/metrics.ts` — metric definitions and collectors
- `src/server/shutdown.ts` — graceful shutdown logic

## Files to Modify
- `src/server/index.ts` — mount routes, add shutdown handler
- `Dockerfile` — update HEALTHCHECK
- `docker/docker-compose.yml` — update health check config
- `docker/prometheus.yml` — verify scrape target

## Acceptance Criteria
- [ ] `/health` returns 200 in < 5ms
- [ ] `/ready` checks browser and provider connectivity
- [ ] `/metrics` returns valid Prometheus format
- [ ] Prometheus can scrape metrics successfully
- [ ] Graceful shutdown completes within 30 seconds
- [ ] Health returns 503 during shutdown
- [ ] Provider latency histograms populate correctly
- [ ] Message counters increment in real-time
- [ ] No authentication required for health/ready/metrics


