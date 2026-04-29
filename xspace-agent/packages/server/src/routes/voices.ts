// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Voice Cloning & Custom TTS — API Routes
// =============================================================================

/// <reference types="multer" />
import { Router } from 'express'
import multer from 'multer'
import type { VoiceService } from 'xspace-agent/dist/voice'
import { validate } from '../middleware/validation'
import { buildErrorResponse } from '../middleware/error-handler'
import { IdParamSchema } from '../schemas/common'
import {
  CloneVoiceBodySchema,
  DesignVoiceBodySchema,
  UpdateVoiceBodySchema,
  PreviewVoiceBodySchema,
  AssignVoiceParamsSchema,
  PublishVoiceBodySchema,
} from '../schemas/voices'

// Multer config for audio uploads: max 50MB, audio files only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/x-wav', 'audio/wave']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}. Use WAV or MP3.`))
    }
  },
})

/**
 * Creates Express routes for voice cloning and custom TTS management.
 *
 * Endpoints:
 * - POST   /voices/clone        — Clone voice from audio samples
 * - POST   /voices/design       — Design voice from text description
 * - GET    /voices              — List org voices
 * - GET    /voices/:id          — Get voice details
 * - PATCH  /voices/:id          — Update voice settings
 * - DELETE /voices/:id          — Delete voice
 * - POST   /voices/:id/preview  — Generate preview audio
 * - POST   /voices/:id/assign/:agentId — Assign voice to agent
 * - GET    /voices/library      — Browse marketplace voices
 * - POST   /voices/:id/publish  — Publish to marketplace
 */
