// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// =============================================================================
// Observability – Lightweight Prometheus-compatible Metrics
// =============================================================================

interface CounterEntry {
  value: number
  labels: Record<string, string>
  help: string
}

interface GaugeEntry {
  value: number
  labels: Record<string, string>
  help: string
}

interface HistogramEntry {
  values: number[]
  labels: Record<string, string>
  help: string
  buckets: number[]
}

const DEFAULT_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
const MAX_HISTOGRAM_VALUES = 1000

export class MetricsCollector {
  private counters: Map<string, CounterEntry> = new Map()
  private gauges: Map<string, GaugeEntry> = new Map()
  private histograms: Map<string, HistogramEntry> = new Map()

  /** Increment a counter by `amount` (default 1). */
  counter(
    name: string,
    help: string,
    labels: Record<string, string> = {},
    amount: number = 1,
  ): void {
    const key = this.makeKey(name, labels)
    const existing = this.counters.get(key)
    if (existing) {
      existing.value += amount
    } else {
      this.counters.set(key, { value: amount, labels, help })
    }
  }

  /** Set a gauge to an absolute value. */
  gauge(
    name: string,
    value: number,
    help: string,
    labels: Record<string, string> = {},
  ): void {
    const key = this.makeKey(name, labels)
    this.gauges.set(key, { value, labels, help })
  }

  /** Record a value in a histogram. */
  histogram(
    name: string,
    value: number,
    help: string,
    labels: Record<string, string> = {},
    buckets?: number[],
  ): void {
    const key = this.makeKey(name, labels)
    const existing = this.histograms.get(key)
    if (existing) {
      existing.values.push(value)
      if (existing.values.length > MAX_HISTOGRAM_VALUES) existing.values.shift()
    } else {
      this.histograms.set(key, {
        values: [value],
        labels,
        help,
        buckets: buckets ?? DEFAULT_BUCKETS,
      })
    }
  }

  /** Output metrics in Prometheus text exposition format. */
  toPrometheus(): string {
    const lines: string[] = []
    const emittedTypes = new Set<string>()

    for (const [key, counter] of this.counters) {
      const baseName = key.split('{')[0]
      if (!emittedTypes.has(baseName)) {
        lines.push(`# HELP ${baseName} ${counter.help}`)
        lines.push(`# TYPE ${baseName} counter`)
        emittedTypes.add(baseName)
      }
      lines.push(`${key} ${counter.value}`)
    }

    for (const [key, gauge] of this.gauges) {
      const baseName = key.split('{')[0]
      if (!emittedTypes.has(baseName)) {
        lines.push(`# HELP ${baseName} ${gauge.help}`)
        lines.push(`# TYPE ${baseName} gauge`)
        emittedTypes.add(baseName)
      }
      lines.push(`${key} ${gauge.value}`)
    }

    for (const [key, hist] of this.histograms) {
      const baseName = key.split('{')[0]
      if (!emittedTypes.has(baseName)) {
        lines.push(`# HELP ${baseName} ${hist.help}`)
        lines.push(`# TYPE ${baseName} histogram`)
        emittedTypes.add(baseName)
      }
      const sorted = [...hist.values].sort((a, b) => a - b)
      for (const bucket of hist.buckets) {
        const count = sorted.filter((v) => v <= bucket).length
        lines.push(`${baseName}_bucket{le="${bucket}"} ${count}`)
      }
      lines.push(`${baseName}_bucket{le="+Inf"} ${sorted.length}`)
      lines.push(
        `${baseName}_sum ${sorted.reduce((a, b) => a + b, 0)}`,
      )
      lines.push(`${baseName}_count ${sorted.length}`)
    }

    return lines.join('\n')
  }

  /** JSON summary suitable for an admin panel. */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, counter] of this.counters) {
      result[key] = counter.value
    }

    for (const [key, gauge] of this.gauges) {
      result[key] = gauge.value
    }

    for (const [key, hist] of this.histograms) {
      const sorted = [...hist.values].sort((a, b) => a - b)
      result[key] = {
        count: sorted.length,
        mean: sorted.length
          ? sorted.reduce((a, b) => a + b, 0) / sorted.length
          : 0,
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
      }
    }

    return result
  }

  /** Reset all metrics. */
  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
  }

  private makeKey(name: string, labels: Record<string, string>): string {
    const entries = Object.entries(labels)
    if (entries.length === 0) return name
    const labelStr = entries
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
    return `${name}{${labelStr}}`
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let metricsInstance: MetricsCollector | null = null

export function getMetrics(): MetricsCollector {
  if (!metricsInstance) metricsInstance = new MetricsCollector()
  return metricsInstance
}

// ---------------------------------------------------------------------------
// Process-level metrics collection
// ---------------------------------------------------------------------------

let processMetricsInterval: ReturnType<typeof setInterval> | null = null

export function startProcessMetrics(intervalMs: number = 15000): void {
  stopProcessMetrics()
  const metrics = getMetrics()

  const collect = () => {
    const mem = process.memoryUsage()
    metrics.gauge('xspace_memory_heap_used_bytes', mem.heapUsed, 'Heap memory used')
    metrics.gauge('xspace_memory_rss_bytes', mem.rss, 'Resident set size')
    metrics.gauge('xspace_uptime_seconds', process.uptime(), 'Process uptime')
  }

  collect()
  processMetricsInterval = setInterval(collect, intervalMs)
  processMetricsInterval.unref()
}

export function stopProcessMetrics(): void {
  if (processMetricsInterval) {
    clearInterval(processMetricsInterval)
    processMetricsInterval = null
  }
}


