// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// audio-meter.js — Real-time audio level visualization

export class AudioMeter {
  constructor(fillEl) {
    this.fillEl = fillEl
    this.currentLevel = 0
    this.targetLevel = 0
    this.animating = false
  }

  setLevel(level) {
    // level: 0-1
    this.targetLevel = Math.max(0, Math.min(1, level))
    if (!this.animating) {
      this.animating = true
      this._animate()
    }
  }

  _animate() {
    const diff = this.targetLevel - this.currentLevel
    this.currentLevel += diff * 0.3

    if (Math.abs(diff) < 0.001) {
      this.currentLevel = this.targetLevel
      this.animating = false
    }

    this.fillEl.style.width = (this.currentLevel * 100) + '%'

    if (this.animating) {
      requestAnimationFrame(() => this._animate())
    }
  }

  reset() {
    this.targetLevel = 0
    this.currentLevel = 0
    this.fillEl.style.width = '0%'
    this.animating = false
  }
}


