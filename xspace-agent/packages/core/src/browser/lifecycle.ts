// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { EventEmitter } from 'events'
import type { Page } from 'puppeteer'
import type { AuthConfig, BrowserConfig } from '../types'
import { BrowserManager } from './launcher'
import { login } from './auth'
import * as spaceUI from './space-ui'
import type { SpaceUIOptions } from './space-ui'
import { injectAudioHooks } from '../audio/bridge'
import { SelectorEngine } from './selector-engine'
import { DOMObserver } from './observer'
import { SELECTOR_DEFINITIONS } from './selectors'
import { BrowserConnectionError } from '../errors'
import { getLogger } from '../logger'

export interface BrowserLifecycleEvents {
  status: (status: string) => void
  error: (error: Error) => void
}

export class BrowserLifecycle {
  private browserManager: BrowserManager | null = null
  private page: Page | null = null
  private readonly browserConfig?: BrowserConfig
  private readonly authConfig: AuthConfig
  private readonly emitter = new EventEmitter()

  private selectorEngine: SelectorEngine
  private observer: DOMObserver | null = null
  private onAudioData: ((pcmBase64: string, sampleRate: number) => void) | null = null
  private audioHooksInjected = false

  constructor(browserConfig: BrowserConfig | undefined, authConfig: AuthConfig) {
    this.browserConfig = browserConfig
    this.authConfig = authConfig
    this.selectorEngine = new SelectorEngine(SELECTOR_DEFINITIONS)
  }

  get isConnectMode(): boolean {
    return this.browserManager?.isConnectMode ?? false
  }

  async launch(onAudioData: (pcmBase64: string, sampleRate: number) => void): Promise<Page> {
    if (this.browserManager) {
      throw new BrowserConnectionError(
        this.browserConfig?.mode ?? 'managed',
        'Browser already launched. Call cleanup() first.',
      )
    }

    this.browserManager = new BrowserManager(this.browserConfig)
    const { page } = await this.browserManager.launch()
    this.page = page

    // Store callback — hooks are injected after joinSpace() so X's WebRTC
    // connection initialises without interference from the audio bridge.
    this.onAudioData = onAudioData

    // Initialize CDP-based DOM observer
    this.observer = new DOMObserver(page, this.selectorEngine)
    await this.observer.start()

    return page
  }

