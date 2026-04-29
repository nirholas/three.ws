// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lightTheme, darkTheme, resolveTheme, themeToCSS, type Theme } from '../theme'

describe('theme', () => {
  // ── light / dark theme colours ──────────────────────────────────

  describe('lightTheme', () => {
    it('has a white background', () => {
      expect(lightTheme.backgroundColor).toBe('#ffffff')
    })

    it('has dark text', () => {
      expect(lightTheme.textColor).toBe('#0f1419')
    })

    it('has the branded primary color', () => {
      expect(lightTheme.primaryColor).toBe('#1d9bf0')
    })

    it('provides all required keys', () => {
      const requiredKeys: (keyof Theme)[] = [
        'primaryColor',
        'primaryHoverColor',
        'backgroundColor',
        'surfaceColor',
        'textColor',
        'textSecondaryColor',
        'userBubbleColor',
        'userBubbleTextColor',
        'agentBubbleColor',
        'agentBubbleTextColor',
        'borderColor',
        'inputBackgroundColor',
        'inputTextColor',
        'shadowColor',
        'fontFamily',
        'borderRadius',
        'bubbleBorderRadius',
      ]
      for (const key of requiredKeys) {
        expect(lightTheme[key]).toBeDefined()
      }
    })
  })

  describe('darkTheme', () => {
    it('has a dark background', () => {
      expect(darkTheme.backgroundColor).toBe('#15202b')
    })

    it('has light text', () => {
      expect(darkTheme.textColor).toBe('#d9d9d9')
    })

    it('shares the same primary color as light theme', () => {
      expect(darkTheme.primaryColor).toBe(lightTheme.primaryColor)
    })

    it('has distinct agent bubble colours from light theme', () => {
      expect(darkTheme.agentBubbleColor).not.toBe(lightTheme.agentBubbleColor)
    })
  })

  // ── resolveTheme ────────────────────────────────────────────────

  describe('resolveTheme', () => {
    it('returns lightTheme for mode "light"', () => {
      const theme = resolveTheme('light')
      expect(theme).toEqual(lightTheme)
    })

    it('returns darkTheme for mode "dark"', () => {
      const theme = resolveTheme('dark')
      expect(theme).toEqual(darkTheme)
    })

    describe('auto mode', () => {
      let originalMatchMedia: typeof window.matchMedia

      beforeEach(() => {
        originalMatchMedia = window.matchMedia
      })

      afterEach(() => {
        window.matchMedia = originalMatchMedia
      })

      it('returns darkTheme when OS prefers dark', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList)

        const theme = resolveTheme('auto')
        expect(theme.backgroundColor).toBe(darkTheme.backgroundColor)
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
      })

      it('returns lightTheme when OS prefers light', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList)

        const theme = resolveTheme('auto')
        expect(theme.backgroundColor).toBe(lightTheme.backgroundColor)
      })
    })

    it('merges a partial custom theme over the base', () => {
      const custom: Partial<Theme> = {
        primaryColor: '#ff0000',
        borderRadius: '8px',
      }
      const theme = resolveTheme('light', custom)
      expect(theme.primaryColor).toBe('#ff0000')
      expect(theme.borderRadius).toBe('8px')
      // everything else should remain from lightTheme
      expect(theme.backgroundColor).toBe(lightTheme.backgroundColor)
      expect(theme.textColor).toBe(lightTheme.textColor)
    })

    it('returns the base theme when custom is undefined', () => {
      const theme = resolveTheme('dark', undefined)
      expect(theme).toEqual(darkTheme)
    })
  })

  // ── themeToCSS ──────────────────────────────────────────────────

  describe('themeToCSS', () => {
    it('generates a :host rule with CSS custom properties', () => {
      const css = themeToCSS(lightTheme)
      expect(css).toContain(':host')
    })

    it('maps primaryColor to --xw-primary', () => {
      const css = themeToCSS(lightTheme)
      expect(css).toContain(`--xw-primary: ${lightTheme.primaryColor}`)
    })

    it('maps backgroundColor to --xw-bg', () => {
      const css = themeToCSS(darkTheme)
      expect(css).toContain(`--xw-bg: ${darkTheme.backgroundColor}`)
    })

    it('maps all theme properties to CSS variables', () => {
      const css = themeToCSS(lightTheme)

      const expectedMappings: [keyof Theme, string][] = [
        ['primaryColor', '--xw-primary'],
        ['primaryHoverColor', '--xw-primary-hover'],
        ['backgroundColor', '--xw-bg'],
        ['surfaceColor', '--xw-surface'],
        ['textColor', '--xw-text'],
        ['textSecondaryColor', '--xw-text-secondary'],
        ['userBubbleColor', '--xw-user-bubble'],
        ['userBubbleTextColor', '--xw-user-bubble-text'],
        ['agentBubbleColor', '--xw-agent-bubble'],
        ['agentBubbleTextColor', '--xw-agent-bubble-text'],
        ['borderColor', '--xw-border'],
        ['inputBackgroundColor', '--xw-input-bg'],
        ['inputTextColor', '--xw-input-text'],
        ['shadowColor', '--xw-shadow'],
        ['fontFamily', '--xw-font'],
        ['borderRadius', '--xw-radius'],
        ['bubbleBorderRadius', '--xw-bubble-radius'],
      ]

      for (const [themeKey, cssVar] of expectedMappings) {
        expect(css).toContain(`${cssVar}: ${lightTheme[themeKey]}`)
      }
    })

    it('produces different CSS for different themes', () => {
      const lightCSS = themeToCSS(lightTheme)
      const darkCSS = themeToCSS(darkTheme)
      expect(lightCSS).not.toBe(darkCSS)
    })
  })
})


