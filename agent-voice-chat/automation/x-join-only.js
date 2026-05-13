// X tab only: navigate to Space URL -> Start listening -> Request to speak.
// Does NOT touch the agent Chrome.
const puppeteer = require('puppeteer-core')

const SPACE_URL = process.argv[2]
if (!SPACE_URL || !SPACE_URL.includes('x.com/i/spaces/')) {
  console.error('usage: node x-join-only.js <https://x.com/i/spaces/...>')
  process.exit(1)
}

const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN
const X_CT0 = process.env.X_CT0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function click(page, needle, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  const n = needle.toLowerCase()
  while (Date.now() < deadline) {
    const r = await page.evaluate((n) => {
      const all = Array.from(document.querySelectorAll('button, [role="button"]'))
      for (const b of all) {
        const t = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase()
        if (t.includes(n)) {
          const r = b.getBoundingClientRect()
          if (r.width > 4 && r.height > 4) {
            b.scrollIntoView({ block: 'center' })
            b.click()
            return { ok: true, label: t.slice(0, 60) }
          }
        }
      }
      return { ok: false }
    }, n)
    if (r.ok) return r
    await sleep(800)
  }
  return { ok: false }
}

;(async () => {
  const xb = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
  const pages = await xb.pages()
  const xPage = pages[0] || (await xb.newPage())

  // Re-set cookies in case they expired or got cleared
  if (X_AUTH_TOKEN && X_CT0) {
    const cdp = await xPage.target().createCDPSession()
    await cdp.send('Network.setCookies', {
      cookies: [
        { name: 'auth_token', value: X_AUTH_TOKEN, domain: '.x.com', path: '/', secure: true, httpOnly: true, expires: -1 },
        { name: 'ct0', value: X_CT0, domain: '.x.com', path: '/', secure: true, httpOnly: false, sameSite: 'Lax', expires: -1 },
      ],
    })
  }

  console.log('[x] navigating to', SPACE_URL)
  await xPage.goto(SPACE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(4_000)
  console.log('[x] url after nav:', xPage.url())

  console.log('[x] clicking Start listening')
  console.log('[x] start listening:', await click(xPage, 'start listening', 20_000))
  await sleep(3_000)

  console.log('[x] clicking Request to speak')
  console.log('[x] request:', await click(xPage, 'request', 15_000))

  console.log('[x] done. Accept on your phone as @doi, then run unmute-and-greet.js.')
  xb.disconnect()
})().catch((e) => { console.error('[x] FATAL:', e); process.exit(1) })
