// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Observability Stack Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { MetricsCollector, getMetrics } from '../observability/metrics'
import { createLogger, getAppLogger } from '../observability/logger'
import { SocketLogTransport } from '../observability/log-transport'

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

describe('MetricsCollector', () => {
  let metrics: MetricsCollector

  beforeEach(() => {
    metrics = new MetricsCollector()
  })

  describe('counter', () => {
    it('should increment a counter by 1', () => {
      metrics.counter('requests_total', 'Total requests')
      metrics.counter('requests_total', 'Total requests')
      metrics.counter('requests_total', 'Total requests')
      const json = metrics.toJSON()
      expect(json['requests_total']).toBe(3)
    })

    it('should increment by custom amount', () => {
      metrics.counter('tokens_total', 'Total tokens', {}, 50)
      metrics.counter('tokens_total', 'Total tokens', {}, 30)
      const json = metrics.toJSON()
      expect(json['tokens_total']).toBe(80)
    })

    it('should separate counters by labels', () => {
      metrics.counter('requests_total', 'Total requests', { provider: 'openai' })
      metrics.counter('requests_total', 'Total requests', { provider: 'claude' })
      metrics.counter('requests_total', 'Total requests', { provider: 'openai' })
      const json = metrics.toJSON()
      expect(json['requests_total{provider="openai"}']).toBe(2)
      expect(json['requests_total{provider="claude"}']).toBe(1)
    })
  })

  describe('gauge', () => {
    it('should set absolute values', () => {
      metrics.gauge('memory_bytes', 1000, 'Memory used')
      expect(metrics.toJSON()['memory_bytes']).toBe(1000)

      metrics.gauge('memory_bytes', 2000, 'Memory used')
      expect(metrics.toJSON()['memory_bytes']).toBe(2000)
    })

    it('should support labels', () => {
      metrics.gauge('active', 1, 'Active state', { type: 'space' })
      metrics.gauge('active', 0, 'Active state', { type: 'browser' })
      const json = metrics.toJSON()
      expect(json['active{type="space"}']).toBe(1)
      expect(json['active{type="browser"}']).toBe(0)
    })
  })

  describe('histogram', () => {
    it('should track value distributions', () => {
      metrics.histogram('latency_ms', 100, 'Latency')
      metrics.histogram('latency_ms', 200, 'Latency')
      metrics.histogram('latency_ms', 300, 'Latency')
      metrics.histogram('latency_ms', 150, 'Latency')
      metrics.histogram('latency_ms', 50, 'Latency')

      const json = metrics.toJSON() as any
      const hist = json['latency_ms']
      expect(hist.count).toBe(5)
      expect(hist.mean).toBe(160)
      expect(hist.p50).toBeDefined()
      expect(hist.p95).toBeDefined()
      expect(hist.p99).toBeDefined()
    })

    it('should bound histogram values to 1000 entries', () => {
      for (let i = 0; i < 1100; i++) {
        metrics.histogram('big_hist', i, 'Big histogram')
      }
      const json = metrics.toJSON() as any
      expect(json['big_hist'].count).toBeLessThanOrEqual(1000)
    })
  })

  describe('toPrometheus', () => {
    it('should output valid Prometheus text format', () => {
      metrics.counter('http_requests_total', 'Total HTTP requests', { method: 'GET' })
      metrics.counter('http_requests_total', 'Total HTTP requests', { method: 'GET' })
      metrics.gauge('memory_bytes', 12345, 'Memory in bytes')
      metrics.histogram('response_time_ms', 42, 'Response time', {}, [10, 50, 100, 500])

      const output = metrics.toPrometheus()

      // Should contain TYPE annotations
      expect(output).toContain('# TYPE http_requests_total counter')
      expect(output).toContain('http_requests_total{method="GET"} 2')

      expect(output).toContain('# TYPE memory_bytes gauge')
      expect(output).toContain('memory_bytes 12345')

      expect(output).toContain('# TYPE response_time_ms histogram')
      expect(output).toContain('response_time_ms_bucket{le="10"} 0')
      expect(output).toContain('response_time_ms_bucket{le="50"} 1')
      expect(output).toContain('response_time_ms_bucket{le="+Inf"} 1')
      expect(output).toContain('response_time_ms_count 1')
      expect(output).toContain('response_time_ms_sum 42')
    })

    it('should not duplicate TYPE annotations for same metric name', () => {
      metrics.counter('req_total', 'Requests', { status: '200' })
      metrics.counter('req_total', 'Requests', { status: '500' })

      const output = metrics.toPrometheus()
      const typeLines = output.split('\n').filter((l) => l.includes('# TYPE req_total'))
      expect(typeLines.length).toBe(1)
    })
  })

  describe('reset', () => {
    it('should clear all metrics', () => {
      metrics.counter('a', 'A')
      metrics.gauge('b', 1, 'B')
      metrics.histogram('c', 10, 'C')

      metrics.reset()

      const json = metrics.toJSON()
      expect(Object.keys(json).length).toBe(0)
      expect(metrics.toPrometheus()).toBe('')
    })
  })

  describe('singleton', () => {
    it('should return the same instance', () => {
      const a = getMetrics()
      const b = getMetrics()
      expect(a).toBe(b)
    })
  })
})

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

