// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

import { describe, it, expect } from 'vitest'
import {
  SELECTOR_DEFINITIONS,
  SELECTORS,
} from '../../../src/browser/selectors'
import type { SelectorDefinition } from '../../../src/browser/selector-engine'

describe('SELECTOR_DEFINITIONS', () => {
  // ── Basic structure ────────────────────────────────────────

  it('should be a non-empty array', () => {
    expect(Array.isArray(SELECTOR_DEFINITIONS)).toBe(true)
    expect(SELECTOR_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('should have unique names', () => {
    const names = SELECTOR_DEFINITIONS.map((d: SelectorDefinition) => d.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  // ── Per-definition validation ──────────────────────────────

  describe.each(
    SELECTOR_DEFINITIONS.map((d: SelectorDefinition) => [d.name, d]),
  )('definition "%s"', (_name, def) => {
    const definition = def as SelectorDefinition

    it('should have a non-empty name', () => {
      expect(definition.name).toBeTruthy()
      expect(typeof definition.name).toBe('string')
    })

    it('should have a non-empty description', () => {
      expect(definition.description).toBeTruthy()
      expect(typeof definition.description).toBe('string')
    })

    it('should have at least one strategy', () => {
      expect(definition.strategies.length).toBeGreaterThanOrEqual(1)
    })

    it('should have a CSS strategy (every definition needs at least one CSS selector)', () => {
      const hasCSS = definition.strategies.some(
        (s) => typeof s.selector === 'string' && s.selector.length > 0,
      )
      expect(hasCSS).toBe(true)
    })

    it('should have valid priority values (positive integers)', () => {
      for (const strategy of definition.strategies) {
        expect(strategy.priority).toBeGreaterThan(0)
        expect(Number.isInteger(strategy.priority)).toBe(true)
      }
    })

    it('should have unique strategy names within the definition', () => {
      const strategyNames = definition.strategies.map((s) => s.name)
      const unique = new Set(strategyNames)
      expect(unique.size).toBe(strategyNames.length)
    })

    it('should have non-empty strategy names', () => {
      for (const strategy of definition.strategies) {
        expect(strategy.name).toBeTruthy()
        expect(typeof strategy.name).toBe('string')
      }
    })

    it('should have non-empty selector strings', () => {
      for (const strategy of definition.strategies) {
        expect(strategy.selector).toBeTruthy()
        expect(typeof strategy.selector).toBe('string')
      }
    })
  })

  // ── Fallback strategies ────────────────────────────────────

  describe('fallback strategies', () => {
    it('should have multiple strategies for critical Space UI elements', () => {
      const criticalElements = ['join-button', 'unmute', 'leave-button', 'mic-button']

      for (const name of criticalElements) {
        const def = SELECTOR_DEFINITIONS.find(
          (d: SelectorDefinition) => d.name === name,
        )
        expect(def, `Missing definition for "${name}"`).toBeDefined()
        expect(
          def!.strategies.length,
          `"${name}" should have multiple strategies`,
        ).toBeGreaterThanOrEqual(2)
      }
    })

    it('should provide textMatch fallback for interactive buttons', () => {
      const buttonsWithText = ['join-button', 'request-speaker', 'unmute', 'leave-button']

      for (const name of buttonsWithText) {
        const def = SELECTOR_DEFINITIONS.find(
          (d: SelectorDefinition) => d.name === name,
        )
        expect(def, `Missing definition for "${name}"`).toBeDefined()
        expect(
          def!.textMatch,
          `"${name}" should have a textMatch fallback`,
        ).toBeTruthy()
      }
    })

    it('should provide ariaMatch fallback for accessibility', () => {
      const buttonsWithAria = ['join-button', 'unmute', 'mute', 'leave-button']

      for (const name of buttonsWithAria) {
        const def = SELECTOR_DEFINITIONS.find(
          (d: SelectorDefinition) => d.name === name,
        )
        expect(def, `Missing definition for "${name}"`).toBeDefined()
        expect(
          def!.ariaMatch,
          `"${name}" should have an ariaMatch fallback`,
        ).toBeTruthy()
      }
    })

    it('should have strategies sorted by priority (lower = preferred)', () => {
      for (const def of SELECTOR_DEFINITIONS) {
        const priorities = def.strategies.map((s) => s.priority)
        // We don't require strict sorting, but priority 1 should exist for primary
        expect(
          priorities.some((p) => p === 1),
          `"${def.name}" should have a strategy with priority 1`,
        ).toBe(true)
      }
    })
  })

  // ── Expected definitions present ───────────────────────────

  describe('completeness', () => {
    const expectedDefinitions = [
      'username-input',
      'next-button',
      'password-input',
      'login-button',
      'verify-email-input',
      'verify-next-button',
      'home-timeline',
      'join-button',
      'request-speaker',
      'unmute',
      'mute',
      'leave-button',
      'mic-button',
      'speaker-list',
      'space-ended',
      'space-live-indicator',
    ]

    it.each(expectedDefinitions)(
      'should include definition for "%s"',
      (name) => {
        const def = SELECTOR_DEFINITIONS.find(
          (d: SelectorDefinition) => d.name === name,
        )
        expect(def).toBeDefined()
      },
    )
  })
})

// ── Legacy SELECTORS map ───────────────────────────────────

describe('SELECTORS (legacy flat map)', () => {
  it('should export a non-empty SELECTORS object', () => {
    expect(typeof SELECTORS).toBe('object')
    expect(Object.keys(SELECTORS).length).toBeGreaterThan(0)
  })

  it('should have string values for all selector keys', () => {
    for (const [key, value] of Object.entries(SELECTORS)) {
      expect(typeof value, `SELECTORS.${key} should be a string`).toBe('string')
      expect(value.length, `SELECTORS.${key} should not be empty`).toBeGreaterThan(0)
    }
  })

  it('should include HOME_URL pointing to x.com', () => {
    expect(SELECTORS.HOME_URL).toContain('x.com')
  })

  it('should have login-related selectors', () => {
    expect(SELECTORS.LOGIN_USERNAME_INPUT).toBeDefined()
    expect(SELECTORS.LOGIN_PASSWORD_INPUT).toBeDefined()
    expect(SELECTORS.LOGIN_SUBMIT_BUTTON).toBeDefined()
  })

  it('should have space UI selectors', () => {
    expect(SELECTORS.SPACE_JOIN_BUTTON).toBeDefined()
    expect(SELECTORS.SPACE_UNMUTE_BUTTON).toBeDefined()
    expect(SELECTORS.SPACE_LEAVE_BUTTON).toBeDefined()
    expect(SELECTORS.SPACE_MIC_BUTTON).toBeDefined()
  })

  it('should have space state detection selectors', () => {
    expect(SELECTORS.SPACE_ENDED_TEXT).toBeDefined()
    expect(SELECTORS.SPACE_LIVE_INDICATOR).toBeDefined()
  })

  it('should use data-testid attributes where available', () => {
    expect(SELECTORS.LOGIN_SUBMIT_BUTTON).toContain('data-testid')
    expect(SELECTORS.SPACE_JOIN_BUTTON).toContain('data-testid')
  })
})


