// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { ResolvedConfig, ConnectionState } from '../types';

/** SVG icons used by the button */
const ICONS = {
  mic: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
};

export class FloatingButton {
  readonly el: HTMLButtonElement;
  private statusDot: HTMLSpanElement;
  private isOpen = false;

  constructor(
    private config: ResolvedConfig,
    private onToggle: () => void,
  ) {
    this.el = document.createElement('button');
    this.el.className = `avc-button ${config.position}`;
    this.el.setAttribute('aria-label', 'Open voice chat');
    this.el.setAttribute('role', 'button');
    this.el.style.pointerEvents = 'auto';

    // Status indicator dot
    this.statusDot = document.createElement('span');
    this.statusDot.className = 'avc-status-dot';
    this.el.appendChild(this.statusDot);

    // Icon or avatar
    if (config.agentAvatar) {
      const img = document.createElement('img');
      img.src = config.agentAvatar;
      img.alt = config.agentName;
      img.className = 'avc-avatar';
      this.el.appendChild(img);
    } else {
      this.el.insertAdjacentHTML('beforeend', ICONS.mic);
    }

    this.el.addEventListener('click', () => {
      this.onToggle();
    });

    // Keyboard accessibility
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onToggle();
      }
    });
  }

  /** Update the visual open/closed state */
  setOpen(open: boolean): void {
    this.isOpen = open;
    this.el.setAttribute('aria-label', open ? 'Close voice chat' : 'Open voice chat');
    // Swap icon to close when modal is open (only when no avatar)
    if (!this.config.agentAvatar) {
      const svg = this.el.querySelector('svg');
      if (svg) svg.outerHTML = open ? ICONS.close : ICONS.mic;
    }
  }

  /** Update connection status indicator */
  setConnectionState(state: ConnectionState): void {
    this.statusDot.className = `avc-status-dot ${state}`;
  }

  /** Show pulse animation when agent is speaking */
  setSpeaking(speaking: boolean): void {
    this.el.classList.toggle('speaking', speaking);
  }
}


