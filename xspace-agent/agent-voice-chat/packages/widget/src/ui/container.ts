// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { ResolvedConfig } from '../types';
import { resolveTheme, buildStyles } from './styles';

/**
 * Shadow DOM container that isolates all widget DOM and styles
 * from the host page.
 */
export class WidgetContainer {
  readonly host: HTMLElement;
  readonly shadow: ShadowRoot;
  private styleEl: HTMLStyleElement;

  constructor(private config: ResolvedConfig) {
    // Create host element
    this.host = document.createElement('agent-voice-chat');
    this.host.setAttribute('aria-label', 'AI Voice Chat Widget');
    this.host.style.cssText = 'all:initial;position:fixed;z-index:2147483645;pointer-events:none;';

    // Attach shadow root
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // Inject styles
    this.styleEl = document.createElement('style');
    this.applyTheme();
    this.shadow.appendChild(this.styleEl);
  }

  /** Mount the widget to the document body */
  mount(): void {
    if (!this.host.parentNode) {
      document.body.appendChild(this.host);
    }
  }

  /** Remove the widget from the DOM */
  unmount(): void {
    this.host.remove();
  }

  /** Update styles when theme changes */
  applyTheme(): void {
    const vars = resolveTheme(this.config.theme, this.config.themeOverrides);
    this.styleEl.textContent = buildStyles(vars, this.config.modalWidth, this.config.buttonSize);
  }

  /** Append a child element to the shadow root */
  append(el: HTMLElement): void {
    this.shadow.appendChild(el);
  }

  /** Query an element inside the shadow root */
  query<T extends HTMLElement>(selector: string): T | null {
    return this.shadow.querySelector<T>(selector);
  }
}


