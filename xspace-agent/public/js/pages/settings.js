// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// settings.js — Settings page

export class SettingsPage {
  constructor(container, app) {
    this.app = app
    this.container = container
    this._toastTimeout = null
    this.render()
    this.bind()
    this.loadSettings()
  }

  render() {
    this.container.innerHTML = `
      <!-- Toast notification -->
      <div id="settings-toast" style="
        position:fixed;top:24px;right:24px;z-index:9999;
        padding:12px 20px;border-radius:8px;font-size:0.85rem;font-weight:500;
        transform:translateY(-20px);opacity:0;transition:all 0.3s ease;pointer-events:none;
        font-family:inherit;
      "></div>

      <div class="page">
        <div class="page-header">
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Server configuration and API keys</p>
        </div>

        <div class="card-grid card-grid-2">
          <!-- Authentication -->
          <div class="card">
            <div class="card-header"><span class="card-title">X Authentication</span></div>
            <div class="form-group">
              <label class="form-label">Auth Method</label>
              <select class="select" id="settings-auth-method">
                <option value="cookie">Cookie Auth (recommended)</option>
                <option value="credentials">Username / Password</option>
              </select>
            </div>
            <div id="settings-cookie-fields">
              <div class="form-group">
                <label class="form-label">Auth Token</label>
                <input type="password" class="input" id="settings-auth-token" placeholder="Your X auth_token cookie" />
              </div>
              <div class="form-group">
                <label class="form-label">CT0 Token</label>
                <input type="password" class="input" id="settings-ct0" placeholder="Your X ct0 cookie" />
              </div>
            </div>
            <div id="settings-cred-fields" style="display:none">
              <div class="form-group">
                <label class="form-label">Username</label>
                <input type="text" class="input" id="settings-username" placeholder="@username" />
              </div>
              <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="input" id="settings-password" placeholder="Password" />
              </div>
            </div>
            <div class="form-hint" style="margin-bottom:var(--space-md)">
              Credentials are sent to the server and used for browser authentication only. They are not stored permanently.
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" id="settings-save-auth">Save Auth</button>
            </div>
          </div>

          <!-- API Keys -->
          <div class="card">
            <div class="card-header"><span class="card-title">API Keys</span></div>
            <div class="form-group">
              <label class="form-label">OpenAI API Key</label>
              <input type="password" class="input" id="settings-openai-key" placeholder="sk-..." />
              <div class="form-hint" id="settings-openai-status"></div>
            </div>
            <div class="form-group">
              <label class="form-label">Anthropic API Key</label>
              <input type="password" class="input" id="settings-anthropic-key" placeholder="sk-ant-..." />
              <div class="form-hint" id="settings-anthropic-status"></div>
            </div>
            <div class="form-group">
              <label class="form-label">Groq API Key</label>
              <input type="password" class="input" id="settings-groq-key" placeholder="gsk_..." />
              <div class="form-hint" id="settings-groq-status"></div>
            </div>
            <div class="form-group">
              <label class="form-label">ElevenLabs API Key</label>
              <input type="password" class="input" id="settings-elevenlabs-key" placeholder="..." />
              <div class="form-hint" id="settings-elevenlabs-status"></div>
            </div>
            <div class="form-hint" style="margin-bottom:var(--space-md)">
              Keys are saved to server memory. Set via environment variables for persistence across restarts.
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" id="settings-save-keys">Save API Keys</button>
            </div>
          </div>
        </div>

        <!-- Behavior Settings -->
        <div class="card" style="margin-top:var(--space-md)">
          <div class="card-header"><span class="card-title">Behavior</span></div>
          <div class="card-grid card-grid-3">
            <div class="form-group">
              <label class="form-label">AI Provider</label>
              <select class="select" id="settings-ai-provider">
                <option value="openai">OpenAI</option>
                <option value="openai-chat">OpenAI Chat</option>
                <option value="claude">Claude</option>
                <option value="groq">Groq</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">STT Provider</label>
              <select class="select" id="settings-stt-provider">
                <option value="groq">Groq Whisper</option>
                <option value="openai">OpenAI Whisper</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">TTS Provider</label>
              <select class="select" id="settings-tts-provider">
                <option value="elevenlabs">ElevenLabs</option>
                <option value="openai">OpenAI TTS</option>
                <option value="browser">Browser</option>
              </select>
            </div>
          </div>

          <div class="divider"></div>

          <div style="display:flex;flex-wrap:wrap;gap:var(--space-lg);margin-bottom:var(--space-md)">
            <div style="display:flex;align-items:center;gap:var(--space-sm)">
              <label class="toggle">
                <input type="checkbox" id="settings-headless" checked />
                <span class="toggle-slider"></span>
              </label>
              <span class="form-label" style="margin:0;text-transform:none;letter-spacing:0">Headless Browser</span>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-sm)">
              <label class="toggle">
                <input type="checkbox" id="settings-auto-join" />
                <span class="toggle-slider"></span>
              </label>
              <span class="form-label" style="margin:0;text-transform:none;letter-spacing:0">Auto-join on Start</span>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="settings-save-behavior">Save Behavior</button>
          </div>
        </div>

        <!-- Server Info -->
        <div class="card" style="margin-top:var(--space-md)">
          <div class="card-header"><span class="card-title">Server Info</span></div>
          <ul class="kv-list" id="settings-server-info">
            <li class="kv-item"><span class="kv-key">Version</span><span class="kv-value">--</span></li>
            <li class="kv-item"><span class="kv-key">Node.js</span><span class="kv-value">--</span></li>
            <li class="kv-item"><span class="kv-key">Uptime</span><span class="kv-value">--</span></li>
            <li class="kv-item"><span class="kv-key">Agent Status</span><span class="kv-value">--</span></li>
          </ul>
          <div class="btn-row" style="margin-top:var(--space-md)">
            <button class="btn" id="settings-btn-health">Check Health</button>
            <button class="btn" id="settings-btn-providers">Provider Status</button>
            <button class="btn" id="settings-btn-costs">Cost Tracking</button>
            <button class="btn" id="settings-btn-selectors">Selector Health</button>
          </div>
          <div id="settings-detail-panel" style="margin-top:var(--space-md);display:none">
            <div class="divider"></div>
            <pre id="settings-detail-content" style="
              background:rgba(0,0,0,0.2);padding:var(--space-md);border-radius:8px;
              font-size:0.8rem;max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-word;
            "></pre>
          </div>
        </div>
      </div>
    `
  }

