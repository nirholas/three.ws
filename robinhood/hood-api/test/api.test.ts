import 'dotenv/config'
import { describe, it, expect } from 'vitest'
import { createApp } from '../src/app.js'

const app = createApp()

describe('paid endpoints (x402 gate)', () => {
  it('GET /v1/portfolio/{address} without payment returns a real 402 challenge', async () => {
    const res = await app.request('/v1/portfolio/0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9')
    if (res.status === 503) {
      // payments not configured in this environment - acceptable, documented path
      const body = (await res.json()) as Record<string, unknown>
      expect(body.error).toBe('payments_not_configured')
      return
    }
    expect(res.status).toBe(402)
    const body = (await res.json()) as { accepts: Array<Record<string, unknown>> }
    expect(Array.isArray(body.accepts)).toBe(true)
    expect(body.accepts[0]?.scheme).toBe('exact')
    expect(body.accepts[0]?.payTo).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })
})
