// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Tests — Personality Routes (createPersonalityRouter)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../helpers/test-app'
import { createPersonalityRouter } from '../../src/routes/personalities'
import type { PersonalityWithMeta, Personality } from '../../src/personalities'

// ---------------------------------------------------------------------------
// Mock PersonalityLoader
// ---------------------------------------------------------------------------

function createMockLoader() {
  const presetPersonality: PersonalityWithMeta = {
    id: 'default-host',
    name: 'Default Host',
    description: 'A friendly podcast host',
    systemPrompt: 'You are a friendly podcast host.',
    voice: { provider: 'elevenlabs', voiceId: 'voice-1' },
    behavior: { temperature: 0.7 },
    context: ['podcasting'],
    isPreset: true,
  }

  const customPersonality: PersonalityWithMeta = {
    id: 'my-agent',
    name: 'My Agent',
    description: 'Custom agent personality',
    systemPrompt: 'You are a custom agent.',
    voice: { provider: 'openai' },
    behavior: { temperature: 0.9, maxResponseTokens: 500 },
    context: ['custom'],
    isPreset: false,
  }

  return {
    list: vi.fn().mockReturnValue([presetPersonality, customPersonality]),
    get: vi.fn((id: string) => {
      if (id === 'default-host') return presetPersonality
      if (id === 'my-agent') return customPersonality
      return undefined
    }),
    create: vi.fn((p: Personality) => ({ ...p, isPreset: false })),
    update: vi.fn((id: string, updates: Partial<Personality>) => {
      if (id === 'my-agent') return { ...customPersonality, ...updates, isPreset: false }
      if (id === 'not-found') throw new Error("Personality 'not-found' not found")
      if (id === 'default-host') throw new Error('Cannot modify a preset personality')
      return { ...customPersonality, ...updates, isPreset: false }
    }),
    delete: vi.fn((id: string) => {
      if (id === 'not-found') throw new Error("Personality 'not-found' not found")
      if (id === 'default-host') throw new Error('Cannot delete a preset personality')
    }),
    reload: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Personality Routes', () => {
  let loader: ReturnType<typeof createMockLoader>

  beforeEach(() => {
    loader = createMockLoader()
  })

  function buildApp() {
    const app = createTestApp()
    app.use('/api/personalities', createPersonalityRouter(loader as any))
    return app
  }

  // ── GET /api/personalities ────────────────────────────────────────────

  describe('GET /api/personalities', () => {
    it('returns the full list of personalities', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/personalities')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0].id).toBe('default-host')
      expect(res.body[1].id).toBe('my-agent')
      expect(loader.list).toHaveBeenCalledOnce()
    })

    it('returns empty array when no personalities exist', async () => {
      loader.list.mockReturnValue([])
      const app = buildApp()
      const res = await request(app).get('/api/personalities')

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })
  })

  // ── GET /api/personalities/:id ────────────────────────────────────────

  describe('GET /api/personalities/:id', () => {
    it('returns a personality by ID', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/personalities/default-host')

      expect(res.status).toBe(200)
      expect(res.body.id).toBe('default-host')
      expect(res.body.name).toBe('Default Host')
      expect(res.body.isPreset).toBe(true)
    })

    it('returns 404 for unknown personality', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/personalities/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  // ── POST /api/personalities ───────────────────────────────────────────

  describe('POST /api/personalities', () => {
    it('creates a new personality', async () => {
      const app = buildApp()
      const body = {
        id: 'new-agent',
        name: 'New Agent',
        systemPrompt: 'You are helpful.',
      }

      const res = await request(app)
        .post('/api/personalities')
        .send(body)

      expect(res.status).toBe(201)
      expect(res.body.isPreset).toBe(false)
      expect(loader.create).toHaveBeenCalledOnce()
    })

    it('returns 400 when body validation fails (missing name)', async () => {
      const app = buildApp()
      const body = { id: 'bad', systemPrompt: '' }

      const res = await request(app)
        .post('/api/personalities')
        .send(body)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when loader.create throws', async () => {
      loader.create.mockImplementation(() => {
        throw new Error('Cannot overwrite a preset personality')
      })

      const app = buildApp()
      const body = {
        id: 'default-host',
        name: 'Override Host',
        systemPrompt: 'Override prompt',
      }

      const res = await request(app)
        .post('/api/personalities')
        .send(body)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // ── PUT /api/personalities/:id ────────────────────────────────────────

  describe('PUT /api/personalities/:id', () => {
    it('updates a custom personality', async () => {
      const app = buildApp()
      const res = await request(app)
        .put('/api/personalities/my-agent')
        .send({ name: 'Updated Agent' })

      expect(res.status).toBe(200)
      expect(loader.update).toHaveBeenCalledWith('my-agent', expect.any(Object))
    })

    it('returns 404 for not-found personality', async () => {
      const app = buildApp()
      const res = await request(app)
        .put('/api/personalities/not-found')
        .send({ name: 'Nope' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 400 when trying to modify a preset', async () => {
      const app = buildApp()
      const res = await request(app)
        .put('/api/personalities/default-host')
        .send({ name: 'Hack' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // ── DELETE /api/personalities/:id ─────────────────────────────────────

  describe('DELETE /api/personalities/:id', () => {
    it('deletes a custom personality', async () => {
      const app = buildApp()
      const res = await request(app).delete('/api/personalities/my-agent')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
      expect(loader.delete).toHaveBeenCalledWith('my-agent')
    })

    it('returns 404 for not-found personality', async () => {
      const app = buildApp()
      const res = await request(app).delete('/api/personalities/not-found')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 400 when trying to delete a preset', async () => {
      const app = buildApp()
      const res = await request(app).delete('/api/personalities/default-host')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})


