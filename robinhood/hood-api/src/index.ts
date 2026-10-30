import 'dotenv/config'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { env } from './lib/env.js'
import { registerFirehoseSocket } from './routes/ws.js'

const app = createApp()
registerFirehoseSocket(app)

const wss = new WebSocketServer({ noServer: true })
const server = serve({ fetch: app.fetch, port: env.port, websocket: { server: wss } }, (info) => {
  console.log(`[hood-api] listening on :${info.port} — ${env.publicBaseUrl}`)
  console.log(`[hood-api] docs: /v1/openapi.json — health: /v1/health`)
})

function shutdown(signal: string) {
  console.log(`[hood-api] ${signal} received, shutting down`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
