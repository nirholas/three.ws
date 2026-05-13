// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// admin.js — Main application, router, and Socket.IO connection

import { DashboardPage } from './pages/dashboard.js'
import { AgentsPage } from './pages/agents.js'
import { KnowledgePage } from './pages/knowledge.js'
import { HistoryPage } from './pages/history.js'
import { SettingsPage } from './pages/settings.js'
import { StatusBar } from './components/status-bar.js'

// === Simple Event Emitter ===
class EventEmitter {
  constructor() { this._handlers = {} }
  on(event, fn) {
    (this._handlers[event] ||= []).push(fn)
    return () => this.off(event, fn)
  }
  off(event, fn) {
    this._handlers[event] = (this._handlers[event] || []).filter(h => h !== fn)
  }
  emit(event, ...args) {
    (this._handlers[event] || []).forEach(fn => fn(...args))
  }
}

// === Router ===
class Router {
  constructor(routes, mainEl) {
    this.routes = routes
    this.mainEl = mainEl
    this.currentPage = null
    window.addEventListener('hashchange', () => this.route())
  }

  route() {
    const hash = location.hash || '#/'
    const entry = this.routes[hash]
    if (!entry) {
      location.hash = '#/'
      return
    }

    // Destroy current page
    if (this.currentPage && this.currentPage.destroy) {
      this.currentPage.destroy()
    }

    this.mainEl.innerHTML = ''
    this.currentPage = new entry.page(this.mainEl, window.__app)

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === hash)
    })
    document.querySelectorAll('.bottom-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === hash)
    })
  }
}

// === Admin App ===
class AdminApp extends EventEmitter {
  constructor() {
    super()

    this.state = {
      status: 'disconnected',
      spaceUrl: null,
      startedAt: null,
      messageCount: 0,
      totalCost: 0,
      agents: [],
      messages: [],
      systemPrompt: '',
      apiKey: null,
      _pendingJoinUrl: null,
    }

    this.statusBar = null
    this.router = null
    this.socket = null
  }

  async init() {
    // Load API key from URL or session storage
    this.state.apiKey = this._loadApiKey()

    // If server requires auth and no valid key is present, ask once.
    await this._ensureApiKeyIfRequired()

    // Initialize Socket.IO
    this._connectSocket()

    // Initialize status bar
    this.statusBar = new StatusBar(this)

    // Initialize router
    const mainEl = document.getElementById('main-content')
    this.router = new Router({
      '#/': { page: DashboardPage },
      '#/agents': { page: AgentsPage },
      '#/knowledge': { page: KnowledgePage },
      '#/history': { page: HistoryPage },
      '#/settings': { page: SettingsPage },
    }, mainEl)

    // Bind navigation
    document.querySelectorAll('[data-route]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault()
        location.hash = el.dataset.route
      })
    })

    // Initial route
    this.router.route()

    console.log('[AdminApp] Initialized')
  }

  _loadApiKey() {
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('apiKey') || params.get('adminApiKey') || params.get('key')
    if (fromQuery) {
      const clean = fromQuery.trim()
      if (clean) {
        sessionStorage.setItem('apiKey', clean)

        // Remove secrets from the address bar after capture.
        const next = new URL(window.location.href)
        next.searchParams.delete('apiKey')
        next.searchParams.delete('adminApiKey')
        next.searchParams.delete('key')
        window.history.replaceState({}, document.title, next.pathname + next.search + next.hash)

        return clean
      }
    }

    return sessionStorage.getItem('apiKey')
  }

  _promptForApiKey(reason) {
    const typed = window.prompt(reason || 'Enter ADMIN_API_KEY')
    if (!typed) return null
    const clean = typed.trim()
    if (!clean) return null
    sessionStorage.setItem('apiKey', clean)
    return clean
  }

  async _ensureApiKeyIfRequired() {
    try {
      const headers = this.state.apiKey ? { 'X-API-Key': this.state.apiKey } : {}
      const probe = await fetch('/state', { headers })

      if (probe.status !== 401) return

      const reason = this.state.apiKey
        ? 'The current ADMIN_API_KEY was rejected. Enter a valid ADMIN_API_KEY:'
        : 'This admin panel is protected. Enter ADMIN_API_KEY:'

      const nextKey = this._promptForApiKey(reason)
      if (nextKey) this.state.apiKey = nextKey
    } catch {
      // If probe fails, defer to socket connection events for diagnostics.
    }
  }

  _connectSocket() {
    const opts = {}
    if (this.state.apiKey) {
      opts.auth = { apiKey: this.state.apiKey }
    }
    this.socket = io('/space', opts)

    // Connection events
    this.socket.on('connect', () => {
      this.statusBar.setConnectionState(true)
      this.log('Admin panel connected', 'info')
      this.socket.emit('xspace:status')
    })

    this.socket.on('disconnect', () => {
      this.statusBar.setConnectionState(false)
      this.log('Admin panel disconnected', 'err')
    })

    this.socket.on('connect_error', (err) => {
      const msg = (err && err.message) ? err.message : 'connection error'
      if (String(msg).toLowerCase().includes('unauthorized')) {
        this.log('Socket auth failed: invalid or missing ADMIN_API_KEY', 'err')
      } else {
        this.log('Socket connection error: ' + msg, 'err')
      }
    })

    // Agent status
    this.socket.on('xSpacesStatus', ({ status }) => {
      this.state.status = status
      if (status === 'speaking-in-space' || status === 'listening') {
        if (!this.state.startedAt) this.state.startedAt = new Date().toISOString()
      } else if (status === 'disconnected') {
        this.state.startedAt = null
      }
      this.statusBar.setAgentStatus(status)
      this.log('Status: ' + status, this._statusLogType(status))
      this.emit('statusChange', status)
    })

    this.socket.on('xSpacesError', ({ error }) => {
      this.log('Error: ' + error, 'err')
    })

    this.socket.on('xSpaces2faRequired', () => {
      this.emit('2faRequired')
      this.log('2FA required', 'info')
    })

    // Transcript / text
    this.socket.on('textComplete', (data) => {
      this.state.messages.push(data)
      if (this.state.messages.length > 200) this.state.messages.shift()
      this.emit('textComplete', data)
    })

    // Audio telemetry
    this.socket.on('audio:level', (data) => {
      this.emit('audioLevel', data)
    })

    this.socket.on('audio:webrtc-stats', (data) => {
      this.emit('webrtcStats', data)
    })

    // FSM transitions
    this.socket.on('state:change', (data) => {
      this.emit('stateChange', data)
    })

    // Provider events
    this.socket.on('provider:cost', (data) => {
      this.emit('providerCost', data)
    })

    this.socket.on('provider:status', (data) => {
      this.emit('providerStatus', data)
    })

    // Turn decisions
    this.socket.on('turn:decision', (data) => {
      this.emit('turnDecision', data)
    })

    // Log forwarding
    this.socket.on('log', (data) => {
      if (data && data.message) {
        this.log(data.message, data.level || 'info')
      }
    })
  }

  async authFetch(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {})
    if (this.state.apiKey) {
      headers['X-API-Key'] = this.state.apiKey
    }
    return fetch(url, Object.assign({}, opts, { headers }))
  }

  log(msg, type = '') {
    this.emit('log', msg, type)
  }

  _statusLogType(status) {
    if (status === 'speaking-in-space' || status === 'logged-in' || status === 'listening') return 'ok'
    if (status === 'space-ended') return 'err'
    return 'info'
  }
}

// === Boot ===
document.addEventListener('DOMContentLoaded', () => {
  const app = new AdminApp()
  window.__app = app
  app.init()
})