  async authenticate(): Promise<void> {
    if (!this.page) throw new Error('Browser not launched')

    // Skip authentication in connect mode — already logged in via Chrome
    if (this.isConnectMode) {
      return
    }

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })
    internalEmitter.on('2fa-required', () => {
      this.emitter.emit('error', new Error('2FA required — provide auth token instead of username/password'))
    })

    await login(this.page, this.authConfig, internalEmitter, {
      selectorEngine: this.selectorEngine,
    })
  }

  async joinSpace(spaceUrl: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    const opts = this.getSpaceUIOptions()

    await spaceUI.joinSpace(this.page, spaceUrl, internalEmitter, opts)

    // Wait for post-join Space UI to stabilise — poll via evaluate since
    // X renders Space dock elements that waitForSelector may not detect
    const deadline = Date.now() + 20000
    let dockFound = false
    while (Date.now() < deadline) {
      dockFound = await this.page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, [role="button"]')]
        return btns.some(b => {
          const label = (b.getAttribute('aria-label') || '').toLowerCase()
          const text = (b.textContent || '').trim().toLowerCase()
          return label.includes('request to speak') || label.includes('unmute') ||
                 label.includes('mute') || label.includes('microphone') ||
                 text === 'leave'
        })
      })
      if (dockFound) {
        getLogger().info('[X-Spaces] Post-join Space dock detected')
        await new Promise(r => setTimeout(r, 2000))
        break
      }
      await new Promise(r => setTimeout(r, 1000))
    }
    if (!dockFound) {
      getLogger().warn('[X-Spaces] Post-join UI controls did not appear within 20s')

      // Check if we're still on the Space page — X may have redirected to home feed
      const currentUrl = this.page.url()
      if (!currentUrl.includes('/spaces/')) {
        getLogger().info(`[X-Spaces] Not on Space page (${currentUrl}), re-navigating to: ${spaceUrl}`)
        await this.page.goto(spaceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await new Promise(r => setTimeout(r, 5000))
      } else {
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    // Inject audio hooks now — after X's WebRTC connection is established,
    // so the bridge doesn't interfere with the initial peer connection setup.
    if (!this.audioHooksInjected && this.onAudioData) {
      await injectAudioHooks(this.page, this.onAudioData, this.browserConfig?.mode)
      this.audioHooksInjected = true
      getLogger().info('[X-Spaces] Audio hooks injected post-join')
      await new Promise(r => setTimeout(r, 1000))
    }

    // requestSpeaker() now polls internally for up to 20s
    const speakerResult = await spaceUI.requestSpeaker(this.page, internalEmitter, opts)
    if (speakerResult === 'requested') {
      await spaceUI.waitForSpeakerAccess(this.page, internalEmitter, 300000, opts)
    } else if (speakerResult === 'granted') {
      await spaceUI.aggressiveUnmute(this.page, internalEmitter, opts, 5)
    } else {
      // Could not find request-to-speak — may already be a speaker/host,
      // or the UI hasn't loaded. Try aggressive unmute as a last resort.
      getLogger().warn('[X-Spaces] Request-to-speak button not found, attempting aggressive unmute')
      await spaceUI.aggressiveUnmute(this.page, internalEmitter, opts, 5)
    }
  }

  /**
   * Join a Space as a listener only — does NOT request to speak or unmute.
   * Use `requestToSpeak()`, `waitForSpeakerAccess()`, and `unmuteInSpace()`
   * separately for granular control.
   */
  async joinAsListener(spaceUrl: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    const opts = this.getSpaceUIOptions()
    await spaceUI.joinSpace(this.page, spaceUrl, internalEmitter, opts)

    // Wait for Space dock to confirm we've joined
    try {
      await this.page.waitForSelector(
        '[data-testid="SpaceDockExpanded"], [data-testid="SpaceDockCollapsed"], button[aria-label="Request to speak"], button[aria-label*="Request"], button[aria-label*="microphone"]',
        { timeout: 20000 },
      )
      await new Promise(r => setTimeout(r, 2000))
    } catch {
      getLogger().warn('[X-Spaces] Post-join UI did not appear within 20s, proceeding anyway')
      await new Promise(r => setTimeout(r, 3000))
    }

    // Debug: dump dock state and buttons after joining
    const dockState = await this.page.evaluate(() => ({
      expanded: !!document.querySelector('[data-testid="SpaceDockExpanded"]'),
      collapsed: !!document.querySelector('[data-testid="SpaceDockCollapsed"]'),
      buttons: [...document.querySelectorAll('button, [role="button"]')]
        .map(b => ({
          label: b.getAttribute('aria-label') || '',
          text: (b.textContent || '').trim().slice(0, 40),
          testid: b.getAttribute('data-testid') || '',
        }))
        .filter(b => b.label || b.text)
        .slice(0, 20),
    }))
    getLogger().info(`[X-Spaces] Post-join dock state: expanded=${dockState.expanded}, collapsed=${dockState.collapsed}`)
    getLogger().info(`[X-Spaces] Post-join buttons: ${JSON.stringify(dockState.buttons)}`)

    // Inject audio hooks after joining as listener too
    if (!this.audioHooksInjected && this.onAudioData) {
      await injectAudioHooks(this.page, this.onAudioData, this.browserConfig?.mode)
      this.audioHooksInjected = true
      getLogger().info('[X-Spaces] Audio hooks injected post-join (listener)')
      await new Promise(r => setTimeout(r, 1000))
    }

    getLogger().info('[X-Spaces] Joined as listener')
  }

  /**
   * Request to speak in the current Space.
   * @returns `"granted"` if already a speaker, `"requested"` if the request
   *          was sent, or `false` if the button wasn't found.
   */
  async requestToSpeak(): Promise<'granted' | 'requested' | false> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.requestSpeaker(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  /**
   * Wait for the host to grant speaker access.
   * Resolves `true` when access is granted, throws on timeout or Space end.
   */
  async waitForSpeakerAccess(timeoutMs: number = 300000): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.waitForSpeakerAccess(this.page, internalEmitter, timeoutMs, this.getSpaceUIOptions())
  }

  /**
   * Click the unmute button in the Space UI.
   */
  async unmuteInSpace(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.unmute(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  /**
   * Check if the mic is muted and auto-unmute if needed.
   * Call this before speaking to recover from accidental mutes.
   */
  async ensureUnmuted(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.ensureUnmuted(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  /**
   * Aggressively unmute using every click strategy (CDP, dispatchClick,
   * forceClick, el.click, page.mouse.click) with retries.
   * Also pre-grants mic permission via CDP and expands collapsed dock.
   */
  async aggressiveUnmuteInSpace(maxAttempts: number = 5): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.aggressiveUnmute(this.page, internalEmitter, this.getSpaceUIOptions(), maxAttempts)
  }

  /**
   * Check if the mic is currently unmuted in the Space UI.
   */
  async isMicUnmuted(): Promise<boolean> {
    if (!this.page) return false
    return spaceUI.isMicUnmuted(this.page)
  }

  /**
   * Click the mute button in the Space UI.
   */
  async muteInSpace(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not launched')

    const internalEmitter = new EventEmitter()
    internalEmitter.on('status', (s: string) => {
      this.emitter.emit('status', s)
    })

    return spaceUI.muteSpace(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  async leaveSpace(): Promise<void> {
    if (!this.page) return

    const internalEmitter = new EventEmitter()
    await spaceUI.leaveSpace(this.page, internalEmitter, this.getSpaceUIOptions())
  }

  async cleanup(): Promise<void> {
    if (this.observer) {
      await this.observer.stop()
      this.observer = null
    }
    if (this.browserManager) {
      await this.browserManager.close()
      this.browserManager = null
      this.page = null
    }
  }

  getPage(): Page | null {
    return this.page
  }

  getSelectorEngine(): SelectorEngine {
    return this.selectorEngine
  }

  getObserver(): DOMObserver | null {
    return this.observer
  }

  getSpaceUIOptions(): SpaceUIOptions {
    return {
      selectorEngine: this.selectorEngine,
      observer: this.observer ?? undefined,
    }
  }

  on<K extends keyof BrowserLifecycleEvents>(event: K, listener: BrowserLifecycleEvents[K]): void {
    this.emitter.on(event, listener)
  }
}


