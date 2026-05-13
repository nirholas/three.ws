// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

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
          <!-- Agent Controls -->
          <div class="card">
            <div class="card-header"><span class="card-title">Agent Controls</span></div>

            <!-- Step 1: Session -->
            <div style="margin-bottom: var(--space-md)">
              <label class="form-label" style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.6">Session</label>
              <div class="btn-row">
                <button class="btn btn-success" id="dash-btn-auth">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  Authenticate
                </button>
                <button class="btn btn-danger" id="dash-btn-disconnect" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                  Disconnect
                </button>
              </div>
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
              <div class="divider"></div>
            </div>

            <!-- Step 2: Space -->
            <div style="margin-bottom: var(--space-md)">
              <label class="form-label" style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.6">Space</label>
              <div class="form-group">
                <input type="text" class="input" id="dash-space-url" placeholder="https://x.com/i/spaces/..." value="${this._esc(state.spaceUrl || '')}" />
              </div>
              <div class="btn-row">
                <button class="btn btn-primary" id="dash-btn-join" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  Join Space
                </button>
                <button class="btn btn-warning" id="dash-btn-leave" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Leave
                </button>
              </div>
            </div>

            <!-- Step 3: Speaker -->
            <div>
              <label class="form-label" style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.6">Speaker</label>
              <div class="btn-row">
                <button class="btn btn-primary" id="dash-btn-request-speak" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                  Request to Speak
                </button>
                <button class="btn btn-success" id="dash-btn-unmute" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                  Unmute
                </button>
                <button class="btn btn-warning" id="dash-btn-mute" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17"/></svg>
                  Mute
                </button>
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
    $('dash-btn-auth').addEventListener('click', () => {
      this.app.log('Authenticating...', 'info')
      this.app.socket.emit('xspace:connect')
    })

    $('dash-btn-disconnect').addEventListener('click', () => {
      this.app.log('Disconnecting...', 'info')
      this.app.socket.emit('xspace:stop')
    })

    $('dash-btn-join').addEventListener('click', () => {
      const url = $('dash-space-url').value.trim()
      if (!url) return this.app.log('Enter a Space URL first', 'err')
      this.app.log('Joining Space: ' + url, 'info')
      this.app.socket.emit('xspace:join-listener', { spaceUrl: url })
    })

    $('dash-btn-leave').addEventListener('click', () => {
      this.app.log('Leaving space...', 'info')
      this.app.socket.emit('xspace:leave')
    })

    $('dash-btn-request-speak').addEventListener('click', () => {
      this.app.log('Requesting to speak...', 'info')
      this.app.socket.emit('xspace:request-speak')
    })

    $('dash-btn-unmute').addEventListener('click', () => {
      this.app.log('Unmuting mic...', 'info')
      this.app.socket.emit('xspace:unmute')
    })

    $('dash-btn-mute').addEventListener('click', () => {
      this.app.log('Muting mic...', 'info')
      this.app.socket.emit('xspace:mute')
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

    // Update button states based on FSM states
    const isDisconnected = status === 'disconnected' || status === 'error'
    const isConnected = status === 'connected'
    const isInSpace = ['listening', 'idle', 'processing', 'speaking'].includes(status)
    const isTransitioning = ['launching', 'authenticating', 'joining', 'leaving'].includes(status)
    const isSpeaker = ['idle', 'processing', 'speaking'].includes(status)
    const isListener = status === 'listening'

    // Session buttons
    $('dash-btn-auth').disabled = !isDisconnected
    $('dash-btn-disconnect').disabled = isDisconnected

    // Space buttons — only enabled when connected or space-ended (can rejoin)
    $('dash-btn-join').disabled = !(isConnected || status === 'space-ended')
    $('dash-btn-leave').disabled = !isInSpace

    // Speaker buttons
    $('dash-btn-request-speak').disabled = !isListener
    $('dash-btn-unmute').disabled = !isSpeaker
    $('dash-btn-mute').disabled = !isSpeaker

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
      'connected': 'Authenticated',
      'joining': 'Joining...',
      'listening': 'Listening',
      'idle': 'Speaker (Idle)',
      'processing': 'Processing...',
      'speaking': 'Speaking',
      'leaving': 'Leaving...',
      'space-ended': 'Space Ended',
      'error': 'Error',
    }
    return map[status] || status || 'Offline'
  }

  _statusIndicatorClass(status) {
    if (['idle', 'processing', 'speaking', 'listening', 'connected'].includes(status)) return 'active'
    if (['launching', 'authenticating', 'joining', 'leaving'].includes(status)) return 'working'
    if (status === 'space-ended' || status === 'error') return 'error'
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


