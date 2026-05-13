// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§85]

export const widgetStyles = `
  :host {
    all: initial;
    font-family: var(--xw-font);
    color: var(--xw-text);
    font-size: 14px;
    line-height: 1.4;
    box-sizing: border-box;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .xw-container {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    pointer-events: none;
  }

  .xw-container--bottom-right { bottom: 20px; right: 20px; }
  .xw-container--bottom-left  { bottom: 20px; left: 20px; align-items: flex-start; }
  .xw-container--top-right    { top: 20px; right: 20px; }
  .xw-container--top-left     { top: 20px; left: 20px; align-items: flex-start; }

  .xw-container > * {
    pointer-events: auto;
  }

  /* Floating button */
  .xw-fab {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--xw-primary);
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px var(--xw-shadow);
    transition: background 0.2s, transform 0.15s;
    outline: none;
  }

  .xw-fab:hover { background: var(--xw-primary-hover); transform: scale(1.05); }
  .xw-fab:focus-visible { box-shadow: 0 0 0 3px var(--xw-primary), 0 4px 12px var(--xw-shadow); }
  .xw-fab svg { width: 24px; height: 24px; fill: currentColor; }

  /* Panel */
  .xw-panel {
    width: 380px;
    max-width: calc(100vw - 40px);
    height: 520px;
    max-height: calc(100vh - 120px);
    background: var(--xw-bg);
    border-radius: var(--xw-radius);
    box-shadow: 0 8px 32px var(--xw-shadow);
    display: none;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--xw-border);
    animation: xw-slide-in 0.2s ease-out;
  }

  .xw-panel--open { display: flex; }

  @keyframes xw-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Header */
  .xw-header {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    background: var(--xw-primary);
    color: #fff;
    gap: 10px;
    flex-shrink: 0;
  }

  .xw-header__title {
    flex: 1;
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .xw-header__status {
    font-size: 11px;
    opacity: 0.85;
  }

  .xw-header__close {
    width: 28px;
    height: 28px;
    border: none;
    background: rgba(255,255,255,0.2);
    color: #fff;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    outline: none;
    flex-shrink: 0;
  }

  .xw-header__close:hover { background: rgba(255,255,255,0.3); }
  .xw-header__close:focus-visible { box-shadow: 0 0 0 2px #fff; }
  .xw-header__close svg { width: 14px; height: 14px; fill: currentColor; }

  /* Messages area */
  .xw-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scroll-behavior: smooth;
  }

  .xw-messages::-webkit-scrollbar { width: 4px; }
  .xw-messages::-webkit-scrollbar-thumb { background: var(--xw-border); border-radius: 2px; }

  .xw-greeting {
    text-align: center;
    color: var(--xw-text-secondary);
    padding: 24px 16px;
    font-size: 13px;
  }

  /* Message bubble */
  .xw-bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: var(--xw-bubble-radius);
    word-wrap: break-word;
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.45;
  }

  .xw-bubble--user {
    align-self: flex-end;
    background: var(--xw-user-bubble);
    color: var(--xw-user-bubble-text);
    border-bottom-right-radius: 4px;
  }

  .xw-bubble--agent {
    align-self: flex-start;
    background: var(--xw-agent-bubble);
    color: var(--xw-agent-bubble-text);
    border-bottom-left-radius: 4px;
  }

  .xw-bubble__name {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 4px;
    opacity: 0.8;
  }

  .xw-bubble__time {
    font-size: 10px;
    opacity: 0.6;
    margin-top: 4px;
    text-align: right;
  }

  /* Typing indicator */
  .xw-typing {
    align-self: flex-start;
    padding: 10px 14px;
    background: var(--xw-agent-bubble);
    border-radius: var(--xw-bubble-radius);
    display: none;
    gap: 4px;
    align-items: center;
  }

  .xw-typing--visible { display: flex; }

  .xw-typing__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--xw-text-secondary);
    animation: xw-bounce 1.2s infinite;
  }
  .xw-typing__dot:nth-child(2) { animation-delay: 0.2s; }
  .xw-typing__dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes xw-bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-4px); }
  }

  /* Input area */
  .xw-input-area {
    display: flex;
    align-items: flex-end;
    padding: 12px;
    gap: 8px;
    border-top: 1px solid var(--xw-border);
    background: var(--xw-bg);
    flex-shrink: 0;
  }

  .xw-input {
    flex: 1;
    min-height: 38px;
    max-height: 100px;
    padding: 8px 12px;
    border: 1px solid var(--xw-border);
    border-radius: 20px;
    background: var(--xw-input-bg);
    color: var(--xw-input-text);
    font-family: var(--xw-font);
    font-size: 14px;
    resize: none;
    outline: none;
    overflow-y: auto;
    line-height: 1.4;
  }

  .xw-input::placeholder { color: var(--xw-text-secondary); }
  .xw-input:focus { border-color: var(--xw-primary); }

  .xw-send-btn, .xw-voice-btn {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, transform 0.1s;
    outline: none;
    flex-shrink: 0;
  }

  .xw-send-btn {
    background: var(--xw-primary);
    color: #fff;
  }

  .xw-send-btn:hover { background: var(--xw-primary-hover); }
  .xw-send-btn:focus-visible { box-shadow: 0 0 0 2px var(--xw-primary); }
  .xw-send-btn:disabled { opacity: 0.5; cursor: default; }
  .xw-send-btn svg { width: 18px; height: 18px; fill: currentColor; }

  .xw-voice-btn {
    background: var(--xw-surface);
    color: var(--xw-text);
    border: 1px solid var(--xw-border);
  }

  .xw-voice-btn:hover { background: var(--xw-border); }
  .xw-voice-btn:focus-visible { box-shadow: 0 0 0 2px var(--xw-primary); }
  .xw-voice-btn--recording {
    background: #e0245e;
    color: #fff;
    border-color: #e0245e;
    animation: xw-pulse 1.5s infinite;
  }
  .xw-voice-btn svg { width: 18px; height: 18px; fill: currentColor; }

  @keyframes xw-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(224,36,94,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(224,36,94,0); }
  }

  /* Connection status bar */
  .xw-status-bar {
    font-size: 11px;
    text-align: center;
    padding: 4px;
    background: var(--xw-surface);
    color: var(--xw-text-secondary);
    display: none;
    flex-shrink: 0;
  }

  .xw-status-bar--visible { display: block; }

  /* Screen reader only */
  .xw-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    border: 0;
  }

  @media (max-width: 480px) {
    .xw-panel {
      width: calc(100vw - 20px);
      height: calc(100vh - 80px);
      border-radius: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .xw-panel { animation: none; }
    .xw-typing__dot { animation: none; }
    .xw-voice-btn--recording { animation: none; }
    .xw-fab { transition: none; }
    .xw-fab:hover { transform: none; }
    .xw-send-btn, .xw-voice-btn, .xw-header__close { transition: none; }
    .xw-messages { scroll-behavior: auto; }
  }
`


