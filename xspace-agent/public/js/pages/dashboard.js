// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// dashboard.js — Main dashboard page

import { Transcript } from '../components/transcript.js'
import { AudioMeter } from '../components/audio-meter.js'

export class DashboardPage {
  constructor(container, app) {
    this.app = app
    this.container = container
    this.transcript = null
    this.inputMeter = null
    this.outputMeter = null
    this.uptimeInterval = null
    this.render()
    this.bind()
  }

  render() {
    const state = this.app.state
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Real-time agent monitoring and control</p>
        </div>

        <!-- Stat Cards Row -->
        <div class="card-grid card-grid-4 stat-cards-row" style="margin-bottom: var(--space-md)">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Status</span>
              <span class="status-indicator ${this._statusIndicatorClass(state.status)}"></span>
            </div>
            <div class="card-value" id="dash-status">${this._friendlyStatus(state.status)}</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Uptime</span></div>
            <div class="card-value" id="dash-uptime">${this._formatUptime(state.startedAt)}</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Messages</span></div>
            <div class="card-value" id="dash-messages">${state.messageCount || 0}</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Cost</span></div>
            <div class="card-value" id="dash-cost">$${(state.totalCost || 0).toFixed(3)}</div>
          </div>
        </div>

        <!-- Main Grid: Controls + Audio -->
        <div class="card-grid card-grid-2 dashboard-grid" style="margin-bottom: var(--space-md)">
          <!-- Quick Actions -->
          <div class="card">
            <div class="card-header"><span class="card-title">Quick Actions</span></div>
            <div class="form-group">
              <label class="form-label">Space URL</label>
              <input type="text" class="input" id="dash-space-url" placeholder="https://x.com/i/spaces/..." value="${this._esc(state.spaceUrl || '')}" />
            </div>
            <div class="btn-row" style="margin-bottom: var(--space-md)">
              <button class="btn btn-success" id="dash-btn-start">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Start
              </button>
              <button class="btn btn-danger" id="dash-btn-stop" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                Stop
              </button>
              <button class="btn btn-primary" id="dash-btn-join" disabled>Join Space</button>
              <button class="btn btn-warning" id="dash-btn-leave" disabled>Leave</button>
            </div>
            <!-- 2FA Section (hidden by default) -->
            <div id="dash-2fa" style="display:none">
              <div class="divider"></div>
              <div class="form-group">
                <label class="form-label">2FA Code</label>
                <div style="display:flex;gap:var(--space-sm)">
                  <input type="text" class="input" id="dash-2fa-code" placeholder="000000" maxlength="6" style="max-width:160px" />
                  <button class="btn btn-primary" id="dash-btn-2fa">Submit</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Audio Pipeline -->
          <div class="card">
            <div class="card-header"><span class="card-title">Audio Pipeline</span></div>
            <div style="display:flex;flex-direction:column;gap:var(--space-lg)">
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:var(--space-xs)">
                  <span class="form-label" style="margin:0">Input Level</span>
                  <span class="card-meta" id="dash-input-rate">0 chunks/s</span>
                </div>
                <div class="audio-meter audio-meter-lg">
                  <div class="audio-meter-fill" id="dash-input-meter"></div>
                </div>
              </div>
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:var(--space-xs)">
                  <span class="form-label" style="margin:0">Output Level</span>
                  <span class="card-meta" id="dash-output-rate">0 chunks/s</span>
                </div>
                <div class="audio-meter audio-meter-lg">
                  <div class="audio-meter-fill" id="dash-output-meter"></div>
                </div>
              </div>
              <div class="divider"></div>
              <div>
                <div class="card-header" style="margin-bottom:var(--space-sm)"><span class="card-title">VAD State</span></div>
                <div style="display:flex;gap:var(--space-md)">
                  <div class="badge badge-neutral" id="dash-vad-badge">Idle</div>
                  <span class="card-meta" id="dash-webrtc-stats"></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Live Transcript -->
        <div class="card" style="margin-bottom: var(--space-md)">
          <div class="card-header">
            <span class="card-title">Live Transcript</span>
            <button class="btn btn-sm" id="dash-btn-clear-transcript">Clear</button>
          </div>
          <div class="transcript" id="dash-transcript"></div>
          <div style="margin-top:var(--space-sm);display:flex;gap:var(--space-sm)">
            <input type="text" class="input" id="dash-send-msg" placeholder="Send a message to the Space..." />
            <button class="btn btn-primary" id="dash-btn-send">Send</button>
          </div>
        </div>

        <!-- Log -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Event Log</span>
            <button class="btn btn-sm" id="dash-btn-clear-log">Clear</button>
          </div>
          <div class="log-panel" id="dash-log"></div>
        </div>
      </div>
    `
  }

  bind() {
    const $ = id => document.getElementById(id)

    // Transcript
    this.transcript = new Transcript($('dash-transcript'))
    this.transcript.showEmpty()

    // Audio meters
    this.inputMeter = new AudioMeter($('dash-input-meter'))
    this.outputMeter = new AudioMeter($('dash-output-meter'))

    // Button handlers
    $('dash-btn-start').addEventListener('click', () => {
      this.app.log('Starting bot...', 'info')
      this.app.socket.emit('xspace:start')
    })

    $('dash-btn-stop').addEventListener('click', () => {
      this.app.log('Stopping bot...', 'info')
      this.app.socket.emit('xspace:stop')
    })

    $('dash-btn-join').addEventListener('click', () => {
      const url = $('dash-space-url').value.trim()
      if (!url) return this.app.log('Enter a Space URL first', 'err')
      const state = this.app.state
      if (state.status === 'disconnected') {
        this.app.log('Starting bot then joining: ' + url, 'info')
        this.app.state._pendingJoinUrl = url
        this.app.socket.emit('xspace:start')
      } else {
        this.app.log('Joining: ' + url, 'info')
        this.app.socket.emit('xspace:join', { spaceUrl: url })
      }
    })

    $('dash-btn-leave').addEventListener('click', () => {
      this.app.log('Leaving space...', 'info')
      this.app.socket.emit('xspace:leave')
    })

    $('dash-btn-2fa').addEventListener('click', () => {
      const code = $('dash-2fa-code').value.trim()
      if (!code) return
      this.app.socket.emit('xspace:2fa', { code })
      $('dash-2fa').style.display = 'none'
      this.app.log('2FA code submitted', 'info')
    })

    $('dash-btn-send').addEventListener('click', () => this._sendMessage())
    $('dash-send-msg').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._sendMessage()
    })

    $('dash-btn-clear-transcript').addEventListener('click', () => {
      this.transcript.clear()
      this.transcript.showEmpty()
    })

    $('dash-btn-clear-log').addEventListener('click', () => {
      $('dash-log').innerHTML = ''
    })

    // Uptime timer
    this._startUptimeTimer()

    // Register event listeners on app
    this.app.on('statusChange', (status) => this._onStatusChange(status))
    this.app.on('2faRequired', () => { $('dash-2fa').style.display = 'block' })
    this.app.on('textComplete', (data) => this._onTextComplete(data))
    this.app.on('audioLevel', (data) => this._onAudioLevel(data))
    this.app.on('webrtcStats', (data) => this._onWebrtcStats(data))
    this.app.on('log', (msg, type) => this._appendLog(msg, type))
    this.app.on('stateChange', (data) => this._onStateChange(data))
    this.app.on('providerCost', (data) => this._onProviderCost(data))
  }

  _sendMessage() {
    const input = document.getElementById('dash-send-msg')
    const msg = input.value.trim()
    if (!msg) return
    this.app.socket.emit('xspace:message', { text: msg })
    this.transcript.addEntry('You', msg, 'sent')
    input.value = ''
  }

  _onStatusChange(status) {
    const $ = id => document.getElementById(id)
    if (!$('dash-status')) return

    $('dash-status').textContent = this._friendlyStatus(status)

    // Update button states
    const isDisconnected = status === 'disconnected'
    const isLoggedIn = status === 'logged-in'
    const isInSpace = status === 'speaking-in-space' || status === 'listening'
    const isWorking = !isDisconnected && !isLoggedIn && !isInSpace && status !== 'space-ended'

    $('dash-btn-start').disabled = !isDisconnected
    $('dash-btn-stop').disabled = isDisconnected
    $('dash-btn-join').disabled = isDisconnected || isWorking
    $('dash-btn-leave').disabled = !isInSpace

    // Handle pending join
    if (isLoggedIn && this.app.state._pendingJoinUrl) {
      const url = this.app.state._pendingJoinUrl
      this.app.state._pendingJoinUrl = null
      this.app.log('Auto-joining: ' + url, 'info')
      this.app.socket.emit('xspace:join', { spaceUrl: url })
    }

    // Update status indicator
    const indicator = this.container.querySelector('.status-indicator')
    if (indicator) indicator.className = 'status-indicator ' + this._statusIndicatorClass(status)
  }

  _onTextComplete(data) {
    if (!this.transcript) return
    const speaker = data.speaker || data.role || 'Agent'
    const text = data.text || data.content || ''
    if (text) {
      this.transcript.addEntry(speaker, text)
      this.app.state.messageCount = (this.app.state.messageCount || 0) + 1
      const el = document.getElementById('dash-messages')
      if (el) el.textContent = this.app.state.messageCount
    }
  }

  _onAudioLevel(data) {
    if (this.inputMeter && data.input !== undefined) {
      this.inputMeter.setLevel(data.input)
    }
    if (this.outputMeter && data.output !== undefined) {
      this.outputMeter.setLevel(data.output)
    }
  }

  _onWebrtcStats(data) {
    const el = document.getElementById('dash-webrtc-stats')
    if (el && data) {
      const parts = []
      if (data.bytesReceived) parts.push(`In: ${this._formatBytes(data.bytesReceived)}`)
      if (data.bytesSent) parts.push(`Out: ${this._formatBytes(data.bytesSent)}`)
      if (data.packetsLost) parts.push(`Lost: ${data.packetsLost}`)
      el.textContent = parts.join(' | ')
    }
  }

  _onStateChange(data) {
    if (data && data.to) {
      this._appendLog(`State: ${data.from || '?'} → ${data.to}`, 'info')
    }
  }

  _onProviderCost(data) {
    if (data && data.totalCost !== undefined) {
      this.app.state.totalCost = data.totalCost
      const el = document.getElementById('dash-cost')
      if (el) el.textContent = '$' + data.totalCost.toFixed(3)
    }
  }

  _appendLog(msg, type = '') {
    const log = document.getElementById('dash-log')
    if (!log) return
    const entry = document.createElement('div')
    entry.className = 'log-entry ' + type
    const time = new Date().toLocaleTimeString()
    entry.textContent = `[${time}] ${msg}`
    log.prepend(entry)
    // Keep max 500 entries
    while (log.children.length > 500) {
      log.removeChild(log.lastChild)
    }
  }

  _startUptimeTimer() {
    this._updateUptime()
    this.uptimeInterval = setInterval(() => this._updateUptime(), 1000)
  }

  _updateUptime() {
    const el = document.getElementById('dash-uptime')
    if (!el) return
    const startedAt = this.app.state.startedAt
    if (!startedAt) { el.textContent = '--'; return }
    const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    el.textContent = this._formatUptime(startedAt)
  }

  _formatUptime(startedAt) {
    if (!startedAt) return '--'
    const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
    const h = Math.floor(diff / 3600)
    const m = Math.floor((diff % 3600) / 60)
    const s = diff % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / 1048576).toFixed(1) + 'MB'
  }

  _friendlyStatus(status) {
    const map = {
      'disconnected': 'Offline',
      'launching': 'Launching...',
      'authenticating': 'Authenticating...',
      'logged-in': 'Ready',
      'joining': 'Joining...',
      'listening': 'Listening',
      'speaking-in-space': 'Speaking',
      'space-ended': 'Ended',
    }
    return map[status] || status || 'Offline'
  }

  _statusIndicatorClass(status) {
    if (status === 'speaking-in-space' || status === 'listening' || status === 'logged-in') return 'active'
    if (status === 'launching' || status === 'authenticating' || status === 'joining') return 'working'
    if (status === 'space-ended') return 'error'
    return 'idle'
  }

  _esc(str) {
    const el = document.createElement('span')
    el.textContent = str || ''
    return el.innerHTML
  }

  destroy() {
    if (this.uptimeInterval) clearInterval(this.uptimeInterval)
    if (this.inputMeter) this.inputMeter.reset()
    if (this.outputMeter) this.outputMeter.reset()
  }
}