describe('createLogger', () => {
  it('should create a pino logger with the given name', () => {
    const logger = createLogger('test-logger')
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  it('should support child loggers', () => {
    const parent = createLogger('parent')
    const child = parent.child({ module: 'child-module' })
    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
  })

  it('should respect log level configuration', () => {
    const logger = createLogger('test', { level: 'error' })
    expect(logger.level).toBe('error')
  })
})

describe('getAppLogger', () => {
  it('should return a logger instance', () => {
    const logger = getAppLogger()
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
  })

  it('should create child logger when name is provided', () => {
    const child = getAppLogger('my-module')
    expect(child).toBeDefined()
    expect(typeof child.info).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// SocketLogTransport
// ---------------------------------------------------------------------------

describe('SocketLogTransport', () => {
  it('should emit log entries to admin room', async () => {
    const emitted: any[] = []
    const mockIO = {
      to: (room: string) => ({
        emit: (event: string, data: unknown) => {
          emitted.push({ room, event, data })
        },
      }),
    }

    const transport = new SocketLogTransport(mockIO)

    const logEntry = JSON.stringify({
      level: 30,
      time: Date.now(),
      msg: 'test message',
      module: 'test-module',
      extra: 'data',
    })

    await new Promise<void>((resolve) => {
      transport.write(logEntry, 'utf8', () => resolve())
    })

    expect(emitted.length).toBe(1)
    expect(emitted[0].room).toBe('admin')
    expect(emitted[0].event).toBe('log')
    expect(emitted[0].data.level).toBe('info')
    expect(emitted[0].data.message).toBe('test message')
    expect(emitted[0].data.module).toBe('test-module')
  })

  it('should handle different log levels', async () => {
    const emitted: any[] = []
    const mockIO = {
      to: () => ({
        emit: (_: string, data: unknown) => {
          emitted.push(data)
        },
      }),
    }

    const transport = new SocketLogTransport(mockIO)

    const levels = [
      { level: 10, expected: 'trace' },
      { level: 20, expected: 'debug' },
      { level: 30, expected: 'info' },
      { level: 40, expected: 'warn' },
      { level: 50, expected: 'error' },
      { level: 60, expected: 'fatal' },
    ]

    for (const { level } of levels) {
      await new Promise<void>((resolve) => {
        transport.write(
          JSON.stringify({ level, msg: 'test', time: Date.now() }),
          'utf8',
          () => resolve(),
        )
      })
    }

    expect(emitted.map((e: any) => e.level)).toEqual(
      levels.map((l) => l.expected),
    )
  })

  it('should not throw on malformed input', async () => {
    const mockIO = {
      to: () => ({
        emit: () => {},
      }),
    }

    const transport = new SocketLogTransport(mockIO)

    await new Promise<void>((resolve) => {
      transport.write('not valid json{{{', 'utf8', () => resolve())
    })
  })
})