export function createVoiceRoutes(voiceService: VoiceService): Router {
  const router = Router()

  // Helper: extract org ID from request (auth middleware sets this)
  function getOrgId(req: any): string {
    return req.orgId ?? req.headers['x-org-id'] ?? 'default'
  }

  // POST /voices/clone — Create cloned voice from audio samples
  router.post(
    '/clone',
    upload.array('samples', 20) as any,
    validate(CloneVoiceBodySchema),
    async (req, res) => {
      try {
        const files = req.files as Express.Multer.File[]
        if (!files || files.length === 0) {
          res.status(400).json(
            buildErrorResponse('VALIDATION_ERROR', 'At least one audio sample is required', {
              requestId: (req as any).id,
            }),
          )
          return
        }

        const body = (req as any).validated as {
          name: string
          consent: {
            consentType: 'self' | 'authorized' | 'synthetic'
            consentDocument?: string
            agreedToTerms: true
          }
        }

        const samples = files.map((file) => ({
          audioBuffer: file.buffer,
          format: (file.mimetype.includes('wav') ? 'wav' : 'mp3') as 'wav' | 'mp3',
          durationSeconds: estimateAudioDuration(file.buffer, file.mimetype),
          transcript: '', // Transcript can be provided separately
        }))

        const voice = await voiceService.cloneVoice(
          getOrgId(req),
          samples,
          body.name,
          {
            consentType: body.consent.consentType,
            consentDocument: body.consent.consentDocument,
            agreedToTerms: body.consent.agreedToTerms,
            ipAddress: req.ip ?? req.socket.remoteAddress ?? 'unknown',
          },
        )

        res.status(201).json(voice)
      } catch (err: any) {
        res.status(400).json(
          buildErrorResponse('VOICE_CLONE_ERROR', err.message, {
            requestId: (req as any).id,
          }),
        )
      }
    },
  )

  // POST /voices/design — Create voice from text description
  router.post('/design', validate(DesignVoiceBodySchema), async (req, res) => {
    try {
      const params = (req as any).validated
      const voice = await voiceService.designVoice(getOrgId(req), params)
      res.status(201).json(voice)
    } catch (err: any) {
      res.status(400).json(
        buildErrorResponse('VOICE_DESIGN_ERROR', err.message, {
          requestId: (req as any).id,
        }),
      )
    }
  })

  // GET /voices — List all voices for the org
  router.get('/', (req, res) => {
    const voices = voiceService.listVoices(getOrgId(req))
    res.json(voices)
  })

  // GET /voices/library — Browse marketplace voices
  router.get('/library', (_req, res) => {
    const voices = voiceService.listMarketplaceVoices()
    res.json(voices)
  })

  // GET /voices/:id — Get voice details
  router.get('/:id', validate(IdParamSchema, 'params'), (req, res) => {
    const voice = voiceService.getVoice(req.params.id)
    if (!voice) {
      res.status(404).json(
        buildErrorResponse('NOT_FOUND', 'Voice not found', {
          requestId: (req as any).id,
        }),
      )
      return
    }
    res.json(voice)
  })

  // PATCH /voices/:id — Update voice settings
  router.patch(
    '/:id',
    validate(IdParamSchema, 'params'),
    validate(UpdateVoiceBodySchema),
    async (req, res) => {
      try {
        const updates = (req as any).validated
        const voice = await voiceService.updateVoice(getOrgId(req), req.params.id, updates)
        res.json(voice)
      } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400
        const code = status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'
        res.status(status).json(
          buildErrorResponse(code, err.message, { requestId: (req as any).id }),
        )
      }
    },
  )

  // DELETE /voices/:id — Delete custom voice
  router.delete('/:id', validate(IdParamSchema, 'params'), async (req, res) => {
    try {
      await voiceService.deleteVoice(getOrgId(req), req.params.id)
      res.json({ success: true })
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400
      const code = status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'
      res.status(status).json(
        buildErrorResponse(code, err.message, { requestId: (req as any).id }),
      )
    }
  })

  // POST /voices/:id/preview — Generate preview audio
  router.post(
    '/:id/preview',
    validate(IdParamSchema, 'params'),
    validate(PreviewVoiceBodySchema),
    async (req, res) => {
      try {
        const { text } = (req as any).validated as { text: string }
        const preview = await voiceService.previewVoice(req.params.id, text)
        res.set('Content-Type', 'audio/mpeg')
        res.set('Content-Length', String(preview.audioBuffer.length))
        res.send(preview.audioBuffer)
      } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 500
        res.status(status).json(
          buildErrorResponse(
            status === 404 ? 'NOT_FOUND' : 'PREVIEW_ERROR',
            err.message,
            { requestId: (req as any).id },
          ),
        )
      }
    },
  )

  // POST /voices/:id/assign/:agentId — Assign voice to agent
  router.post(
    '/:id/assign/:agentId',
    validate(AssignVoiceParamsSchema, 'params'),
    (req, res) => {
      const voice = voiceService.getVoice(req.params.id)
      if (!voice) {
        res.status(404).json(
          buildErrorResponse('NOT_FOUND', 'Voice not found', {
            requestId: (req as any).id,
          }),
        )
        return
      }

      // Return the provider voice ID for the caller to use in TTS config
      res.json({
        success: true,
        voiceId: voice.providerVoiceId,
        agentId: req.params.agentId,
        provider: voice.provider,
      })
    },
  )

  // POST /voices/:id/publish — Publish to marketplace
  router.post(
    '/:id/publish',
    validate(IdParamSchema, 'params'),
    validate(PublishVoiceBodySchema),
    async (req, res) => {
      try {
        const listing = (req as any).validated
        await voiceService.publishToMarketplace(getOrgId(req), req.params.id, listing)
        res.json({ success: true })
      } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400
        res.status(status).json(
          buildErrorResponse(
            status === 404 ? 'NOT_FOUND' : 'PUBLISH_ERROR',
            err.message,
            { requestId: (req as any).id },
          ),
        )
      }
    },
  )

  return router
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rough audio duration estimate from buffer size and MIME type.
 * WAV: raw PCM at 16kHz mono 16-bit = 32KB/s
 * MP3: typical 128kbps = 16KB/s
 */
function estimateAudioDuration(buffer: Buffer, mimeType: string): number {
  const bytesPerSecond = mimeType.includes('wav') ? 32000 : 16000
  return buffer.length / bytesPerSecond
}


