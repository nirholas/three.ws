// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Tests — Builder Routes (createBuilderRouter)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../helpers/test-app'

// ---------------------------------------------------------------------------
// Mock xspace-agent exports used by the builder router
// ---------------------------------------------------------------------------

const mockTemplates = [
  {
    id: 'tmpl-host',
    name: 'Podcast Host',
    category: 'entertainment',
    flow: {
      name: 'Podcast Host',
      description: 'A podcast host agent',
      nodes: [{ id: 'n1', type: 'listen' }],
      connections: [{ from: 'n1', to: 'n2' }],
      variables: [],
      personality: {
        name: 'Host',
        role: 'Podcast Host',
        tone: 60,
        energy: 70,
        detail: 50,
        humor: 40,
        knowledgeAreas: ['podcasting'],
        excludeTopics: [],
        exampleConversations: [],
      },
    },
  },
  {
    id: 'tmpl-debate',
    name: 'Debate Moderator',
    category: 'moderation',
    flow: {
      name: 'Debate Moderator',
      description: 'A debate moderator agent',
      nodes: [{ id: 'n1', type: 'listen' }],
      connections: [],
      variables: [{ name: 'topic', value: 'AI' }],
      personality: {
        name: 'Moderator',
        role: 'Debate Moderator',
        tone: 50,
        energy: 50,
        detail: 70,
        humor: 20,
        knowledgeAreas: ['debate'],
        excludeTopics: [],
        exampleConversations: [],
      },
    },
  },
]

vi.mock('xspace-agent', () => ({
  getFlowTemplates: vi.fn(() => mockTemplates),
  getFlowTemplate: vi.fn((id: string) => mockTemplates.find((t) => t.id === id) ?? null),
  getFlowTemplatesByCategory: vi.fn((cat: string) =>
    mockTemplates.filter((t) => t.category === cat),
  ),
  validateFlow: vi.fn((flow: any) => {
    // Simulate valid if flow has nodes, invalid otherwise
    if (flow.nodes && flow.nodes.length > 0) {
      return { valid: true, errors: [] }
    }
    return { valid: false, errors: [{ message: 'No nodes' }] }
  }),
  transpileFlowToConfig: vi.fn((flow: any) => ({
    name: flow.name,
    provider: 'openai',
    personality: flow.personality,
  })),
}))

