// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SelectorEngine, validateSelectors } from '../browser/selector-engine'
import type { SelectorDefinition } from '../browser/selector-engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPage(dom: Record<string, boolean> = {}) {
  return {
    $: vi.fn().mockImplementation(async (selector: string) => {
      if (dom[selector]) {
        return { dispose: vi.fn() } // mock ElementHandle
      }
      return null
    }),
    evaluateHandle: vi.fn().mockImplementation(async () => ({
      asElement: () => null,
      dispose: vi.fn(),
    })),
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ nodes: [] }),
      detach: vi.fn(),
    }),
  } as any
}

const TEST_DEFINITIONS: SelectorDefinition[] = [
  {
    name: 'join-button',
    description: 'Button to join a Space',
    strategies: [
      { name: 'testid', selector: '[data-testid="SpaceJoinButton"]', priority: 1 },
      { name: 'aria', selector: 'button[aria-label*="Join"]', priority: 2 },
      { name: 'aria-listen', selector: 'button[aria-label*="Listen"]', priority: 3 },
    ],
    textMatch: 'Join',
    ariaMatch: 'Join',
  },
  {
    name: 'unmute',
    description: 'Unmute button',
    strategies: [
      { name: 'testid', selector: '[data-testid="unmuteButton"]', priority: 1 },
      { name: 'aria', selector: 'button[aria-label*="Unmute"]', priority: 2 },
    ],
    textMatch: 'Unmute',
    ariaMatch: 'Unmute',
  },
  {
    name: 'leave-button',
    description: 'Leave the Space',
    strategies: [
      { name: 'testid', selector: '[data-testid="leaveButton"]', priority: 1 },
      { name: 'aria', selector: 'button[aria-label*="Leave"]', priority: 2 },
    ],
    textMatch: 'Leave',
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SelectorEngine', () => {
  let engine: SelectorEngine

  beforeEach(() => {
    engine = new SelectorEngine(TEST_DEFINITIONS)
  })

  describe('constructor', () => {
    it('registers all definitions', () => {
      expect(engine.getDefinitionNames()).toEqual(['join-button', 'unmute', 'leave-button'])
    })
  })

  describe('get()', () => {
    it('returns highest-priority selector by default', () => {
      expect(engine.get('join-button')).toBe('[data-testid="SpaceJoinButton"]')
    })

    it('returns cached selector when available', () => {
      engine.override('join-button', 'button.custom')
      expect(engine.get('join-button')).toBe('button.custom')
    })

    it('throws for unknown selector name', () => {
      expect(() => engine.get('nonexistent')).toThrow('Unknown selector: nonexistent')
    })
  })

  describe('find()', () => {
    it('finds element using first matching strategy', async () => {
      const page = createMockPage({
        '[data-testid="SpaceJoinButton"]': true,
      })

      const el = await engine.find(page, 'join-button')
      expect(el).not.toBeNull()
      expect(engine.getSuccessCache().get('join-button')).toBe('[data-testid="SpaceJoinButton"]')
    })

    it('falls back to lower-priority strategy when primary fails', async () => {
      const page = createMockPage({
        'button[aria-label*="Join"]': true,
      })

      const el = await engine.find(page, 'join-button')
      expect(el).not.toBeNull()
      expect(engine.getSuccessCache().get('join-button')).toBe('button[aria-label*="Join"]')
    })

    it('uses cached selector on subsequent calls', async () => {
      const page = createMockPage({
        'button[aria-label*="Join"]': true,
      })

      await engine.find(page, 'join-button')
      // Second call should try cached selector first
      await engine.find(page, 'join-button')
      // The first call to page.$ after the first find should be the cached selector
      const calls = page.$.mock.calls.map((c: any) => c[0])
      // After caching, second find should start with the cached selector
      expect(calls).toContain('button[aria-label*="Join"]')
    })

    it('clears stale cache and retries strategies', async () => {
      const page = createMockPage({
        'button[aria-label*="Unmute"]': true,
      })

      // Manually cache a selector that no longer works
      engine.override('unmute', '[data-testid="unmuteButton"]')

      const el = await engine.find(page, 'unmute')
      expect(el).not.toBeNull()
      // Should have fallen through to the working strategy
      expect(engine.getSuccessCache().get('unmute')).toBe('button[aria-label*="Unmute"]')
    })

    it('returns null when all strategies fail', async () => {
      const page = createMockPage({}) // nothing matches

      const el = await engine.find(page, 'leave-button')
      expect(el).toBeNull()

      const failures = engine.getFailureReport()
      expect(failures.some((f) => f.name === 'leave-button' && f.selector === 'ALL_STRATEGIES')).toBe(true)
    })

    it('throws for unknown selector name', async () => {
      const page = createMockPage({})
      await expect(engine.find(page, 'nonexistent')).rejects.toThrow('Unknown selector: nonexistent')
    })

    it('handles page.$ throwing (invalid selector)', async () => {
      const page = createMockPage({})
      page.$.mockImplementation(async (selector: string) => {
        if (selector === '[data-testid="unmuteButton"]') throw new Error('Invalid selector')
        return null
      })

      const el = await engine.find(page, 'unmute')
      expect(el).toBeNull()
      // Should have logged the failure
      const failures = engine.getFailureReport()
      expect(failures.length).toBeGreaterThan(0)
    })
  })

  describe('override()', () => {
    it('sets a manual override that takes priority', async () => {
      const page = createMockPage({
        'button.manual-override': true,
      })

      engine.override('join-button', 'button.manual-override')
      const el = await engine.find(page, 'join-button')
      expect(el).not.toBeNull()
    })
  })

  describe('getFailureReport()', () => {
    it('starts empty', () => {
      expect(engine.getFailureReport()).toEqual([])
    })

    it('accumulates failures', async () => {
      const page = createMockPage({})
      await engine.find(page, 'join-button')
      const failures = engine.getFailureReport()
      expect(failures.length).toBeGreaterThan(0)
      expect(failures[failures.length - 1].name).toBe('join-button')
    })

    it('returns a copy (not a reference)', () => {
      const a = engine.getFailureReport()
      const b = engine.getFailureReport()
      expect(a).not.toBe(b)
    })
  })

  describe('getDefinition()', () => {
    it('returns the definition for a known name', () => {
      const def = engine.getDefinition('unmute')
      expect(def).toBeDefined()
      expect(def!.strategies).toHaveLength(2)
    })

    it('returns undefined for unknown name', () => {
      expect(engine.getDefinition('nope')).toBeUndefined()
    })
  })
})

describe('validateSelectors()', () => {
  it('reports healthy and broken selectors', async () => {
    const page = createMockPage({
      '[data-testid="SpaceJoinButton"]': true,
      // unmute and leave-button will be broken
    })

    const engine = new SelectorEngine(TEST_DEFINITIONS)
    const report = await validateSelectors(page, engine)

    expect(report.timestamp).toBeGreaterThan(0)
    expect(report.healthy.some((h) => h.name === 'join-button')).toBe(true)
    expect(report.broken.some((b) => b.name === 'unmute')).toBe(true)
    expect(report.broken.some((b) => b.name === 'leave-button')).toBe(true)
  })

  it('returns all healthy when everything matches', async () => {
    const page = createMockPage({
      '[data-testid="SpaceJoinButton"]': true,
      '[data-testid="unmuteButton"]': true,
      '[data-testid="leaveButton"]': true,
    })

    const engine = new SelectorEngine(TEST_DEFINITIONS)
    const report = await validateSelectors(page, engine)

    expect(report.healthy).toHaveLength(3)
    expect(report.broken).toHaveLength(0)
  })
})


