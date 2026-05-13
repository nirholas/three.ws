// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginManager } from '../plugins/manager'
import type { Plugin, PluginContext } from '../plugins/types'
import type { TranscriptionEvent, Message } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    getStatus: () => 'idle',
    getSpaceUrl: () => 'https://x.com/i/spaces/test',
    getMessages: () => [],
    getSpeakers: () => [],
    getMetrics: () => ({}),
    speak: vi.fn().mockResolvedValue(undefined),
    addMessage: vi.fn(),
    log: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  }
}

function createPlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginManager', () => {
  let context: PluginContext
  let manager: PluginManager

  beforeEach(() => {
    context = createMockContext()
    manager = new PluginManager(context)
  })

  // ── Registration ────────────────────────────────────────────

  describe('use()', () => {
    it('registers a plugin', () => {
      const plugin = createPlugin({ name: 'my-plugin' })
      manager.use(plugin)
      expect(manager.getPlugins()).toEqual([
        { name: 'my-plugin', version: '1.0.0', description: undefined },
      ])
    })

    it('rejects plugins without a name', () => {
      expect(() => manager.use({ name: '', version: '1.0.0' })).toThrow(
        'Plugin must have name and version',
      )
    })

    it('rejects plugins without a version', () => {
      expect(() => manager.use({ name: 'x', version: '' })).toThrow(
        'Plugin must have name and version',
      )
    })

    it('rejects duplicate plugin names', () => {
      manager.use(createPlugin({ name: 'dupe' }))
      expect(() => manager.use(createPlugin({ name: 'dupe' }))).toThrow(
        "Plugin 'dupe' is already registered",
      )
    })

    it('preserves registration order', () => {
      manager.use(createPlugin({ name: 'a' }))
      manager.use(createPlugin({ name: 'b' }))
      manager.use(createPlugin({ name: 'c' }))
      const names = manager.getPlugins().map((p) => p.name)
      expect(names).toEqual(['a', 'b', 'c'])
    })
  })

  // ── init() ──────────────────────────────────────────────────

  describe('init()', () => {
    it('calls onInit on all plugins with the context', async () => {
      const onInit = vi.fn()
      manager.use(createPlugin({ name: 'p1', onInit }))
      manager.use(createPlugin({ name: 'p2', onInit }))

      await manager.init()

      expect(onInit).toHaveBeenCalledTimes(2)
      expect(onInit).toHaveBeenCalledWith(context)
    })

    it('continues initializing when one plugin fails', async () => {
      const onInit1 = vi.fn().mockRejectedValue(new Error('boom'))
      const onInit2 = vi.fn()

      manager.use(createPlugin({ name: 'failing', onInit: onInit1 }))
      manager.use(createPlugin({ name: 'working', onInit: onInit2 }))

      await manager.init()

      expect(onInit2).toHaveBeenCalledTimes(1)
      expect(context.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining("Plugin 'failing' failed to initialize"),
        expect.any(Object),
      )
    })

    it('skips plugins without onInit', async () => {
      manager.use(createPlugin({ name: 'no-init' }))
      await expect(manager.init()).resolves.toBeUndefined()
    })
  })

  // ── runHook() — pipeline pattern ────────────────────────────

  describe('runHook()', () => {
    it('passes initial value through when no plugins implement the hook', async () => {
      manager.use(createPlugin({ name: 'empty' }))
      const result = await manager.runHook('onResponse', 'hello')
      expect(result).toBe('hello')
    })

    it('transforms value through a single plugin', async () => {
      manager.use(
        createPlugin({
          name: 'uppercase',
          async onResponse(text: string) {
            return text.toUpperCase()
          },
        }),
      )
      const result = await manager.runHook('onResponse', 'hello')
      expect(result).toBe('HELLO')
    })

    it('chains value through multiple plugins in order', async () => {
      manager.use(
        createPlugin({
          name: 'append-a',
          async onResponse(text: string) {
            return text + '-a'
          },
        }),
      )
      manager.use(
        createPlugin({
          name: 'append-b',
          async onResponse(text: string) {
            return text + '-b'
          },
        }),
      )
      const result = await manager.runHook('onResponse', 'start')
      expect(result).toBe('start-a-b')
    })

    it('short-circuits on null (veto)', async () => {
      const afterVeto = vi.fn().mockResolvedValue('should not see this')

      manager.use(
        createPlugin({
          name: 'vetoer',
          async onResponse() {
            return null
          },
        }),
      )
      manager.use(
        createPlugin({
          name: 'after-veto',
          onResponse: afterVeto as any,
        }),
      )

      const result = await manager.runHook('onResponse', 'hello')
      expect(result).toBeNull()
      expect(afterVeto).not.toHaveBeenCalled()
    })

    it('keeps current value when plugin returns undefined', async () => {
      manager.use(
        createPlugin({
          name: 'noop',
          async onResponse() {
            // deliberately returns undefined
          },
        }),
      )
      const result = await manager.runHook('onResponse', 'unchanged')
      expect(result).toBe('unchanged')
    })

    it('continues chain when one plugin throws', async () => {
      manager.use(
        createPlugin({
          name: 'thrower',
          async onResponse() {
            throw new Error('plugin crash')
          },
        }),
      )
      manager.use(
        createPlugin({
          name: 'good',
          async onResponse(text: string) {
            return text + '-ok'
          },
        }),
      )

      const result = await manager.runHook('onResponse', 'test')
      expect(result).toBe('test-ok')
      expect(context.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining("Plugin 'thrower' hook 'onResponse' failed"),
        expect.any(Object),
      )
    })

    it('works with object values (onBeforeResponse)', async () => {
      const messages: Message[] = [{ role: 'user', content: 'hi' }]
      manager.use(
        createPlugin({
          name: 'prompt-modifier',
          async onBeforeResponse(input: { messages: Message[]; systemPrompt: string }) {
            return {
              messages: input.messages,
              systemPrompt: input.systemPrompt + ' Be concise.',
            }
          },
        }),
      )

      const result = await manager.runHook('onBeforeResponse', {
        messages,
        systemPrompt: 'You are helpful.',
      })
      expect(result).toEqual({
        messages,
        systemPrompt: 'You are helpful. Be concise.',
      })
    })

    it('works with TranscriptionEvent (onTranscription)', async () => {
      const event: TranscriptionEvent = {
        speaker: 'Alice',
        text: 'hello world',
        timestamp: 1000,
      }

      manager.use(
        createPlugin({
          name: 'text-cleaner',
          async onTranscription(result: TranscriptionEvent) {
            return { ...result, text: result.text.trim().toLowerCase() }
          },
        }),
      )

      const result = await manager.runHook('onTranscription', event)
      expect(result).toEqual({
        speaker: 'Alice',
        text: 'hello world',
        timestamp: 1000,
      })
    })

    it('passes extra arguments to hook', async () => {
      const hookFn = vi.fn().mockImplementation(async (value: string, extra: string) => {
        return value + extra
      })

      manager.use(createPlugin({ name: 'extra-args', onResponse: hookFn as any }))
      await manager.runHook('onResponse', 'base', '-extra')
      expect(hookFn).toHaveBeenCalledWith('base', '-extra')
    })
  })

  // ── notify() — fire-and-forget ──────────────────────────────

  describe('notify()', () => {
    it('calls notification hooks on all plugins', async () => {
      const onJoin1 = vi.fn()
      const onJoin2 = vi.fn()

      manager.use(createPlugin({ name: 'p1', onJoin: onJoin1 }))
      manager.use(createPlugin({ name: 'p2', onJoin: onJoin2 }))

      await manager.notify('onJoin', 'https://x.com/i/spaces/123')

      expect(onJoin1).toHaveBeenCalledWith('https://x.com/i/spaces/123')
      expect(onJoin2).toHaveBeenCalledWith('https://x.com/i/spaces/123')
    })

    it('continues notifying when one plugin throws', async () => {
      const onJoined1 = vi.fn().mockRejectedValue(new Error('oops'))
      const onJoined2 = vi.fn()

      manager.use(createPlugin({ name: 'broken', onJoined: onJoined1 }))
      manager.use(createPlugin({ name: 'healthy', onJoined: onJoined2 }))

      await manager.notify('onJoined', 'https://x.com/i/spaces/123')

      expect(onJoined2).toHaveBeenCalledTimes(1)
      expect(context.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining("Plugin 'broken'"),
        expect.any(Object),
      )
    })

    it('does nothing when no plugins implement the hook', async () => {
      manager.use(createPlugin({ name: 'no-hooks' }))
      await expect(manager.notify('onJoin', 'url')).resolves.toBeUndefined()
    })

    it('passes multiple arguments', async () => {
      const onError = vi.fn()
      manager.use(createPlugin({ name: 'error-handler', onError }))

      const err = new Error('test error')
      await manager.notify('onError', err, 'handleSpeechEnd')

      expect(onError).toHaveBeenCalledWith(err, 'handleSpeechEnd')
    })
  })

  // ── destroy() ───────────────────────────────────────────────

  describe('destroy()', () => {
    it('calls onDestroy on all plugins in reverse order', async () => {
      const order: string[] = []

      manager.use(
        createPlugin({
          name: 'first',
          async onDestroy() {
            order.push('first')
          },
        }),
      )
      manager.use(
        createPlugin({
          name: 'second',
          async onDestroy() {
            order.push('second')
          },
        }),
      )
      manager.use(
        createPlugin({
          name: 'third',
          async onDestroy() {
            order.push('third')
          },
        }),
      )

      await manager.destroy()
      expect(order).toEqual(['third', 'second', 'first'])
    })

    it('clears plugin list after destroy', async () => {
      manager.use(createPlugin({ name: 'temp' }))
      await manager.destroy()
      expect(manager.getPlugins()).toEqual([])
    })

    it('continues destroying when one plugin fails', async () => {
      const onDestroy = vi.fn()
      manager.use(
        createPlugin({
          name: 'bad',
          async onDestroy() {
            throw new Error('destroy fail')
          },
        }),
      )
      manager.use(createPlugin({ name: 'good', onDestroy }))

      await manager.destroy()
      // good is destroyed first (reverse order), then bad throws
      expect(onDestroy).toHaveBeenCalledTimes(1)
    })
  })

  // ── getPlugins() ────────────────────────────────────────────

  describe('getPlugins()', () => {
    it('returns plugin metadata', () => {
      manager.use(
        createPlugin({
          name: 'analytics',
          version: '2.1.0',
          description: 'Tracks metrics',
        }),
      )
      expect(manager.getPlugins()).toEqual([
        { name: 'analytics', version: '2.1.0', description: 'Tracks metrics' },
      ])
    })

    it('returns empty array when no plugins registered', () => {
      expect(manager.getPlugins()).toEqual([])
    })
  })

  // ── Integration: full pipeline scenario ─────────────────────

  describe('full pipeline integration', () => {
    it('moderation + analytics plugins work together', async () => {
      let analyticsCount = 0

      // Moderation plugin: veto responses containing "blocked"
      const moderation: Plugin = {
        name: 'moderation',
        version: '1.0.0',
        async onResponse(text: string) {
          if (text.includes('blocked')) return null
          return text
        },
      }

      // Analytics plugin: count responses that pass through
      const analytics: Plugin = {
        name: 'analytics',
        version: '1.0.0',
        async onResponse(text: string) {
          analyticsCount++
          return text
        },
      }

      manager.use(moderation)
      manager.use(analytics)

      // Safe response passes through both
      const safe = await manager.runHook('onResponse', 'Hello!')
      expect(safe).toBe('Hello!')
      expect(analyticsCount).toBe(1)

      // Blocked response is vetoed by moderation, analytics never sees it
      const blocked = await manager.runHook('onResponse', 'This is blocked content')
      expect(blocked).toBeNull()
      expect(analyticsCount).toBe(1) // unchanged
    })

    it('full lifecycle hooks fire in correct order', async () => {
      const events: string[] = []

      const plugin: Plugin = {
        name: 'lifecycle-tracker',
        version: '1.0.0',
        async onInit() { events.push('init') },
        async onJoin() { events.push('join') },
        async onJoined() { events.push('joined') },
        async onLeave() { events.push('leave') },
        async onDestroy() { events.push('destroy') },
      }

      manager.use(plugin)

      await manager.init()
      await manager.notify('onJoin', 'url')
      await manager.notify('onJoined', 'url')
      await manager.notify('onLeave')
      await manager.destroy()

      expect(events).toEqual(['init', 'join', 'joined', 'leave', 'destroy'])
    })

    it('transcription pipeline: transform then veto', async () => {
      const event: TranscriptionEvent = {
        speaker: 'Bob',
        text: '  hello  ',
        timestamp: 1000,
      }

      // Plugin 1: trims text
      manager.use(
        createPlugin({
          name: 'trimmer',
          async onTranscription(result: TranscriptionEvent) {
            return { ...result, text: result.text.trim() }
          },
        }),
      )

      // Plugin 2: vetoes short messages
      manager.use(
        createPlugin({
          name: 'min-length',
          async onTranscription(result: TranscriptionEvent) {
            if (result.text.length < 10) return null
            return result
          },
        }),
      )

      const result = await manager.runHook('onTranscription', event)
      expect(result).toBeNull() // "hello" is < 10 chars after trimming
    })

    it('onBeforeResponse can modify system prompt and messages', async () => {
      manager.use(
        createPlugin({
          name: 'context-injector',
          async onBeforeResponse(input: { messages: Message[]; systemPrompt: string }) {
            return {
              messages: [
                ...input.messages,
                { role: 'system' as const, content: 'Remember: be kind' },
              ],
              systemPrompt: input.systemPrompt,
            }
          },
        }),
      )

      manager.use(
        createPlugin({
          name: 'prompt-tweaker',
          async onBeforeResponse(input: { messages: Message[]; systemPrompt: string }) {
            return {
              messages: input.messages,
              systemPrompt: input.systemPrompt + '\nAlways respond in English.',
            }
          },
        }),
      )

      const result = await manager.runHook('onBeforeResponse', {
        messages: [{ role: 'user' as const, content: 'hi' }],
        systemPrompt: 'You are helpful.',
      })

      expect(result.messages).toHaveLength(2)
      expect(result.messages[1].content).toBe('Remember: be kind')
      expect(result.systemPrompt).toContain('Always respond in English.')
    })
  })

  // ── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles hook that is not a function gracefully', async () => {
      const plugin = createPlugin({ name: 'bad-hook' }) as any
      plugin.onResponse = 'not a function'
      manager.use(plugin)

      const result = await manager.runHook('onResponse', 'test')
      expect(result).toBe('test') // skipped, value unchanged
    })

    it('handles empty plugin list', async () => {
      await manager.init()
      const result = await manager.runHook('onResponse', 'test')
      expect(result).toBe('test')
      await manager.notify('onJoin', 'url')
      await manager.destroy()
    })

    it('runHook with null initial value', async () => {
      const result = await manager.runHook('onResponse', null)
      expect(result).toBeNull()
    })
  })
})


