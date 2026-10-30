import { upgradeWebSocket } from '@hono/node-server'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { verifySession } from '../lib/firehose-session.js'
import { subscribe, ALL_CHANNELS, type ChannelName } from '../services/firehose-hub.js'

/**
 * Registers `GET /v1/ws`, the metered firehose socket. The caller must pass
 * `websocket: { server }` to `serve()` so `@hono/node-server` can complete
 * the HTTP upgrade.
 */
export function registerFirehoseSocket(app: OpenAPIHono): void {
  app.get(
    '/v1/ws',
    upgradeWebSocket((c) => {
      const token = c.req.query('token')
      const check = verifySession(token)
      const channelsParam = c.req.query('channels')
      const wanted = new Set<ChannelName>(
        channelsParam
          ? (channelsParam.split(',').filter((ch): ch is ChannelName => (ALL_CHANNELS as string[]).includes(ch)) as ChannelName[])
          : ALL_CHANNELS,
      )

      let unsubscribe: (() => void) | null = null

      return {
        onOpen(_evt, ws) {
          if (!check.ok) {
            ws.send(JSON.stringify({ error: 'session_invalid', hint: check.reason }))
            ws.close(4401, 'invalid session')
            return
          }
          ws.send(
            JSON.stringify({
              type: 'connected',
              channels: [...wanted],
              note: 'One message per event; filter client-side on `channel` or use ?channels=firehose,ticks to subscribe narrower.',
            }),
          )
          unsubscribe = subscribe((event) => {
            if (!wanted.has(event.channel)) return
            try {
              ws.send(JSON.stringify(event))
            } catch {
              // socket closing mid-emit; onClose will clean up
            }
          })
        },
        onClose() {
          unsubscribe?.()
          unsubscribe = null
        },
        onError() {
          unsubscribe?.()
          unsubscribe = null
        },
      }
    }),
  )
}
