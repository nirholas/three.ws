// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§77]

// status-bar.js — Connection status header component

export class StatusBar {
  constructor(app) {
    this.app = app
    this.dotEl = document.getElementById('conn-dot')
    this.textEl = document.getElementById('conn-text')
    this.statusBadgeEl = document.getElementById('agent-status-badge')
  }

  setConnectionState(connected) {
    if (!this.dotEl) return
    this.dotEl.className = 'dot' + (connected ? ' connected' : '')
    this.textEl.textContent = connected ? 'Connected' : 'Disconnected'
  }

  setAgentStatus(status) {
    if (!this.statusBadgeEl) return
    const map = {
      'disconnected': { text: 'Offline', cls: 'badge-neutral' },
      'launching': { text: 'Launching', cls: 'badge-warning' },
      'authenticating': { text: 'Authenticating', cls: 'badge-warning' },
      'logged-in': { text: 'Ready', cls: 'badge-info' },
      'joining': { text: 'Joining', cls: 'badge-warning' },
      'listening': { text: 'Listening', cls: 'badge-success' },
      'speaking-in-space': { text: 'In Space', cls: 'badge-success' },
      'space-ended': { text: 'Space Ended', cls: 'badge-error' },
    }
    const info = map[status] || { text: status, cls: 'badge-neutral' }
    this.statusBadgeEl.className = 'badge ' + info.cls
    this.statusBadgeEl.textContent = info.text
  }
}


