// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { ThemeOverrides } from '../types';

export interface ThemeVars {
  primary: string;
  primaryHover: string;
  bg: string;
  bgSecondary: string;
  text: string;
  textMuted: string;
  border: string;
  shadow: string;
  fontFamily: string;
  radius: string;
}

const darkTheme: ThemeVars = {
  primary: '#6C63FF',
  primaryHover: '#5A52D5',
  bg: '#1A1A2E',
  bgSecondary: '#16213E',
  text: '#E8E8E8',
  textMuted: '#8B8B9E',
  border: 'rgba(255,255,255,0.08)',
  shadow: '0 8px 32px rgba(0,0,0,0.4)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  radius: '16px',
};

const lightTheme: ThemeVars = {
  primary: '#6C63FF',
  primaryHover: '#5A52D5',
  bg: '#FFFFFF',
  bgSecondary: '#F5F5FA',
  text: '#1A1A2E',
  textMuted: '#6B7280',
  border: 'rgba(0,0,0,0.08)',
  shadow: '0 8px 32px rgba(0,0,0,0.12)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  radius: '16px',
};

export function resolveTheme(theme: 'light' | 'dark', overrides: ThemeOverrides): ThemeVars {
  const base = theme === 'dark' ? { ...darkTheme } : { ...lightTheme };
  if (overrides.primaryColor) {
    base.primary = overrides.primaryColor;
    base.primaryHover = overrides.primaryColor;
  }
  if (overrides.backgroundColor) base.bg = overrides.backgroundColor;
  if (overrides.textColor) base.text = overrides.textColor;
  if (overrides.fontFamily) base.fontFamily = overrides.fontFamily;
  if (overrides.borderRadius) base.radius = overrides.borderRadius;
  return base;
}

