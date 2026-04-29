// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Plugin Manager — Orchestrates plugin lifecycle and hook execution
// =============================================================================

import type { Plugin, PluginContext } from './types'

export class PluginManager {
  private plugins: Plugin[] = []
  private context: PluginContext

  constructor(context: PluginContext) {
    this.context = context
  }

  /** Register a plugin. Validates required fields and prevents duplicates. */
  use(plugin: Plugin): void {
    if (!plugin.name || !plugin.version) {
      throw new Error('Plugin must have name and version')
    }
    if (this.plugins.find((p) => p.name === plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`)
    }
    this.plugins.push(plugin)
  }

  /** Initialize all registered plugins by calling onInit. */
  async init(): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.onInit?.(this.context)
      } catch (error) {
        this.context.log('error', `Plugin '${plugin.name}' failed to initialize`, { error })
      }
    }
  }

  /**
   * Run a pipeline hook through all plugins sequentially.
   * Each plugin receives the previous plugin's output.
   * Returning null from any plugin vetoes the pipeline (short-circuits).
   */
  async runHook<T>(hookName: string, initialValue: T, ...args: unknown[]): Promise<T> {
    let value = initialValue

    for (const plugin of this.plugins) {
      const hook = (plugin as unknown as Record<string, unknown>)[hookName]
      if (typeof hook !== 'function') continue

      try {
        const result = await hook.call(plugin, value, ...args)
        if (result === null) return null as T
        if (result !== undefined) value = result
      } catch (error) {
        this.context.log('error', `Plugin '${plugin.name}' hook '${hookName}' failed`, { error })
        // Continue to next plugin — one failure shouldn't break the chain
      }
    }

    return value
  }

  /** Run a notification hook (fire-and-forget, no return value). */
  async notify(hookName: string, ...args: unknown[]): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = (plugin as unknown as Record<string, unknown>)[hookName]
      if (typeof hook !== 'function') continue

      try {
        await hook.call(plugin, ...args)
      } catch (error) {
        this.context.log('error', `Plugin '${plugin.name}' hook '${hookName}' failed`, { error })
      }
    }
  }

  /** Destroy all plugins in reverse order. */
  async destroy(): Promise<void> {
    for (const plugin of [...this.plugins].reverse()) {
      try {
        await plugin.onDestroy?.()
      } catch (error) {
        this.context.log('error', `Plugin '${plugin.name}' failed to destroy`, { error })
      }
    }
    this.plugins = []
  }

  /** Return metadata for all registered plugins. */
  getPlugins(): Array<{ name: string; version: string; description?: string }> {
    return this.plugins.map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
    }))
  }
}


