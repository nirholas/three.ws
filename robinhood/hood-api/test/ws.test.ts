import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serve } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import type { AddressInfo } from 'node:net'
import type { ServerType } from '@hono/node-server'
import { createApp } from '../src/app.js'
import { registerFirehoseSocket } from '../src/routes/ws.js'
import { mintSession } from '../src/lib/firehose-session.js'

/**
 * Real WebSocket round trips against a real listening @hono/node-server. The
 * firehose upgrade route is the only thing that depends on node-server's
 * WebSocket adapter, so this guards the node-server 2 migration (which
 * replaced @hono/node-ws).
 */

let server: ServerType
let port: number

beforeAll(async () => {
  const app = createApp()
  registerFirehoseSocket(app)
  const wss = new WebSocketServer({ noServer: true })
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', websocket: { server: wss } }, (info: AddressInfo) => {
      port = info.port
      resolve()
    })
  })
})

afterAll(() => {
  server.close()
})

function collect(url: string, until: (msgs: string[]) => boolean) {
  return new Promise<{ messages: string[]; closeCode: number | null; ws: WebSocket }>((resolve, reject) => {
    const ws = new WebSocket(url)
    const messages: string[] = []
    let closeCode: number | null = null
    const done = () => resolve({ messages, closeCode, ws })
    ws.on('message', (m) => {
      messages.push(m.toString())
      if (until(messages)) done()
    })
    ws.on('close', (code) => {
      closeCode = code
      done()
    })
    ws.on('error', reject)
  })
}

describe('GET /v1/ws', () => {
  it('rejects a missing session token with an error frame and close code 4401', async () => {
    const { messages, closeCode } = await collect(`ws://127.0.0.1:${port}/v1/ws`, () => false)
    expect(JSON.parse(messages[0]!)).toMatchObject({ error: 'session_invalid' })
    expect(closeCode).toBe(4401)
  })

  it('accepts a minted session and announces the subscribed channels', async () => {
    const { token } = mintSession()
    const { messages, ws } = await collect(`ws://127.0.0.1:${port}/v1/ws?token=${token}`, (m) => m.length >= 1)
    expect(JSON.parse(messages[0]!)).toMatchObject({ type: 'connected' })
    ws.close()
  })
})
