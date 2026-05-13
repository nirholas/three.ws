// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// transcript.js — Live transcript with auto-scroll and speaker colors

const SPEAKER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
]

export class Transcript {
  constructor(containerEl) {
    this.container = containerEl
    this.entries = []
    this.speakerColorMap = {}
    this.colorIndex = 0
    this.autoScroll = true

    this.container.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.container
      this.autoScroll = scrollHeight - scrollTop - clientHeight < 40
    })
  }

  getSpeakerColor(speaker) {
    if (!this.speakerColorMap[speaker]) {
      this.speakerColorMap[speaker] = SPEAKER_COLORS[this.colorIndex % SPEAKER_COLORS.length]
      this.colorIndex++
    }
    return this.speakerColorMap[speaker]
  }

  addEntry(speaker, text, type = 'user') {
    const entry = document.createElement('div')
    entry.className = 'transcript-entry'

    const color = this.getSpeakerColor(speaker)
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    entry.innerHTML = `
      <span class="transcript-speaker" style="color: ${color}">${this._esc(speaker)}:</span>
      <span class="transcript-text">${this._esc(text)}</span>
      <span class="transcript-time">${time}</span>
    `

    this.container.appendChild(entry)
    this.entries.push({ speaker, text, type, time })

    // Keep max 200 entries in DOM
    if (this.container.children.length > 200) {
      this.container.removeChild(this.container.firstChild)
    }

    if (this.autoScroll) {
      this.container.scrollTop = this.container.scrollHeight
    }
  }

  clear() {
    this.container.innerHTML = ''
    this.entries = []
  }

  showEmpty() {
    this.container.innerHTML = `
      <div class="transcript-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        </svg>
        <p>No transcript yet. Join a Space to start capturing audio.</p>
      </div>
    `
  }

  _esc(str) {
    const el = document.createElement('span')
    el.textContent = str
    return el.innerHTML
  }
}