  async loadSettings() {
    try {
      const res = await this.app.authFetch('/api/settings')
      if (!res.ok) return
      const settings = await res.json()

      const $ = id => document.getElementById(id)

      // Auth
      if (settings.auth) {
        $('settings-auth-method').value = settings.auth.method
        this._toggleAuthFields(settings.auth.method === 'cookie')
        if (settings.auth.hasAuthToken) $('settings-auth-token').placeholder = 'Set (hidden)'
        if (settings.auth.hasCt0) $('settings-ct0').placeholder = 'Set (hidden)'
        if (settings.auth.hasUsername) $('settings-username').placeholder = 'Set (hidden)'
        if (settings.auth.hasPassword) $('settings-password').placeholder = 'Set (hidden)'
      }

      // API keys — show status
      if (settings.apiKeys) {
        this._setKeyStatus('openai', settings.apiKeys.hasOpenai)
        this._setKeyStatus('anthropic', settings.apiKeys.hasAnthropic)
        this._setKeyStatus('groq', settings.apiKeys.hasGroq)
        this._setKeyStatus('elevenlabs', settings.apiKeys.hasElevenlabs)
      }

      // Behavior
      if (settings.behavior) {
        $('settings-ai-provider').value = settings.behavior.aiProvider || 'openai'
        $('settings-stt-provider').value = settings.behavior.sttProvider || 'groq'
        $('settings-tts-provider').value = settings.behavior.ttsProvider || 'elevenlabs'
        $('settings-headless').checked = settings.behavior.headless !== false
        $('settings-auto-join').checked = settings.behavior.autoJoin === true
      }

      this.app.log('Settings loaded', 'ok')
    } catch (err) {
      this.app.log('Failed to load settings: ' + err.message, 'err')
    }
  }

  _setKeyStatus(provider, isSet) {
    const el = document.getElementById(`settings-${provider}-status`)
    if (!el) return
    if (isSet) {
      el.textContent = 'Configured'
      el.style.color = '#4ade80'
    } else {
      el.textContent = 'Not set'
      el.style.color = '#f87171'
    }
  }

  _toggleAuthFields(isCookie) {
    const $ = id => document.getElementById(id)
    $('settings-cookie-fields').style.display = isCookie ? 'block' : 'none'
    $('settings-cred-fields').style.display = isCookie ? 'none' : 'block'
  }

  _showToast(message, type) {
    const toast = document.getElementById('settings-toast')
    if (!toast) return
    clearTimeout(this._toastTimeout)

    const colors = {
      success: { bg: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' },
      error: { bg: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' },
    }
    const c = colors[type] || colors.success

    toast.textContent = message
    toast.style.background = c.bg
    toast.style.border = c.border
    toast.style.color = c.color
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
    toast.style.pointerEvents = 'auto'

    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(-20px)'
      toast.style.pointerEvents = 'none'
    }, 3000)
  }

  async _saveSection(section, data, btn) {
    const originalText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Saving...'

    try {
      const res = await this.app.authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, data }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Save failed')
      }

      this._showToast(`Saved: ${result.updated.join(', ')}`, 'success')
      this.app.log(`Settings saved: ${result.updated.join(', ')}`, 'ok')

