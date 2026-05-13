// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Provider Health Monitor — Periodic Health Checks
// =============================================================================

import type { RoutableProvider, HealthCheckResult } from './types'

export interface HealthEvent {
  name: string
  healthy: boolean
  latencyMs: number
  error?: string
  timestamp: number
}

export type HealthEventHandler = (event: HealthEvent) => void

export class ProviderHealthMonitor {
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map()
  private lastResults: Map<string, HealthEvent> = new Map()
  private listeners: HealthEventHandler[] = []

  /** Subscribe to health change events. */
  onHealthChange(handler: HealthEventHandler): void {
    this.listeners.push(handler)
  }

  /** Start monitoring a set of providers at the given interval. */
  startMonitoring(
    providers: RoutableProvider[],
    intervalMs = 60_000,
  ): void {
    for (const provider of providers) {
      // Skip if already monitoring
      if (this.intervals.has(provider.name)) continue

      // Run an immediate check
      this.runCheck(provider).catch(() => {})

      const handle = setInterval(() => {
        this.runCheck(provider).catch(() => {})
      }, intervalMs)

      this.intervals.set(provider.name, handle)
    }
  }

  /** Stop monitoring a specific provider. */
  stopMonitoring(name: string): void {
    const handle = this.intervals.get(name)
    if (handle) {
      clearInterval(handle)
      this.intervals.delete(name)
    }
  }

  /** Stop all monitoring. */
  stopAll(): void {
    for (const handle of this.intervals.values()) {
      clearInterval(handle)
    }
    this.intervals.clear()
  }

  /** Get the last health check result for a provider. */
  getLastResult(name: string): HealthEvent | undefined {
    return this.lastResults.get(name)
  }

  /** Get all last-known health results. */
  getAllResults(): HealthEvent[] {
    return [...this.lastResults.values()]
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async runCheck(provider: RoutableProvider): Promise<void> {
    let result: HealthCheckResult
    try {
      result = await provider.checkHealth()
    } catch (err: any) {
      result = { ok: false, latencyMs: 0, error: err?.message ?? String(err) }
    }

    const previous = this.lastResults.get(provider.name)
    const event: HealthEvent = {
      name: provider.name,
      healthy: result.ok,
      latencyMs: result.latencyMs,
      error: result.error,
      timestamp: Date.now(),
    }
    this.lastResults.set(provider.name, event)

    // Notify only on state change (healthy→unhealthy or vice versa)
    if (!previous || previous.healthy !== result.ok) {
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch {
          // Ignore listener errors
        }
      }
    }
  }
}


