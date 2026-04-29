// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Queue Processor — Email Sending
// =============================================================================

import type { Job } from 'bullmq'
import type { EmailJob } from '../types'

/**
 * Sends a transactional email using the configured transport.
 *
 * In production this would delegate to an email service (SendGrid, SES, etc.).
 * Currently logs the email for development / integration testing.
 */
export async function emailProcessor(job: Job<EmailJob>): Promise<{ sent: boolean; messageId?: string }> {
  const { to, template, subject, data } = job.data

  // Validate recipient
  if (!to || !to.includes('@')) {
    throw new Error(`Invalid email recipient: ${to}`)
  }

  // Placeholder: in production, call an email transport here.
  // For now we log so the job completes successfully and the pipeline is exercised.
  const messageId = `msg_${Date.now()}_${job.id}`

  console.log(
    `[email-processor] Sending email: to=${to} template=${template} subject=${subject ?? '(default)'} messageId=${messageId}`,
  )

  // Simulate sending delay
  await new Promise((r) => setTimeout(r, 50))

  return { sent: true, messageId }
}