export function buildStyles(t: ThemeVars, modalWidth: number, buttonSize: number): string {
  return /* css */ `
    :host {
      all: initial;
      font-family: ${t.fontFamily};
      color: ${t.text};
      font-size: 14px;
      line-height: 1.5;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ---- Floating Button ---- */
    .avc-button {
      position: fixed;
      z-index: 2147483646;
      width: ${buttonSize}px;
      height: ${buttonSize}px;
      border-radius: 50%;
      background: ${t.primary};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: ${t.shadow};
      transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      outline: none;
    }
    .avc-button:hover {
      transform: scale(1.08);
      background: ${t.primaryHover};
    }
    .avc-button:focus-visible {
      box-shadow: 0 0 0 3px ${t.primary}44;
    }
    .avc-button.bottom-right { bottom: 24px; right: 24px; }
    .avc-button.bottom-left  { bottom: 24px; left: 24px; }
    .avc-button.top-right    { top: 24px; right: 24px; }
    .avc-button.top-left     { top: 24px; left: 24px; }

    .avc-button svg {
      width: 24px;
      height: 24px;
      fill: #fff;
      transition: opacity 0.2s;
    }

    .avc-button .avc-avatar {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }

    /* Pulse ring when agent is speaking */
    .avc-button.speaking::after {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid ${t.primary};
      animation: avc-pulse 1.5s ease-in-out infinite;
    }

    @keyframes avc-pulse {
      0%, 100% { transform: scale(1); opacity: 0.6; }
      50% { transform: scale(1.15); opacity: 0; }
    }

    /* Connection status dot */
    .avc-status-dot {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid ${t.bg};
      background: #888;
      transition: background 0.3s;
    }
    .avc-status-dot.connected { background: #22C55E; }
    .avc-status-dot.connecting { background: #F59E0B; }
    .avc-status-dot.error { background: #EF4444; }

    /* ---- Modal ---- */
    .avc-modal-overlay {
      position: fixed;
      z-index: 2147483647;
      display: none;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .avc-modal-overlay.open {
      display: block;
      opacity: 1;
    }
    .avc-modal-overlay.bottom-right { bottom: ${buttonSize + 36}px; right: 24px; }
    .avc-modal-overlay.bottom-left  { bottom: ${buttonSize + 36}px; left: 24px; }
    .avc-modal-overlay.top-right    { top: ${buttonSize + 36}px; right: 24px; }
    .avc-modal-overlay.top-left     { top: ${buttonSize + 36}px; left: 24px; }

    .avc-modal {
      width: ${modalWidth}px;
      max-width: calc(100vw - 32px);
      max-height: min(600px, calc(100vh - ${buttonSize + 80}px));
      background: ${t.bg};
      border: 1px solid ${t.border};
      border-radius: ${t.radius};
      box-shadow: ${t.shadow};
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: avc-slide-in 0.25s ease;
    }

    @keyframes avc-slide-in {
      from { transform: translateY(8px); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }

    /* Header */
    .avc-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid ${t.border};
      flex-shrink: 0;
    }
    .avc-header-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: ${t.primary};
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }
    .avc-header-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avc-header-avatar svg {
      width: 20px;
      height: 20px;
      fill: #fff;
    }
    .avc-header-info {
      flex: 1;
      min-width: 0;
    }
    .avc-header-name {
      font-weight: 600;
      font-size: 15px;
      color: ${t.text};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .avc-header-status {
      font-size: 12px;
      color: ${t.textMuted};
    }
    .avc-close-btn {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${t.textMuted};
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    .avc-close-btn:hover {
      background: ${t.bgSecondary};
      color: ${t.text};
    }
    .avc-close-btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }

    /* Visualizer area */
    .avc-visualizer {
      flex-shrink: 0;
      padding: 24px 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${t.bgSecondary};
      min-height: 100px;
    }
    .avc-waveform {
      display: flex;
      align-items: center;
      gap: 3px;
      height: 48px;
    }
    .avc-waveform-bar {
      width: 4px;
      border-radius: 2px;
      background: ${t.primary};
      transition: height 0.1s ease;
      height: 6px;
    }
    .avc-waveform-bar.active {
      animation: avc-wave 0.6s ease-in-out infinite alternate;
    }
    @keyframes avc-wave {
      0% { height: 6px; }
      100% { height: 40px; }
    }
    .avc-visualizer-label {
      font-size: 13px;
      color: ${t.textMuted};
      text-align: center;
      margin-top: 8px;
    }

    /* Transcript */
    .avc-transcript {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      scrollbar-width: thin;
      scrollbar-color: ${t.border} transparent;
    }
    .avc-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .avc-msg.agent {
      align-self: flex-start;
      background: ${t.bgSecondary};
      color: ${t.text};
      border-bottom-left-radius: 4px;
    }
    .avc-msg.user {
      align-self: flex-end;
      background: ${t.primary};
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .avc-msg-name {
      font-size: 11px;
      font-weight: 600;
      color: ${t.textMuted};
      margin-bottom: 2px;
    }
    .avc-msg-streaming::after {
      content: '▋';
      animation: avc-blink 0.8s step-end infinite;
    }
    @keyframes avc-blink {
      50% { opacity: 0; }
    }

    .avc-empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${t.textMuted};
      font-size: 13px;
      padding: 32px;
      text-align: center;
    }

    /* Controls footer */
    .avc-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      border-top: 1px solid ${t.border};
      flex-shrink: 0;
    }
    .avc-mic-btn {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: ${t.primary};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s, background 0.15s, box-shadow 0.15s;
      outline: none;
    }
    .avc-mic-btn:hover {
      transform: scale(1.05);
      background: ${t.primaryHover};
    }
    .avc-mic-btn:focus-visible {
      box-shadow: 0 0 0 3px ${t.primary}44;
    }
    .avc-mic-btn.active {
      background: #EF4444;
      box-shadow: 0 0 0 4px rgba(239,68,68,0.25);
    }
    .avc-mic-btn.active:hover {
      background: #DC2626;
    }
    .avc-mic-btn svg {
      width: 24px;
      height: 24px;
      fill: #fff;
    }
    .avc-mic-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    /* Text input */
    .avc-input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 16px 16px;
      flex-shrink: 0;
    }
    .avc-text-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid ${t.border};
      border-radius: 12px;
      background: ${t.bgSecondary};
      color: ${t.text};
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    .avc-text-input:focus {
      border-color: ${t.primary};
    }
    .avc-text-input::placeholder {
      color: ${t.textMuted};
    }
    .avc-send-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: ${t.primary};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .avc-send-btn:hover { background: ${t.primaryHover}; }
    .avc-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .avc-send-btn svg { width: 16px; height: 16px; fill: #fff; }

    /* Loading spinner */
    .avc-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid ${t.border};
      border-top-color: ${t.primary};
      border-radius: 50%;
      animation: avc-spin 0.6s linear infinite;
    }
    @keyframes avc-spin {
      to { transform: rotate(360deg); }
    }

    /* Mobile responsive */
    @media (max-width: 480px) {
      .avc-modal-overlay.bottom-right,
      .avc-modal-overlay.bottom-left,
      .avc-modal-overlay.top-right,
      .avc-modal-overlay.top-left {
        inset: 0;
        bottom: auto;
        right: auto;
        left: auto;
        top: auto;
        position: fixed;
        display: none;
        align-items: stretch;
        justify-content: stretch;
      }
      .avc-modal-overlay.open {
        display: flex;
        inset: 0;
        background: rgba(0,0,0,0.5);
        align-items: flex-end;
        justify-content: stretch;
        padding: 16px;
      }
      .avc-modal {
        width: 100%;
        max-width: 100%;
        max-height: calc(100vh - 32px);
        border-radius: 16px 16px 16px 16px;
      }
    }
  `;
}


