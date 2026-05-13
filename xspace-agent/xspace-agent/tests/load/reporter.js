// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Custom Artillery Reporter
// Generates a structured JSON performance report with:
//   - Request rates (actual vs target)
//   - Latency percentiles (p50, p95, p99)
//   - Error rates by type
//   - Socket.IO connection stats
//   - Memory usage snapshots (if /metrics/json is available)
// =============================================================================
//
// Usage (as Artillery plugin — auto-loaded via config):
//   config:
//     processor: "./reporter.js"
//
// Or standalone:
//   node reporter.js <artillery-json-report>

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Fetch server memory metrics from /metrics/json endpoint.
 * Returns null if the endpoint is unavailable.
 */
function fetchServerMetrics(target) {
  return new Promise((resolve) => {
    const url = `${target}/metrics/json`;
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Extract latency percentiles from Artillery counters/histograms.
 */
function extractLatency(stats) {
  const latency = stats.summaries?.['http.response_time'] ||
                  stats.summaries?.['socketio.response_time'] ||
                  {};
  return {
    min: latency.min ?? null,
    max: latency.max ?? null,
    median: latency.median ?? latency.p50 ?? null,
    p50: latency.p50 ?? null,
    p75: latency.p75 ?? null,
    p90: latency.p90 ?? null,
    p95: latency.p95 ?? null,
    p99: latency.p99 ?? null,
  };
}

/**
 * Extract error breakdown from Artillery stats.
 */
function extractErrors(stats) {
  const errors = {};
  const counters = stats.counters || {};

  for (const [key, value] of Object.entries(counters)) {
    if (key.startsWith('errors.') || key.includes('error') || key.includes('ETIMEDOUT') || key.includes('ECONNREFUSED')) {
      errors[key] = value;
    }
  }

  // HTTP status code errors
  for (const [key, value] of Object.entries(counters)) {
    if (key.startsWith('http.codes.') && !key.startsWith('http.codes.2')) {
      errors[key] = value;
    }
  }

  return errors;
}

/**
 * Extract HTTP status code distribution.
 */
function extractStatusCodes(stats) {
  const codes = {};
  const counters = stats.counters || {};

  for (const [key, value] of Object.entries(counters)) {
    if (key.startsWith('http.codes.')) {
      const code = key.replace('http.codes.', '');
      codes[code] = value;
    }
  }

  return codes;
}

/**
 * Extract request/connection counts.
 */
function extractThroughput(stats) {
  const counters = stats.counters || {};
  return {
    httpRequests: counters['http.requests'] ?? 0,
    httpResponses: counters['http.responses'] ?? 0,
    httpDownloaded: counters['http.downloaded_bytes'] ?? 0,
    socketioConnections: counters['socketio.connect'] ?? 0,
    socketioDisconnections: counters['socketio.disconnect'] ?? 0,
    socketioEmits: counters['socketio.emit'] ?? 0,
    vusersCreated: counters['vusers.created'] ?? 0,
    vusersCompleted: counters['vusers.completed'] ?? 0,
    vusersFailed: counters['vusers.failed'] ?? 0,
  };
}

/**
 * Calculate rate limit stats from status codes.
 */
function extractRateLimitStats(stats) {
  const counters = stats.counters || {};
  const total = counters['http.responses'] ?? 0;
  const rateLimited = counters['http.codes.429'] ?? 0;

  return {
    totalRequests: total,
    rateLimited,
    rateLimitPercentage: total > 0 ? ((rateLimited / total) * 100).toFixed(2) + '%' : '0%',
  };
}

/**
 * Generate a structured performance report from Artillery JSON output.
 */
function generateReport(artilleryReport) {
  const { aggregate, intermediate } = artilleryReport;

  const report = {
    generatedAt: new Date().toISOString(),
    testDuration: {
      startedAt: intermediate?.[0]?.firstCounterAt ?? null,
      endedAt: intermediate?.[intermediate.length - 1]?.lastCounterAt ?? null,
      phases: intermediate?.length ?? 0,
    },
    summary: {
      latency: extractLatency(aggregate),
      throughput: extractThroughput(aggregate),
      statusCodes: extractStatusCodes(aggregate),
      errors: extractErrors(aggregate),
      rateLimiting: extractRateLimitStats(aggregate),
    },
    performanceBaseline: {
      p50Target: '< 500ms',
      p95Target: '< 1000ms',
      p99Target: '< 2000ms',
      maxErrorRateTarget: '< 1%',
      actualP95: aggregate?.summaries?.['http.response_time']?.p95 ?? null,
      actualP99: aggregate?.summaries?.['http.response_time']?.p99 ?? null,
      actualErrorRate: (() => {
        const total = aggregate?.counters?.['vusers.completed'] ?? 0;
        const failed = aggregate?.counters?.['vusers.failed'] ?? 0;
        return total > 0 ? ((failed / (total + failed)) * 100).toFixed(2) + '%' : '0%';
      })(),
    },
    phases: (intermediate || []).map((phase, i) => ({
      phase: i + 1,
      latency: extractLatency(phase),
      throughput: extractThroughput(phase),
      statusCodes: extractStatusCodes(phase),
      errors: extractErrors(phase),
    })),
  };

  return report;
}

/**
 * CLI entry point: parse an Artillery JSON report and produce a summary.
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node reporter.js <artillery-report.json> [--output <file>]');
    console.log('');
    console.log('Generates a structured performance report from an Artillery JSON report.');
    process.exit(0);
  }

  const inputFile = args[0];
  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }

  let artilleryReport;
  try {
    artilleryReport = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  } catch (err) {
    console.error(`Error: Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }

  const report = generateReport(artilleryReport);

  // Print summary to stdout
  console.log('\n=== Load Test Performance Report ===\n');
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Phases: ${report.testDuration.phases}`);
  console.log('');

  console.log('--- Latency ---');
  const lat = report.summary.latency;
  console.log(`  p50:  ${lat.p50 ?? 'N/A'} ms`);
  console.log(`  p95:  ${lat.p95 ?? 'N/A'} ms`);
  console.log(`  p99:  ${lat.p99 ?? 'N/A'} ms`);
  console.log(`  min:  ${lat.min ?? 'N/A'} ms`);
  console.log(`  max:  ${lat.max ?? 'N/A'} ms`);
  console.log('');

  console.log('--- Throughput ---');
  const tp = report.summary.throughput;
  console.log(`  HTTP requests:   ${tp.httpRequests}`);
  console.log(`  HTTP responses:  ${tp.httpResponses}`);
  console.log(`  Socket.IO emits: ${tp.socketioEmits}`);
  console.log(`  VUsers created:  ${tp.vusersCreated}`);
  console.log(`  VUsers completed: ${tp.vusersCompleted}`);
  console.log(`  VUsers failed:   ${tp.vusersFailed}`);
  console.log('');

  console.log('--- Status Codes ---');
  for (const [code, count] of Object.entries(report.summary.statusCodes)) {
    console.log(`  ${code}: ${count}`);
  }
  console.log('');

  console.log('--- Rate Limiting ---');
  const rl = report.summary.rateLimiting;
  console.log(`  Total requests:     ${rl.totalRequests}`);
  console.log(`  Rate limited (429): ${rl.rateLimited}`);
  console.log(`  Rate limit %:       ${rl.rateLimitPercentage}`);
  console.log('');

  if (Object.keys(report.summary.errors).length > 0) {
    console.log('--- Errors ---');
    for (const [type, count] of Object.entries(report.summary.errors)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log('');
  }

  console.log('--- Baseline Check ---');
  const bl = report.performanceBaseline;
  console.log(`  p95: ${bl.actualP95 ?? 'N/A'} ms (target: ${bl.p95Target})`);
  console.log(`  p99: ${bl.actualP99 ?? 'N/A'} ms (target: ${bl.p99Target})`);
  console.log(`  Error rate: ${bl.actualErrorRate} (target: ${bl.maxErrorRateTarget})`);
  console.log('');

  // Write JSON report
  if (outputFile) {
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`Report written to: ${outputFile}`);
  } else {
    // Default output location
    const defaultOutput = path.join(path.dirname(inputFile), 'reports', 'performance-report.json');
    const dir = path.dirname(defaultOutput);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(defaultOutput, JSON.stringify(report, null, 2));
    console.log(`Report written to: ${defaultOutput}`);
  }
}

// Export for use as a module
module.exports = { generateReport, extractLatency, extractErrors, extractStatusCodes, extractThroughput };

// Run CLI if executed directly
if (require.main === module) {
  main();
}