      // Reload to refresh status indicators
      await this.loadSettings()
    } catch (err) {
      this._showToast('Save failed: ' + err.message, 'error')
      this.app.log('Settings save failed: ' + err.message, 'err')
    } finally {
      btn.disabled = false
      btn.textContent = originalText
    }
  }

  bind() {
    const $ = id => document.getElementById(id)

    // Auth method toggle
    $('settings-auth-method')?.addEventListener('change', (e) => {
      this._toggleAuthFields(e.target.value === 'cookie')
    })

    // Save auth
    $('settings-save-auth')?.addEventListener('click', () => {
      const method = $('settings-auth-method').value
      const data = { method }
      if (method === 'cookie') {
        data.authToken = $('settings-auth-token').value
        data.ct0 = $('settings-ct0').value
      } else {
        data.username = $('settings-username').value
        data.password = $('settings-password').value
      }

      // Validate at least one field is filled
      const hasValue = method === 'cookie'
        ? (data.authToken || data.ct0)
        : (data.username || data.password)

      if (!hasValue) {
        this._showToast('Enter at least one credential field', 'error')
        return
      }

      this._saveSection('auth', data, $('settings-save-auth'))
    })

    // Save API keys
    $('settings-save-keys')?.addEventListener('click', () => {
      const data = {}
      const openai = $('settings-openai-key').value.trim()
      const anthropic = $('settings-anthropic-key').value.trim()
      const groq = $('settings-groq-key').value.trim()
      const elevenlabs = $('settings-elevenlabs-key').value.trim()

      if (openai) data.openai = openai
      if (anthropic) data.anthropic = anthropic
      if (groq) data.groq = groq
      if (elevenlabs) data.elevenlabs = elevenlabs

      if (Object.keys(data).length === 0) {
        this._showToast('Enter at least one API key', 'error')
        return
      }

      this._saveSection('apiKeys', data, $('settings-save-keys'))
    })

    // Save behavior
    $('settings-save-behavior')?.addEventListener('click', () => {
      const data = {
        aiProvider: $('settings-ai-provider').value,
        sttProvider: $('settings-stt-provider').value,
        ttsProvider: $('settings-tts-provider').value,
        headless: $('settings-headless').checked,
        autoJoin: $('settings-auto-join').checked,
      }
      this._saveSection('behavior', data, $('settings-save-behavior'))
    })

    // Health check
    $('settings-btn-health')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/health')
        const data = await res.json()
        const list = $('settings-server-info')
        if (list) {
          list.innerHTML = `
            <li class="kv-item"><span class="kv-key">Status</span><span class="kv-value">${data.status || '--'}</span></li>
            <li class="kv-item"><span class="kv-key">Uptime</span><span class="kv-value">${this._formatUptime(data.uptime)}</span></li>
            <li class="kv-item"><span class="kv-key">Agent</span><span class="kv-value">${data.agent || '--'}</span></li>
            <li class="kv-item"><span class="kv-key">Timestamp</span><span class="kv-value">${data.timestamp || '--'}</span></li>
            ${data.database ? `<li class="kv-item"><span class="kv-key">Database</span><span class="kv-value">${data.database.ok ? 'OK' : 'Error'}</span></li>` : ''}
          `
        }
        this.app.log('Health check: ' + data.status, data.status === 'ok' ? 'ok' : 'warn')
      } catch (err) {
        this.app.log('Health check failed: ' + err.message, 'err')
      }
    })

    // Provider status
    $('settings-btn-providers')?.addEventListener('click', async () => {
      try {
        const res = await this.app.authFetch('/admin/providers')
        if (res.status === 401) {
          this.app.log('Provider status requires ADMIN_API_KEY', 'err')
          return
        }
        const data = await res.json()
        this._showDetail(data)
        this.app.log('Provider status loaded', 'ok')
      } catch (err) {
        this.app.log('Provider check failed: ' + err.message, 'err')
      }
    })

    // Cost tracking
    $('settings-btn-costs')?.addEventListener('click', async () => {
      try {
        const res = await this.app.authFetch('/admin/providers/costs')
        if (res.status === 401) {
          this.app.log('Cost tracking requires ADMIN_API_KEY', 'err')
          return
        }
        const data = await res.json()
        this._showDetail(data)
        this.app.log('Cost data loaded', 'ok')
      } catch (err) {
        this.app.log('Cost check failed: ' + err.message, 'err')
      }
    })

    // Selector health
    $('settings-btn-selectors')?.addEventListener('click', async () => {
      try {
        const res = await this.app.authFetch('/admin/selectors/health')
        if (res.status === 401) {
          this.app.log('Selector health requires ADMIN_API_KEY', 'err')
          return
        }
        const data = await res.json()
        this._showDetail(data)
        this.app.log('Selector health loaded', 'ok')
      } catch (err) {
        this.app.log('Selector check failed: ' + err.message, 'err')
      }
    })
  }

  _showDetail(data) {
    const panel = document.getElementById('settings-detail-panel')
    const content = document.getElementById('settings-detail-content')
    if (!panel || !content) return
    content.textContent = JSON.stringify(data, null, 2)
    panel.style.display = 'block'
  }

  _formatUptime(seconds) {
    if (!seconds) return '--'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  destroy() {
    clearTimeout(this._toastTimeout)
  }
}


