# Load & Stress Testing

Load testing framework for xspace-agent using [Artillery](https://artillery.io/) with the Socket.IO v3 plugin.

## Prerequisites

- Node.js >= 18
- Server running locally: `npm run dev`
- `ADMIN_API_KEY` environment variable set

## Test Types

| Test | File | Duration | Purpose |
|------|------|----------|---------|
| **Basic** | `basic.yml` | ~2.5 min | 50 concurrent users via Socket.IO |
| **REST API** | `rest-api.yml` | ~2.5 min | HTTP endpoint throughput |
| **Stress** | `stress.yml` | ~2.5 min | Find breaking point (up to 500 req/s) |
| **Soak** | `soak.yml` | ~11.5 min | Memory leak detection under sustained load |

## Quick Start

```bash
# Start the server in one terminal
ADMIN_API_KEY=test-key npm run dev

# Run load tests in another terminal
export ADMIN_API_KEY=test-key

# Basic load test
npm run test:load

# REST API test
npm run test:load:rest

# Stress test (high load — watch server resources)
npm run test:stress

# Soak test (10 min — monitor memory)
npm run test:soak

# Generate HTML report
npm run test:load:report
```

## Performance Baselines

| Metric | Target | Description |
|--------|--------|-------------|
| p50 latency | < 500ms | Median response time |
| p95 latency | < 1000ms | 95th percentile |
| p99 latency | < 2000ms | 99th percentile |
| Error rate | < 1% | Failed requests / total |
| Max concurrent Socket.IO | 200+ | Simultaneous WebSocket connections |

## Rate Limiting

The server enforces per-IP rate limits:
- **HTTP API**: 100 requests/minute (configurable via `RATE_LIMIT_MAX`)
- **Socket.IO**: 30 events/10 seconds per socket

The stress test intentionally exceeds these to verify rate limiting works correctly.
Expect 429 responses in stress test output — that's the desired behavior.

## Custom Reporter

Generate a structured JSON report from Artillery output:

```bash
# Run test with JSON output
npx artillery run tests/load/basic.yml --output tests/load/reports/raw.json

# Generate performance report
node tests/load/reporter.js tests/load/reports/raw.json

# Custom output location
node tests/load/reporter.js tests/load/reports/raw.json --output /tmp/report.json
```

The report includes:
- Latency percentiles (p50, p75, p90, p95, p99)
- Throughput (requests, responses, Socket.IO events)
- HTTP status code distribution
- Error breakdown by type
- Rate limiting statistics
- Per-phase metrics for trend analysis
- Baseline pass/fail checks

## Interpreting Results

### Healthy Run
- All latency percentiles within targets
- Error rate < 1%
- No `ETIMEDOUT` or `ECONNREFUSED` errors
- Steady latency across phases (no degradation)

### Warning Signs
- p99 latency climbing across phases → possible memory pressure or GC pauses
- Increasing error rate → approaching server capacity
- `ECONNREFUSED` errors → server ran out of connections
- Many 429 responses in basic test → rate limit too aggressive for use case

### Soak Test Specifics
Monitor server memory while the soak test runs:
```bash
watch -n 2 'curl -s http://localhost:3000/metrics/json | jq .memory'
```

Look for:
- **Heap growing steadily** → memory leak (likely in rate limiter map, message buffer, or event listeners)
- **RSS growing but heap stable** → native memory leak (Buffer allocations, file descriptors)
- **Latency spikes at regular intervals** → GC pauses (consider tuning `--max-old-space-size`)

## CI Integration

Load tests are not included in the default CI pipeline since they require a running server.
To add them to CI:

```yaml
# .github/workflows/load-test.yml
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: ADMIN_API_KEY=test-key npm run dev &
      - run: sleep 5
      - run: ADMIN_API_KEY=test-key npm run test:load
```

## Files

```
tests/load/
├── basic.yml       # Standard load test (Socket.IO)
├── rest-api.yml    # REST endpoint load test
├── stress.yml      # Breaking point test
├── soak.yml        # Memory leak detection
├── reporter.js     # Custom report generator
├── README.md       # This file
└── reports/        # Generated reports (gitignored)
```


