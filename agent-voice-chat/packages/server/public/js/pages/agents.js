// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// agents.js — Agent configuration and management page

import { AgentCard } from '../components/agent-card.js'

export class AgentsPage {
  constructor(container, app) {
    this.app = app
    this.container = container
    this.render()
    this.bind()
    this.loadSettings()
  }

  render() {
    const state = this.app.state
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">Agents</h1>
          <p class="page-subtitle">Configure and monitor AI agents</p>
        </div>

        <!-- Agent Overview Cards -->
        <div class="card-grid card-grid-2" id="agents-cards" style="margin-bottom: var(--space-md)">
          ${this._renderAgentCards(state.agents)}
        </div>

        <!-- Agent Configuration -->
        <div class="card-grid card-grid-2" style="margin-bottom: var(--space-md)">
          <!-- Personality / System Prompt -->
          <div class="card">
            <div class="card-header"><span class="card-title">System Prompt</span></div>
            <div class="form-group">
              <label class="form-label">Agent Personality</label>
              <select class="select" id="agents-personality">
                <option value="default">Default Assistant</option>
                <option value="expert">Domain Expert</option>
                <option value="casual">Casual Conversationalist</option>
                <option value="interviewer">Interviewer</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">System Prompt</label>
              <textarea class="textarea" id="agents-system-prompt" rows="6" placeholder="You are a helpful AI assistant...">${this._esc(state.systemPrompt || '')}</textarea>
              <div class="form-hint">
                <span id="agents-prompt-chars">0</span> characters
              </div>
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" id="agents-btn-save-prompt">Save Prompt</button>
            </div>
          </div>

          <!-- Voice Settings -->
          <div class="card">
            <div class="card-header"><span class="card-title">Voice Settings</span></div>
            <div class="form-group">
              <label class="form-label">TTS Provider</label>
              <select class="select" id="agents-tts-provider">
                <option value="elevenlabs">ElevenLabs</option>
                <option value="openai">OpenAI TTS</option>
                <option value="browser">Browser (Free)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Voice ID</label>
              <input type="text" class="input" id="agents-voice-id" placeholder="e.g., EXAVITQu4vr4xnSDxMaL" />
            </div>
            <div class="form-group">
              <label class="form-label">Speed</label>
              <div style="display:flex;align-items:center;gap:var(--space-sm)">
                <input type="range" min="0.5" max="2.0" step="0.1" value="1.0" id="agents-voice-speed" style="flex:1" />
                <span class="card-meta" id="agents-speed-label">1.0x</span>
              </div>
            </div>
            <div class="divider"></div>
            <div class="card-header"><span class="card-title">LLM Provider</span></div>
            <div class="form-group">
              <label class="form-label">Provider</label>
              <select class="select" id="agents-llm-provider">
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
                <option value="groq">Groq</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Model</label>
              <input type="text" class="input" id="agents-llm-model" placeholder="e.g., gpt-4o, claude-sonnet-4-20250514" />
            </div>
            <div class="btn-row">
              <button class="btn btn-primary" id="agents-btn-save-voice">Save Voice &amp; LLM</button>
            </div>
          </div>
        </div>

        <!-- Say Something -->
        <div class="card">
          <div class="card-header"><span class="card-title">Manual Message</span></div>
          <p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-md)">
            Type a message and the agent will speak it in the Space.
          </p>
          <div style="display:flex;gap:var(--space-sm)">
            <input type="text" class="input" id="agents-say-input" placeholder="Type something for the agent to say..." />
            <button class="btn btn-primary" id="agents-btn-say">Speak</button>
          </div>
        </div>
      </div>
    `
  }

  bind() {
    const $ = id => document.getElementById(id)

    // Character count for system prompt
    const promptEl = $('agents-system-prompt')
    const charsEl = $('agents-prompt-chars')
    if (promptEl && charsEl) {
      const updateCount = () => { charsEl.textContent = promptEl.value.length }
      promptEl.addEventListener('input', updateCount)
      updateCount()
    }

    // Speed slider label
    const speedEl = $('agents-voice-speed')
    const speedLabel = $('agents-speed-label')
    if (speedEl && speedLabel) {
      speedEl.addEventListener('input', () => {
        speedLabel.textContent = speedEl.value + 'x'
      })
    }

    // Say something
    $('agents-btn-say')?.addEventListener('click', () => {
      const input = $('agents-say-input')
      const msg = input.value.trim()
      if (!msg) return
      this.app.socket.emit('xspace:message', { text: msg })
      this.app.log('Agent will say: ' + msg, 'info')
      input.value = ''
    })

    $('agents-say-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('agents-btn-say')?.click()
    })

    // Save prompt to server
    $('agents-btn-save-prompt')?.addEventListener('click', async () => {
      const btn = $('agents-btn-save-prompt')
      const prompt = $('agents-system-prompt').value
      btn.disabled = true
      btn.textContent = 'Saving...'
      try {
        const res = await this.app.authFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: 'systemPrompt', data: { prompt } }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || 'Save failed')
        this.app.state.systemPrompt = prompt
        this.app.log('System prompt saved: ' + result.updated.join(', '), 'ok')
      } catch (err) {
        this.app.log('Save prompt failed: ' + err.message, 'err')
      } finally {
        btn.disabled = false
        btn.textContent = 'Save Prompt'
      }
    })

    // Save voice & LLM settings to server
    $('agents-btn-save-voice')?.addEventListener('click', async () => {
      const btn = $('agents-btn-save-voice')
      btn.disabled = true
      btn.textContent = 'Saving...'
      try {
        const data = {
          ttsProvider: $('agents-tts-provider')?.value,
          voiceId: $('agents-voice-id')?.value?.trim() || undefined,
          speed: parseFloat($('agents-voice-speed')?.value || '1.0'),
          llmProvider: $('agents-llm-provider')?.value,
          llmModel: $('agents-llm-model')?.value?.trim() || undefined,
        }
        const res = await this.app.authFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: 'voice', data }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || 'Save failed')
        this.app.log('Voice & LLM saved: ' + result.updated.join(', '), 'ok')
      } catch (err) {
        this.app.log('Save voice settings failed: ' + err.message, 'err')
      } finally {
        btn.disabled = false
        btn.textContent = 'Save Voice & LLM'
      }
    })
  }

  async loadSettings() {
    try {
      const res = await this.app.authFetch('/api/settings')
      if (!res.ok) return
      const settings = await res.json()
      const $ = id => document.getElementById(id)

      if (settings.systemPrompt) {
        const el = $('agents-system-prompt')
        if (el) { el.value = settings.systemPrompt; $('agents-prompt-chars').textContent = settings.systemPrompt.length }
      }
      if (settings.behavior) {
        if ($('agents-tts-provider')) $('agents-tts-provider').value = settings.behavior.ttsProvider || 'elevenlabs'
        if ($('agents-llm-provider')) $('agents-llm-provider').value = settings.behavior.aiProvider || 'openai'
      }
    } catch { /* settings not available */ }
  }

  _renderAgentCards(agents) {
    if (!agents || agents.length === 0) {
      return `
        <div class="card">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            <p>No agents active. Start a bot from the Dashboard to see agents here.</p>
          </div>
        </div>
      `
    }
    return agents.map(a => `<div class="card" id="agent-card-${a.id || 'default'}"></div>`).join('')
  }

  _esc(str) {
    const el = document.createElement('span')
    el.textContent = str || ''
    return el.innerHTML
  }

  destroy() {}
}


