// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// CDP-based DOM observer
// Replaces polling loops with event-driven observation of DOM mutations,
// WebSocket lifecycle, and page navigation.
// =============================================================================

import { EventEmitter } from 'events';
import type { CDPSession, Page } from 'puppeteer';
import type { SelectorEngine } from './selector-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DOMObserverEvents {
  'element:appeared': (name: string) => void;
  'element:disappeared': (name: string) => void;
  'element:changed': (name: string, attributes: Record<string, string>) => void;
  'navigation': (url: string) => void;
  'dialog': (message: string) => void;
  'network:ws-closed': () => void;
}

interface WatchedState {
  found: boolean;
  selectorName: string; // maps to SelectorEngine definition name
}

// ---------------------------------------------------------------------------
// Observer
// ---------------------------------------------------------------------------

export class DOMObserver extends EventEmitter {
  private cdp: CDPSession | null = null;
  private page: Page;
  private selectorEngine: SelectorEngine;
  private watchedSelectors: Map<string, WatchedState> = new Map();
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(page: Page, selectorEngine: SelectorEngine) {
    super();
    this.page = page;
    this.selectorEngine = selectorEngine;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.cdp = await this.page.createCDPSession();

    // Enable CDP domains
    await this.cdp.send('DOM.enable');
    await this.cdp.send('Network.enable');

    // DOM mutation events → recheck watched selectors
    this.cdp.on('DOM.documentUpdated', () => this.scheduleRecheck());
    this.cdp.on('DOM.childNodeInserted', () => this.scheduleRecheck());
    this.cdp.on('DOM.childNodeRemoved', () => this.scheduleRecheck());
    this.cdp.on('DOM.attributeModified', (params: any) => {
      this.scheduleRecheck();
      this.onAttributeChange(params);
    });

    // WebSocket close → Space audio disconnected
    this.cdp.on('Network.webSocketClosed', () => {
      this.emit('network:ws-closed');
    });

    // Page navigation
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page.mainFrame()) {
        this.emit('navigation', this.page.url());
        this.scheduleRecheck();
      }
    });

    // Browser dialogs (e.g. "Leave Space?" confirmation)
    this.page.on('dialog', (dialog) => {
      this.emit('dialog', dialog.message());
    });
  }

  /** Watch for a named element (resolved by SelectorEngine) to appear/disappear. */
  watch(name: string): void {
    this.watchedSelectors.set(name, { found: false, selectorName: name });
    // Immediately check current state
    this.checkOne(name).catch(() => {});
  }

  /** Stop watching a named element. */
  unwatch(name: string): void {
    this.watchedSelectors.delete(name);
  }

  /** Check whether a watched element is currently found. */
  isFound(name: string): boolean {
    return this.watchedSelectors.get(name)?.found ?? false;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.recheckTimer) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
    try {
      await this.cdp?.detach();
    } catch { /* session may already be closed */ }
    this.cdp = null;
    this.watchedSelectors.clear();
    this.removeAllListeners();
  }

  // ── Private ────────────────────────────────────────────────

  /** Debounce DOM mutation bursts into a single recheck pass. */
  private scheduleRecheck(): void {
    if (this.recheckTimer) return; // already scheduled
    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null;
      this.recheckAll().catch(() => {});
    }, 150); // 150ms debounce
  }

  private async recheckAll(): Promise<void> {
    if (!this.running) return;
    for (const name of this.watchedSelectors.keys()) {
      await this.checkOne(name);
    }
  }

  private async checkOne(name: string): Promise<void> {
    const state = this.watchedSelectors.get(name);
    if (!state) return;

    let exists = false;
    try {
      const el = await this.selectorEngine.find(this.page, name);
      exists = el !== null;
      if (el) await el.dispose();
    } catch {
      exists = false;
    }

    if (exists && !state.found) {
      state.found = true;
      this.emit('element:appeared', name);
    } else if (!exists && state.found) {
      state.found = false;
      this.emit('element:disappeared', name);
    }
  }

  private onAttributeChange(params: { nodeId?: number; name?: string; value?: string }): void {
    // Emit a generic change event — consumers can filter by name
    for (const [watchName, state] of this.watchedSelectors) {
      if (state.found) {
        this.emit('element:changed', watchName, {
          [params.name ?? '']: params.value ?? '',
        });
      }
    }
  }

  // ── Typed event overloads ──────────────────────────────────

  on<K extends keyof DOMObserverEvents>(event: K, listener: DOMObserverEvents[K]): this;
  on(event: string, listener: (...args: any[]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  once<K extends keyof DOMObserverEvents>(event: K, listener: DOMObserverEvents[K]): this;
  once(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  emit<K extends keyof DOMObserverEvents>(event: K, ...args: Parameters<DOMObserverEvents[K]>): boolean;
  emit(event: string, ...args: any[]): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}


