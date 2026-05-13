// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// agent-card.js — Agent info card component

export class AgentCard {
  constructor(containerEl, agent) {
    this.container = containerEl
    this.agent = agent
    this.render()
  }

  render() {
    const a = this.agent
    const statusCls = a.active ? 'active' : 'idle'
    const statusText = a.active ? 'Active' : 'Idle'
    const badgeCls = a.active ? 'badge-success' : 'badge-neutral'

    this.container.innerHTML = `
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-avatar">${this._initials(a.name)}</div>
          <div class="agent-info">
            <div class="agent-name">${this._esc(a.name)}</div>
            <div class="agent-provider">${this._esc(a.provider || 'unknown')}</div>
          </div>
          <span class="badge ${badgeCls}">
            <span class="status-indicator ${statusCls}"></span>
            ${statusText}
          </span>
        </div>
        <div class="agent-stats">
          <div class="agent-stat">
            <div class="agent-stat-value">${a.messages || 0}</div>
            <div class="agent-stat-label">Messages</div>
          </div>
          <div class="agent-stat">
            <div class="agent-stat-value">${this._formatDuration(a.uptime || 0)}</div>
            <div class="agent-stat-label">Uptime</div>
          </div>
          <div class="agent-stat">
            <div class="agent-stat-value">$${(a.cost || 0).toFixed(3)}</div>
            <div class="agent-stat-label">Cost</div>
          </div>
        </div>
      </div>
    `
  }

  update(agent) {
    this.agent = { ...this.agent, ...agent }
    this.render()
  }

  _initials(name) {
    return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  }

  _formatDuration(seconds) {
    if (seconds < 60) return seconds + 's'
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return h + 'h ' + m + 'm'
  }

  _esc(str) {
    const el = document.createElement('span')
    el.textContent = str || ''
    return el.innerHTML
  }
}


