// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { WidgetConfig, Message } from './types';
import { AgentVoiceChatWidget } from './widget';

// Re-export public API
export { AgentVoiceChatWidget } from './widget';
export type { WidgetConfig, Message, ThemeOverrides } from './types';

/** Singleton instance reference for idempotent init */
let instance: AgentVoiceChatWidget | null = null;

/**
 * Public API exposed as `AgentVoiceChat` on the global scope (IIFE)
 * and as a named export (ESM).
 */
export const AgentVoiceChat = {
  /**
   * Initialize the widget with the given configuration.
   * Idempotent — calling init() multiple times returns the same instance.
   */
  init(config: WidgetConfig): AgentVoiceChatWidget {
    if (instance) {
      console.warn('[AgentVoiceChat] Widget already initialized. Call destroy() first to re-initialize.');
      return instance;
    }

    instance = new AgentVoiceChatWidget(config);
    instance.init().catch((err) => {
      console.error('[AgentVoiceChat] Initialization error:', err);
      config.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    return instance;
  },

  /**
   * Destroy the current widget instance.
   */
  destroy(): void {
    if (instance) {
      instance.destroy();
      instance = null;
    }
  },

  /**
   * Get the current widget instance, if any.
   */
  getInstance(): AgentVoiceChatWidget | null {
    return instance;
  },
};

/**
 * Auto-initialize from `<script>` tag data attributes.
 *
 * Usage:
 * <script src="agent-voice-chat.min.js"
 *   data-server="https://my-server.com"
 *   data-agent="bob"
 *   data-theme="dark"
 *   data-position="bottom-right"
 *   data-auto-open="true"
 *   data-push-to-talk="false"
 *   data-show-transcript="true"
 *   data-button-size="56"
 *   data-modal-width="380"
 *   data-agent-name="Bob"
 *   data-agent-avatar="https://example.com/avatar.png"
 * ></script>
 */
function autoInit(): void {
  // Find the script tag that loaded this file
  const scripts = document.querySelectorAll('script[data-server][data-agent]');
  const script = scripts[scripts.length - 1]; // Last matching script
  if (!script) return;

  const attr = (name: string): string | null => script.getAttribute(`data-${name}`);
  const boolAttr = (name: string, defaultVal: boolean): boolean => {
    const val = attr(name);
    if (val === null) return defaultVal;
    return val !== 'false' && val !== '0';
  };

  const server = attr('server');
  const agent = attr('agent');
  if (!server || !agent) return;

  const config: WidgetConfig = {
    server,
    agent,
  };

  const theme = attr('theme');
  if (theme === 'light' || theme === 'dark') config.theme = theme;

  const position = attr('position');
  if (position === 'bottom-right' || position === 'bottom-left' ||
      position === 'top-right' || position === 'top-left') {
    config.position = position;
  }

  const buttonSize = attr('button-size');
  if (buttonSize) config.buttonSize = parseInt(buttonSize, 10);

  const modalWidth = attr('modal-width');
  if (modalWidth) config.modalWidth = parseInt(modalWidth, 10);

  config.autoOpen = boolAttr('auto-open', false);
  config.pushToTalk = boolAttr('push-to-talk', false);
  config.showTranscript = boolAttr('show-transcript', true);

  const agentName = attr('agent-name');
  if (agentName) config.agentName = agentName;

  const agentAvatar = attr('agent-avatar');
  if (agentAvatar) config.agentAvatar = agentAvatar;

  const locale = attr('locale');
  if (locale) config.locale = locale;

  AgentVoiceChat.init(config);
}

// Auto-init when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit, { once: true });
  } else {
    // DOM already loaded — defer to next microtask to ensure script attributes are available
    Promise.resolve().then(autoInit);
  }
}

// Default export for convenience
export default AgentVoiceChat;


