// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Queue Processor — Webhook Delivery
// =============================================================================

import type { Job } from 'bullmq'
import axios from 'axios'
import { createHmac } from 'crypto'
import type { WebhookJob } from '../types'

/**
 * Delivers a webhook HTTP POST with HMAC-SHA256 signature verification.
 * Expects the receiving endpoint to return 2xx within 30s.
 */
export async function webhookProcessor(job: Job<WebhookJob>): Promise<{ statusCode: number; duration: number }> {
  const { url, payload, secret, deliveryId } = job.data

  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  const start = Date.now()

  const response = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Delivery': deliveryId,
      'X-Webhook-Attempt': String(job.attemptsMade + 1),
      'User-Agent': 'XSpace-Webhook/1.0',
    },
    timeout: 30_000,
    validateStatus: (status) => status >= 200 && status < 300,
  })

  return { statusCode: response.status, duration: Date.now() - start }
}


