// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Example Plugin: Webhook Notifier
// Sends lifecycle and conversation events to an external webhook endpoint.
// =============================================================================

import type { Plugin, PluginContext } from '../../packages/core/src/plugins/types'
import type { TranscriptionEvent } from '../../packages/core/src/types'

export interface WebhookOptions {
  /** The webhook URL to POST events to */
  url: string
  /** Optional headers to include with each request */
  headers?: Record<string, string>
  /** Events to send (default: all) */
  events?: Array<'joined' | 'left' | 'transcription' | 'response' | 'error'>
}

export function createWebhookPlugin(options: WebhookOptions): Plugin {
  const { url, headers = {}, events } = options
  let context: PluginContext

  function shouldSend(event: string): boolean {
    return !events || events.includes(event as any)
  }

  async function send(payload: Record<string, unknown>): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ...payload, timestamp: Date.now() }),
      })
    } catch (err) {
      context.log('error', 'Webhook delivery failed', {
        event: payload.event,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    name: 'webhook-notifier',
    version: '1.0.0',
    description: 'Sends events to an external webhook',

    async onInit(ctx) {
      context = ctx
      context.log('info', `Webhook plugin initialized — sending to ${url}`)
    },

    async onJoined(spaceUrl: string): Promise<void> {
      if (shouldSend('joined')) {
        await send({ event: 'joined', spaceUrl })
      }
    },

    async onLeave(): Promise<void> {
      if (shouldSend('left')) {
        await send({ event: 'left' })
      }
    },

    async onTranscription(result: TranscriptionEvent): Promise<TranscriptionEvent> {
      if (shouldSend('transcription')) {
        await send({ event: 'transcription', speaker: result.speaker, text: result.text })
      }
      return result
    },

    async onResponse(text: string): Promise<string> {
      if (shouldSend('response')) {
        await send({ event: 'response', text })
      }
      return text
    },

    async onError(error: Error, errorContext: string): Promise<void> {
      if (shouldSend('error')) {
        await send({ event: 'error', error: error.message, context: errorContext })
      }
    },
  }
}


