// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// history.js — Conversation history page

export class HistoryPage {
  constructor(container, app) {
    this.app = app
    this.container = container
    this.render()
  }

  render() {
    this.container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h1 class="page-title">History</h1>
          <p class="page-subtitle">Past conversations and transcripts</p>
        </div>

        <div class="card">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <p>Conversation history will appear here once persistence is configured. Currently, transcripts are stored in-memory during the active session.</p>
            <div style="margin-top:var(--space-md)">
              <button class="btn" id="history-btn-export">Export Current Session</button>
            </div>
          </div>
        </div>
      </div>
    `

    document.getElementById('history-btn-export')?.addEventListener('click', () => {
      const messages = this.app.state.messages || []
      if (messages.length === 0) {
        this.app.log('No messages to export', 'warn')
        return
      }
      const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transcript-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      this.app.log('Transcript exported', 'ok')
    })
  }

  destroy() {}
}


