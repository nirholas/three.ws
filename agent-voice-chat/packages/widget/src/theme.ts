// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

export interface Theme {
  primaryColor: string
  primaryHoverColor: string
  backgroundColor: string
  surfaceColor: string
  textColor: string
  textSecondaryColor: string
  userBubbleColor: string
  userBubbleTextColor: string
  agentBubbleColor: string
  agentBubbleTextColor: string
  borderColor: string
  inputBackgroundColor: string
  inputTextColor: string
  shadowColor: string
  fontFamily: string
  borderRadius: string
  bubbleBorderRadius: string
}

export const lightTheme: Theme = {
  primaryColor: '#1d9bf0',
  primaryHoverColor: '#1a8cd8',
  backgroundColor: '#ffffff',
  surfaceColor: '#f7f9fa',
  textColor: '#0f1419',
  textSecondaryColor: '#536471',
  userBubbleColor: '#1d9bf0',
  userBubbleTextColor: '#ffffff',
  agentBubbleColor: '#eff3f4',
  agentBubbleTextColor: '#0f1419',
  borderColor: '#cfd9de',
  inputBackgroundColor: '#eff3f4',
  inputTextColor: '#0f1419',
  shadowColor: 'rgba(0,0,0,0.15)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: '16px',
  bubbleBorderRadius: '12px',
}

export const darkTheme: Theme = {
  primaryColor: '#1d9bf0',
  primaryHoverColor: '#1a8cd8',
  backgroundColor: '#15202b',
  surfaceColor: '#1e2732',
  textColor: '#d9d9d9',
  textSecondaryColor: '#8b98a5',
  userBubbleColor: '#1d9bf0',
  userBubbleTextColor: '#ffffff',
  agentBubbleColor: '#273340',
  agentBubbleTextColor: '#d9d9d9',
  borderColor: '#38444d',
  inputBackgroundColor: '#273340',
  inputTextColor: '#d9d9d9',
  shadowColor: 'rgba(0,0,0,0.5)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  borderRadius: '16px',
  bubbleBorderRadius: '12px',
}

export type ThemeMode = 'light' | 'dark' | 'auto'

export function resolveTheme(mode: ThemeMode, custom?: Partial<Theme>): Theme {
  let base: Theme
  if (mode === 'auto') {
    base = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? darkTheme
      : lightTheme
  } else {
    base = mode === 'dark' ? darkTheme : lightTheme
  }
  return custom ? { ...base, ...custom } : base
}

export function watchAutoTheme(
  onThemeChange: (theme: Theme, custom?: Partial<Theme>) => void,
  custom?: Partial<Theme>,
): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    const base = mq.matches ? darkTheme : lightTheme
    onThemeChange(custom ? { ...base, ...custom } : base, custom)
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

export function themeToCSS(theme: Theme): string {
  return `
    :host {
      --xw-primary: ${theme.primaryColor};
      --xw-primary-hover: ${theme.primaryHoverColor};
      --xw-bg: ${theme.backgroundColor};
      --xw-surface: ${theme.surfaceColor};
      --xw-text: ${theme.textColor};
      --xw-text-secondary: ${theme.textSecondaryColor};
      --xw-user-bubble: ${theme.userBubbleColor};
      --xw-user-bubble-text: ${theme.userBubbleTextColor};
      --xw-agent-bubble: ${theme.agentBubbleColor};
      --xw-agent-bubble-text: ${theme.agentBubbleTextColor};
      --xw-border: ${theme.borderColor};
      --xw-input-bg: ${theme.inputBackgroundColor};
      --xw-input-text: ${theme.inputTextColor};
      --xw-shadow: ${theme.shadowColor};
      --xw-font: ${theme.fontFamily};
      --xw-radius: ${theme.borderRadius};
      --xw-bubble-radius: ${theme.bubbleBorderRadius};
    }
  `
}


