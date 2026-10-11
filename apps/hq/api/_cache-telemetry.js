const statsByEndpoint = new Map();
const MAX_ENDPOINTS = 128;
const LOG_EVERY = Math.max(0, Number(process.env.CACHE_TELEMETRY_LOG_EVERY || 200));

function cleanupOldEndpoints() {
  if (statsByEndpoint.size <= MAX_ENDPOINTS) return;
  const entries = Array.from(statsByEndpoint.entries())
    .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const overflow = statsByEndpoint.size - MAX_ENDPOINTS;
  for (let i = 0; i < overflow; i++) {
    statsByEndpoint.delete(entries[i][0]);
  }
}

export function recordCacheTelemetry(endpoint, outcome) {
  if (!endpoint || !outcome) return;
  const now = Date.now();
  const current = statsByEndpoint.get(endpoint) || {
    total: 0,
    outcomes: {},
    firstSeen: now,
    lastSeen: now,
  };

  current.total += 1;
  current.outcomes[outcome] = (current.outcomes[outcome] || 0) + 1;
  current.lastSeen = now;
  statsByEndpoint.set(endpoint, current);
  cleanupOldEndpoints();

  if (LOG_EVERY > 0 && current.total % LOG_EVERY === 0) {
    console.log(`[CacheTelemetry] ${endpoint} total=${current.total} outcomes=${JSON.stringify(current.outcomes)}`);
  }
}

export function getCacheTelemetrySnapshot() {
  const endpoints = Array.from(statsByEndpoint.entries())
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .map(([endpoint, stats]) => ({
      endpoint,
      total: stats.total,
      outcomes: stats.outcomes,
      firstSeen: new Date(stats.firstSeen).toISOString(),
      lastSeen: new Date(stats.lastSeen).toISOString(),
    }));

  return {
    generatedAt: new Date().toISOString(),
    endpointCount: endpoints.length,
    endpoints,
    note: 'In-memory per instance telemetry (resets on cold start).',
  };
}