// Must import after mock setup
import { createBuilderRouter } from '../../src/routes/builder'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Builder Routes', () => {
  function buildApp() {
    const app = createTestApp()
    app.use('/api/builder', createBuilderRouter())
    return app
  }

  // =========================================================================
  // Templates
  // =========================================================================

  describe('GET /api/builder/templates', () => {
    it('returns all templates', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/templates')

      expect(res.status).toBe(200)
      expect(res.body.templates).toHaveLength(2)
      expect(res.body.templates[0].id).toBe('tmpl-host')
    })
  })

  describe('GET /api/builder/templates/:id', () => {
    it('returns a template by id', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/templates/tmpl-host')

      expect(res.status).toBe(200)
      expect(res.body.template.name).toBe('Podcast Host')
    })

    it('returns 404 for unknown template', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/templates/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('GET /api/builder/templates/category/:category', () => {
    it('returns templates by category', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/templates/category/entertainment')

      expect(res.status).toBe(200)
      expect(res.body.templates).toHaveLength(1)
      expect(res.body.templates[0].id).toBe('tmpl-host')
    })

    it('returns empty array for unknown category', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/templates/category/unknown')

      expect(res.status).toBe(200)
      expect(res.body.templates).toEqual([])
    })
  })

  // =========================================================================
  // Flows CRUD
  // =========================================================================

  describe('POST /api/builder/flows', () => {
    it('creates a new flow', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'My Flow', description: 'A test flow' })

      expect(res.status).toBe(201)
      expect(res.body.flow).toBeDefined()
      expect(res.body.flow.name).toBe('My Flow')
      expect(res.body.flow.id).toBeTruthy()
      expect(res.body.flow.version).toBe(1)
    })

    it('creates a flow with nodes and connections', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows')
        .send({
          name: 'Complex Flow',
          nodes: [{ id: 'n1', type: 'listen' }],
          connections: [{ from: 'n1', to: 'n2' }],
        })

      expect(res.status).toBe(201)
      expect(res.body.flow.nodes).toHaveLength(1)
      expect(res.body.flow.connections).toHaveLength(1)
    })

    it('returns 400 when name is missing', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows')
        .send({ description: 'Missing name' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /api/builder/flows', () => {
    it('lists all saved flows', async () => {
      const app = buildApp()

      // Create a flow first
      await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Flow A' })

      const res = await request(app).get('/api/builder/flows')

      expect(res.status).toBe(200)
      expect(res.body.flows).toBeDefined()
      expect(Array.isArray(res.body.flows)).toBe(true)
      // Should have at least the flow we just created
      const flow = res.body.flows.find((f: any) => f.name === 'Flow A')
      expect(flow).toBeDefined()
      expect(flow.nodeCount).toBe(0)
    })
  })

  describe('GET /api/builder/flows/:id', () => {
    it('returns a flow by id', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Findable Flow' })
      const flowId = createRes.body.flow.id

      const res = await request(app).get(`/api/builder/flows/${flowId}`)

      expect(res.status).toBe(200)
      expect(res.body.flow.name).toBe('Findable Flow')
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/flows/nonexistent-id')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('PUT /api/builder/flows/:id', () => {
    it('updates an existing flow', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Original Name' })
      const flowId = createRes.body.flow.id

      const res = await request(app)
        .put(`/api/builder/flows/${flowId}`)
        .send({ name: 'Updated Name' })

      expect(res.status).toBe(200)
      expect(res.body.flow.name).toBe('Updated Name')
      expect(res.body.flow.version).toBe(2)
    })

    it('increments version on each update', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Versioned' })
      const flowId = createRes.body.flow.id

      await request(app).put(`/api/builder/flows/${flowId}`).send({ name: 'V2' })
      const res = await request(app).put(`/api/builder/flows/${flowId}`).send({ name: 'V3' })

      expect(res.body.flow.version).toBe(3)
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app)
        .put('/api/builder/flows/unknown-id')
        .send({ name: 'Nope' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('DELETE /api/builder/flows/:id', () => {
    it('deletes a flow', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Doomed Flow' })
      const flowId = createRes.body.flow.id

      const res = await request(app).delete(`/api/builder/flows/${flowId}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify it's actually gone
      const getRes = await request(app).get(`/api/builder/flows/${flowId}`)
      expect(getRes.status).toBe(404)
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app).delete('/api/builder/flows/unknown-id')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  // =========================================================================
  // From Template
  // =========================================================================

  describe('POST /api/builder/flows/from-template/:templateId', () => {
    it('creates a flow from a template', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows/from-template/tmpl-host')
        .send({})

      expect(res.status).toBe(201)
      expect(res.body.flow.name).toBe('Podcast Host')
      expect(res.body.flow.templateId).toBe('tmpl-host')
      expect(res.body.flow.nodes).toHaveLength(1)
    })

    it('creates a flow from a template with custom name', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows/from-template/tmpl-debate')
        .send({ name: 'My Debate' })

      expect(res.status).toBe(201)
      expect(res.body.flow.name).toBe('My Debate')
    })

    it('returns 404 for unknown template', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows/from-template/nonexistent')
        .send({})

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  // =========================================================================
  // Validate
  // =========================================================================

  describe('POST /api/builder/flows/:id/validate', () => {
    it('validates a saved flow with nodes', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Valid Flow', nodes: [{ id: 'n1', type: 'listen' }] })
      const flowId = createRes.body.flow.id

      const res = await request(app).post(`/api/builder/flows/${flowId}/validate`)

      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(true)
    })

    it('returns validation errors for invalid flow', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Empty Flow' })
      const flowId = createRes.body.flow.id

      const res = await request(app).post(`/api/builder/flows/${flowId}/validate`)

      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(false)
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app).post('/api/builder/flows/unknown-id/validate')

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/builder/validate', () => {
    it('validates an unsaved flow body', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/validate')
        .send({
          nodes: [{ id: 'n1', type: 'listen' }],
          connections: [],
        })

      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(true)
    })

    it('returns 400 when no nodes provided', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/validate')
        .send({ nodes: [] })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // =========================================================================
  // Transpile
  // =========================================================================

  describe('POST /api/builder/flows/:id/transpile', () => {
    it('transpiles a valid flow to config', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Transpilable', nodes: [{ id: 'n1', type: 'listen' }] })
      const flowId = createRes.body.flow.id

      const res = await request(app).post(`/api/builder/flows/${flowId}/transpile`)

      expect(res.status).toBe(200)
      expect(res.body.config).toBeDefined()
      expect(res.body.config.name).toBe('Transpilable')
    })

    it('returns 400 for invalid flow', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'No Nodes' })
      const flowId = createRes.body.flow.id

      const res = await request(app).post(`/api/builder/flows/${flowId}/transpile`)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app).post('/api/builder/flows/unknown-id/transpile')

      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Deploy
  // =========================================================================

  describe('POST /api/builder/flows/:id/deploy', () => {
    it('deploys a valid flow', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Deployable', nodes: [{ id: 'n1', type: 'listen' }] })
      const flowId = createRes.body.flow.id

      const res = await request(app)
        .post(`/api/builder/flows/${flowId}/deploy`)
        .send({ platform: 'x_spaces' })

      expect(res.status).toBe(201)
      expect(res.body.deployment).toBeDefined()
      expect(res.body.deployment.status).toBe('running')
      expect(res.body.deployment.platform).toBe('x_spaces')
      expect(res.body.deployment.flowId).toBe(flowId)
    })

    it('returns 400 for invalid flow', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Invalid' })
      const flowId = createRes.body.flow.id

      const res = await request(app)
        .post(`/api/builder/flows/${flowId}/deploy`)
        .send({ platform: 'x_spaces' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when platform is missing', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'NoPlatform', nodes: [{ id: 'n1' }] })
      const flowId = createRes.body.flow.id

      const res = await request(app)
        .post(`/api/builder/flows/${flowId}/deploy`)
        .send({})

      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows/unknown-id/deploy')
        .send({ platform: 'x_spaces' })

      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Preview
  // =========================================================================

  describe('POST /api/builder/flows/:id/preview', () => {
    it('creates a preview deployment', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Previewable', nodes: [{ id: 'n1' }] })
      const flowId = createRes.body.flow.id

      const res = await request(app)
        .post(`/api/builder/flows/${flowId}/preview`)
        .send({})

      expect(res.status).toBe(201)
      expect(res.body.deployment.status).toBe('preview')
      expect(res.body.deployment.expiresAt).toBeDefined()
      expect(res.body.previewUrl).toContain('/preview/')
    })

    it('returns 404 for unknown flow', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/api/builder/flows/unknown-id/preview')
        .send({})

      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // Deployments list / detail / stop
  // =========================================================================

  describe('GET /api/builder/deployments', () => {
    it('lists all deployments', async () => {
      const app = buildApp()

      // Create and deploy a flow
      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Listed', nodes: [{ id: 'n1' }] })
      const flowId = createRes.body.flow.id

      await request(app)
        .post(`/api/builder/flows/${flowId}/deploy`)
        .send({ platform: 'x_spaces' })

      const res = await request(app).get('/api/builder/deployments')

      expect(res.status).toBe(200)
      expect(res.body.deployments).toBeDefined()
      expect(res.body.deployments.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('GET /api/builder/deployments/:id', () => {
    it('returns a deployment by id', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Detailable', nodes: [{ id: 'n1' }] })
      const flowId = createRes.body.flow.id

      const deployRes = await request(app)
        .post(`/api/builder/flows/${flowId}/deploy`)
        .send({ platform: 'x_spaces' })
      const deployId = deployRes.body.deployment.id

      const res = await request(app).get(`/api/builder/deployments/${deployId}`)

      expect(res.status).toBe(200)
      expect(res.body.deployment.id).toBe(deployId)
    })

    it('returns 404 for unknown deployment', async () => {
      const app = buildApp()
      const res = await request(app).get('/api/builder/deployments/unknown-id')

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/builder/deployments/:id/stop', () => {
    it('stops a running deployment', async () => {
      const app = buildApp()

      const createRes = await request(app)
        .post('/api/builder/flows')
        .send({ name: 'Stoppable', nodes: [{ id: 'n1' }] })
      const flowId = createRes.body.flow.id

      const deployRes = await request(app)
        .post(`/api/builder/flows/${flowId}/deploy`)
        .send({ platform: 'x_spaces' })
      const deployId = deployRes.body.deployment.id

      const res = await request(app).post(`/api/builder/deployments/${deployId}/stop`)

      expect(res.status).toBe(200)
      expect(res.body.deployment.status).toBe('stopped')
    })

    it('returns 404 for unknown deployment', async () => {
      const app = buildApp()
      const res = await request(app).post('/api/builder/deployments/unknown-id/stop')

      expect(res.status).toBe(404)
    })
  })
})


