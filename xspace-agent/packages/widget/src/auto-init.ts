// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

/**
 * Auto-init entry point for UMD bundle.
 * Detects <script> tag data-* attributes and auto-initializes a widget.
 * Also exposes XSpaceWidget and createWidget on window.XSpace for manual usage.
 */
import { XSpaceWidget, createWidget } from './index'
import type { WidgetConfig, Position, ThemeMode } from './index'

export * from './index'

// Attach to window for UMD consumers
const api = { XSpaceWidget, createWidget }
;(window as any).XSpace = { ...(window as any).XSpace, ...api }

// Auto-init from <script> tag data attributes
function autoInit(): void {
  const script = document.currentScript as HTMLScriptElement | null
  if (!script) return

  const serverUrl = script.dataset.serverUrl
  if (!serverUrl) return

  const config: WidgetConfig = {
    serverUrl,
    agentId: script.dataset.agentId,
    theme: (script.dataset.theme as ThemeMode) || undefined,
    position: (script.dataset.position as Position) || undefined,
    apiKey: script.dataset.token,
  }

  createWidget(config)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit)
} else {
  autoInit()
}


