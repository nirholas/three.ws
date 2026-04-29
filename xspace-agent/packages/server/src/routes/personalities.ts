// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { Router } from 'express'
import { PersonalityLoader } from '../personalities'
import type { Personality } from '../personalities'
import { validate } from '../middleware/validation'
import { buildErrorResponse } from '../middleware/error-handler'
import { IdParamSchema } from '../schemas/common'
import { CreatePersonalityBodySchema, UpdatePersonalityBodySchema } from '../schemas/personalities'

export function createPersonalityRouter(loader: PersonalityLoader): Router {
  const router = Router()

  // GET /api/personalities — list all
  router.get('/', (_req, res) => {
    res.json(loader.list())
  })

  // GET /api/personalities/:id — get one
  router.get('/:id', validate(IdParamSchema, 'params'), (req, res) => {
    const personality = loader.get(req.params.id)
    if (!personality) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Personality not found', {
        requestId: (req as any).id,
      }))
      return
    }
    res.json(personality)
  })

  // POST /api/personalities — create new
  router.post('/', validate(CreatePersonalityBodySchema), (req, res) => {
    try {
      const created = loader.create((req as any).validated as Personality)
      res.status(201).json(created)
    } catch (err: any) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', err.message, {
        requestId: (req as any).id,
      }))
    }
  })

  // PUT /api/personalities/:id — update
  router.put('/:id', validate(IdParamSchema, 'params'), validate(UpdatePersonalityBodySchema), (req, res) => {
    try {
      const updated = loader.update(req.params.id, (req as any).validated)
      res.json(updated)
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400
      const code = status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'
      res.status(status).json(buildErrorResponse(code, err.message, {
        requestId: (req as any).id,
      }))
    }
  })

  // DELETE /api/personalities/:id — delete custom only
  router.delete('/:id', validate(IdParamSchema, 'params'), (req, res) => {
    try {
      loader.delete(req.params.id)
      res.json({ success: true })
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400
      const code = status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'
      res.status(status).json(buildErrorResponse(code, err.message, {
        requestId: (req as any).id,
      }))
    }
  })

  return router
}


