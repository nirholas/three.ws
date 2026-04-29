// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Provider Router — Smart Routing with Automatic Failover
// =============================================================================

import type {
  RoutableProvider,
  RoutingStrategy,
  RoutingPriority,
  ProviderStatus,
  RouterConfig,
} from './types'

export class ProviderRouter<T extends RoutableProvider> {
  private providers: T[]
  private strategy: RoutingStrategy
  private primaryIndex: number
  private healthRecheckMs: number
  private healthStatus: Map<string, boolean> = new Map()
  private enabled: Map<string, boolean> = new Map()
  private recheckTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  constructor(config: RouterConfig<T>) {
    this.providers = config.providers
    this.strategy = config.strategy
    this.primaryIndex = config.primaryIndex ?? 0
    this.healthRecheckMs = config.healthRecheckMs ?? 30_000

    // Mark all as enabled and healthy by default
    for (const p of this.providers) {
      this.healthStatus.set(p.name, true)
      this.enabled.set(p.name, true)
    }

    // Fire-and-forget initial health check
    this.checkAll().catch(() => {})
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /** Get the best available provider for a request. */
  select(hint?: RoutingPriority): T {
    const available = this.getAvailable()
    if (available.length === 0) {
      // All unavailable — return primary as a last resort
      return this.providers[this.primaryIndex]
    }

    switch (this.strategy) {
      case 'primary-fallback':
        return this.primaryFallback(available)
      case 'latency-based':
        return this.selectByLatency(available)
      case 'cost-based':
        return this.selectByCost(available)
      case 'smart':
        return this.smartSelect(available, hint)
      default:
        return available[0]
    }
  }

  // ---------------------------------------------------------------------------
  // Execute with Fallback
  // ---------------------------------------------------------------------------

  /**
   * Execute an operation with automatic failover across providers.
   * If the selected provider fails, the next available one is tried.
   */
  async executeWithFallback<R>(
    fn: (provider: T) => Promise<R>,
    hint?: RoutingPriority,
  ): Promise<R> {
    const tried = new Set<string>()
    const ordered = this.getOrderedProviders(hint)

    for (const provider of ordered) {
      if (tried.has(provider.name)) continue
      tried.add(provider.name)

      try {
        return await fn(provider)
      } catch (error) {
        this.markUnhealthy(provider.name)
        // Continue to next provider
      }
    }

    throw new Error(
      `All providers failed (tried: ${[...tried].join(', ')})`,
    )
  }

  // ---------------------------------------------------------------------------
  // Admin Controls
  // ---------------------------------------------------------------------------

  /** Temporarily disable a provider. */
  disable(name: string): boolean {
    if (!this.providers.some((p) => p.name === name)) return false
    this.enabled.set(name, false)
    return true
  }

  /** Re-enable a provider and re-check its health. */
  enable(name: string): boolean {
    const provider = this.providers.find((p) => p.name === name)
    if (!provider) return false
    this.enabled.set(name, true)
    this.checkHealth(provider).catch(() => {})
    return true
  }

  /** Get full status of all providers. */
  getStatus(): ProviderStatus[] {
    return this.providers.map((p) => ({
      name: p.name,
      healthy: this.healthStatus.get(p.name) ?? true,
      enabled: this.enabled.get(p.name) ?? true,
      metrics: p.getMetrics(),
    }))
  }

  /** Get all registered providers. */
  getProviders(): T[] {
    return [...this.providers]
  }

  /** Get the current routing strategy. */
  getStrategy(): RoutingStrategy {
    return this.strategy
  }

  /** Update the routing strategy at runtime. */
  setStrategy(strategy: RoutingStrategy): void {
    this.strategy = strategy
  }

  /** Clean up timers. */
  destroy(): void {
    for (const timer of this.recheckTimers.values()) {
      clearTimeout(timer)
    }
    this.recheckTimers.clear()
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private getAvailable(): T[] {
    return this.providers.filter(
      (p) =>
        this.healthStatus.get(p.name) !== false &&
        this.enabled.get(p.name) !== false,
    )
  }

  /** Return providers ordered by preference for the given hint. */
  private getOrderedProviders(hint?: RoutingPriority): T[] {
    const available = this.getAvailable()
    const rest = this.providers.filter((p) => !available.includes(p))

    // Sort available by strategy, then append unavailable as last-resort
    const sorted = [...available]
    if (this.strategy === 'latency-based' || hint === 'speed') {
      sorted.sort(
        (a, b) => a.getMetrics().avgLatencyMs - b.getMetrics().avgLatencyMs,
      )
    } else if (this.strategy === 'cost-based' || hint === 'cost') {
      sorted.sort(
        (a, b) => a.estimateCost(1000) - b.estimateCost(1000),
      )
    } else {
      // primary-fallback / quality: put primary first
      const primary = this.providers[this.primaryIndex]
      const idx = sorted.indexOf(primary)
      if (idx > 0) {
        sorted.splice(idx, 1)
        sorted.unshift(primary)
      }
    }

    return [...sorted, ...rest]
  }

  private primaryFallback(available: T[]): T {
    const primary = this.providers[this.primaryIndex]
    if (available.includes(primary)) return primary
    return available[0]
  }

  private selectByLatency(available: T[]): T {
    return available.reduce((best, cur) =>
      cur.getMetrics().avgLatencyMs < best.getMetrics().avgLatencyMs
        ? cur
        : best,
    )
  }

  private selectByCost(available: T[]): T {
    return available.reduce((best, cur) =>
      cur.estimateCost(1000) < best.estimateCost(1000) ? cur : best,
    )
  }

  private smartSelect(available: T[], hint?: RoutingPriority): T {
    if (hint === 'speed') return this.selectByLatency(available)
    if (hint === 'cost') return this.selectByCost(available)
    // Default (quality) — use primary
    return this.primaryFallback(available)
  }

  private markUnhealthy(name: string): void {
    this.healthStatus.set(name, false)

    // Clear any existing re-check timer
    const existing = this.recheckTimers.get(name)
    if (existing) clearTimeout(existing)

    // Schedule re-check
    const provider = this.providers.find((p) => p.name === name)
    if (provider) {
      const timer = setTimeout(() => {
        this.recheckTimers.delete(name)
        this.checkHealth(provider).catch(() => {})
      }, this.healthRecheckMs)
      this.recheckTimers.set(name, timer)
    }
  }

  private async checkAll(): Promise<void> {
    await Promise.allSettled(
      this.providers.map((p) => this.checkHealth(p)),
    )
  }

  private async checkHealth(provider: T): Promise<void> {
    try {
      const result = await provider.checkHealth()
      this.healthStatus.set(provider.name, result.ok)
    } catch {
      this.healthStatus.set(provider.name, false)
    }
  }
}


