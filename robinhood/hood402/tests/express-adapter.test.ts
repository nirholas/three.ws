import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { paywall } from '../src/server/index.js'
import { PAYMENT_HEADER } from '../src/challenge.js'

/**
 * Drives the Express adapter through a real Express 5 app over a real TCP
 * socket. Only the 402 challenge paths are exercised here (they need no chain
 * access); the paid path is covered by the e2e script and server.test.ts.
 */

const PAY_TO = '0x2222222222222222222222222222222222222222'

let server: Server
let base: string

beforeAll(async () => {
  const app = express()
  app.get(
    '/premium',
    paywall({
      price: '0.01',
      payTo: PAY_TO,
      network: 'robinhood-testnet',
      facilitator: 'http://127.0.0.1:9',
    }),
    (_req, res) => res.json({ secret: 'unlocked' }),
  )
  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('paywall on Express 5', () => {
  it('answers an unpaid request with a 402 challenge naming the absolute resource URL', async () => {
    const res = await fetch(`${base}/premium?x=1`)
    expect(res.status).toBe(402)
    const body = (await res.json()) as { accepts: Array<{ resource: string; payTo: string; network: string }> }
    expect(body.accepts[0]?.resource).toBe(`${base}/premium?x=1`)
    expect(body.accepts[0]?.payTo.toLowerCase()).toBe(PAY_TO)
    expect(body.accepts[0]?.network).toBe('robinhood-testnet')
  })

  it('rejects a malformed X-PAYMENT header with a 402 instead of reaching the route', async () => {
    const res = await fetch(`${base}/premium`, { headers: { [PAYMENT_HEADER]: 'not-a-payment' } })
    expect(res.status).toBe(402)
    expect(await res.text()).not.toContain('unlocked')
  })
})
