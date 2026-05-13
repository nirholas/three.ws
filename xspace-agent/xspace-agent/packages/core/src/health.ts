// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§71]

import type { Page } from 'puppeteer'
import type { AgentStatus } from './types'
import type { DOMObserver } from './browser/observer'
import * as spaceUI from './browser/space-ui'
import type { SpaceUIOptions } from './browser/space-ui'

import { getLogger } from './logger'

export class HealthMonitor {
  private page: Page | null = null
  private observer: DOMObserver | null = null
  private spaceUIOptions: SpaceUIOptions = {}
  private readonly intervalMs: number
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private muteCheckInterval: ReturnType<typeof setInterval> | null = null
  private statusChangeHandler: ((status: AgentStatus) => void) | null = null
  private errorHandler: ((error: Error) => void) | null = null
  private spaceEndedHandler: (() => void) | null = null
  private observerBound = false
  private autoUnmuteEnabled = false
  private _unmuteEmitter: import('events').EventEmitter | null = null

  constructor(intervalMs: number = 10000) {
    this.intervalMs = intervalMs
  }

  setPage(page: Page): void {
    this.page = page
  }

  setObserver(observer: DOMObserver): void {
    this.observer = observer
  }

  setSpaceUIOptions(opts: SpaceUIOptions): void {
    this.spaceUIOptions = opts
  }

  onStatusChange(handler: (status: AgentStatus) => void): void {
    this.statusChangeHandler = handler
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler
  }

  onSpaceEnded(handler: () => void): void {
    this.spaceEndedHandler = handler
  }

  /**
   * Enable periodic mute-state monitoring.
   * If the mic is detected as muted, automatically unmutes it.
   * Protects against accidental mutes, UI glitches, or network reconnects.
   *
   * @param emitter - EventEmitter for status events during unmute
   * @param intervalMs - How often to check mute state (default: 15s)
   */
  enableAutoUnmute(emitter: import('events').EventEmitter, intervalMs: number = 15000): void {
    this.autoUnmuteEnabled = true
    this._unmuteEmitter = emitter

    // Don't start a separate interval if start() hasn't been called yet
    if (this.healthCheckInterval) {
      this.startMuteCheck(intervalMs)
    }
  }

  disableAutoUnmute(): void {
    this.autoUnmuteEnabled = false
    this._unmuteEmitter = null
    if (this.muteCheckInterval) {
      clearInterval(this.muteCheckInterval)
      this.muteCheckInterval = null
    }
  }

  start(): void {
    this.stop()

    // ── Event-driven path: use observer for Space-ended detection ──
    if (this.observer) {
      this.bindObserver()
    }

    // ── Fallback polling: runs at a reduced rate when observer is active,
    //    serving as a safety net in case CDP events are missed ──
    const interval = this.observer ? this.intervalMs * 3 : this.intervalMs
    this.healthCheckInterval = setInterval(async () => {
      if (!this.page) {
        this.stop()
        return
      }

      try {
        const state = await spaceUI.getSpaceState(this.page, this.spaceUIOptions)
        if (state.hasEnded) {
          this.statusChangeHandler?.('space-ended')
          this.spaceEndedHandler?.()
          this.stop()
        }
      } catch (err) {
        this.errorHandler?.(
          new Error(`Health check failed: ${err instanceof Error ? err.message : String(err)}`)
        )
      }
    }, interval)

    // ── Start mute-state monitoring if enabled ──
    if (this.autoUnmuteEnabled) {
      this.startMuteCheck(15000)
    }
  }

  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.muteCheckInterval) {
      clearInterval(this.muteCheckInterval)
      this.muteCheckInterval = null
    }
    this.unbindObserver()
  }

  // ── Private ──────────────────────────────────────────────────

  private startMuteCheck(intervalMs: number): void {
    if (this.muteCheckInterval) return
    let checking = false

    this.muteCheckInterval = setInterval(async () => {
      if (!this.page || !this._unmuteEmitter || checking) return
      checking = true
      try {
        const muted = !(await spaceUI.isMicUnmuted(this.page))
        if (muted) {
          getLogger().warn('[HealthMonitor] Mic detected as muted — auto-recovering...')
          await spaceUI.ensureUnmuted(this.page, this._unmuteEmitter!, this.spaceUIOptions)
        }
      } catch (err) {
        getLogger().debug(`[HealthMonitor] Auto-unmute check failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        checking = false
      }
    }, intervalMs)
  }

  private bindObserver(): void {
    if (!this.observer || this.observerBound) return
    this.observerBound = true

    // Space ended detected via DOM mutation
    this.observer.on('element:appeared', this.onSpaceEndedAppeared)

    // WebSocket close = Space audio stream disconnected
    this.observer.on('network:ws-closed', this.onWsClosed)
  }

  private unbindObserver(): void {
    if (!this.observer || !this.observerBound) return
    this.observerBound = false

    this.observer.removeListener('element:appeared', this.onSpaceEndedAppeared)
    this.observer.removeListener('network:ws-closed', this.onWsClosed)
  }

  private onSpaceEndedAppeared = (name: string): void => {
    if (name === 'space-ended') {
      this.statusChangeHandler?.('space-ended')
      this.spaceEndedHandler?.()
      this.stop()
    }
  }

  private onWsClosed = (): void => {
    // WebSocket close is a strong signal but not definitive (may reconnect).
    // Trigger a check to confirm.
    if (!this.page) return
    spaceUI.getSpaceState(this.page, this.spaceUIOptions).then((state) => {
      if (state.hasEnded) {
        this.statusChangeHandler?.('space-ended')
        this.spaceEndedHandler?.()
        this.stop()
      }
    }).catch(() => {
      // Page may be closed — treat as ended
      this.statusChangeHandler?.('space-ended')
      this.spaceEndedHandler?.()
      this.stop()
    })
  }
}


