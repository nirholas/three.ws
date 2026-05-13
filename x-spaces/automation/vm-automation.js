// Runs on the swarm-agent VM under user 'agent'.
// Connects to two pre-launched Chrome instances (one for the agent voice loop, one for X)
// and drives them via CDP. Audio is routed via PULSE_SINK/PULSE_SOURCE env vars when Chrome is launched.

const puppeteer = require('puppeteer-core')

const AGENT_CDP = process.env.AGENT_CDP || 'http://127.0.0.1:9222'
const X_CDP = process.env.X_CDP || 'http://127.0.0.1:9223'
const SPACE_URL = process.argv[2]
if (!SPACE_URL || !SPACE_URL.includes('x.com/i/spaces/')) {
  console.error('usage: node vm-automation.js <https://x.com/i/spaces/...>')
  process.exit(1)
}

const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN
const X_CT0 = process.env.X_CT0
if (!X_AUTH_TOKEN || !X_CT0) {
  console.error('missing X_AUTH_TOKEN / X_CT0 in env')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getOrOpen(browser, url) {
  const pages = await browser.pages()
  for (const p of pages) {
    if (p.url() === url) return p
  }
  const target = pages.find((p) => p.url() === 'about:blank') || pages[0]
  if (target) {
    await target.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    return target
  }
  const p = await browser.newPage()
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  return p
}

async function clickByText(page, label, timeoutMs = 15_000) {
  const start = Date.now()
  const labelLower = label.toLowerCase()
  while (Date.now() - start < timeoutMs) {
    const handle = await page.evaluateHandle((needle) => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"]'))
      return buttons.find((b) => {
        const text = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase()
        const rect = b.getBoundingClientRect()
        return text.includes(needle) && rect.width > 4 && rect.height > 4
      })
    }, labelLower)
    const el = handle.asElement()
    if (el) {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
      await el.click({ delay: 30 }).catch(async () => {
        await el.evaluate((e) => e.click())
      })
      return true
    }
    await sleep(500)
  }
  return false
}

;(async () => {
  console.log('[automation] connecting to agent chrome at', AGENT_CDP)
  const agentBrowser = await puppeteer.connect({ browserURL: AGENT_CDP, defaultViewport: null })
  console.log('[automation] connecting to x chrome at', X_CDP)
  const xBrowser = await puppeteer.connect({ browserURL: X_CDP, defaultViewport: null })

  // 1. Set X cookies
  console.log('[automation] setting X cookies for @swarminged')
  const xPages = await xBrowser.pages()
  const xPage0 = xPages[0] || (await xBrowser.newPage())
  const xCtx = await xPage0.target().createCDPSession()
  await xCtx.send('Network.setCookies', {
    cookies: [
      { name: 'auth_token', value: X_AUTH_TOKEN, domain: '.x.com', path: '/', secure: true, httpOnly: true, expires: -1 },
      { name: 'ct0', value: X_CT0, domain: '.x.com', path: '/', secure: true, httpOnly: false, sameSite: 'Lax', expires: -1 },
    ],
  })

  // 2. Start the agent tab — load /agent1 and click Connect
  console.log('[automation] opening agent page')
  const agentPage = await getOrOpen(agentBrowser, 'http://localhost:3000/agent1')
  await sleep(2_000)
  console.log('[automation] clicking agent Connect button')
  const clickedAgent = await clickByText(agentPage, 'connect', 20_000)
  console.log('[automation] agent connect clicked:', clickedAgent)

  // 3. Navigate X tab to the Space
  console.log('[automation] navigating X tab to Space:', SPACE_URL)
  await xPage0.goto(SPACE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(4_000)

  // Verify we're not on /home (would mean cookie auth was rejected or same-account collision)
  const xUrl = xPage0.url()
  console.log('[automation] X tab url after nav:', xUrl)
  if (!xUrl.includes('/spaces/')) {
    console.log('[automation] X tab redirected away from Space — re-navigating once')
    await xPage0.goto(SPACE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(4_000)
  }

  // 4. Click "Start listening"
  console.log('[automation] looking for Start listening')
  const startedListening = await clickByText(xPage0, 'start listening', 20_000)
  console.log('[automation] start listening clicked:', startedListening)
  await sleep(3_000)

  // 5. Click "Request"  (covers "Request" / "Request to speak")
  console.log('[automation] looking for Request to speak')
  const requested = await clickByText(xPage0, 'request', 20_000)
  console.log('[automation] request to speak clicked:', requested)
  if (!requested) {
    console.log('[automation] WARN: request-to-speak button not found. Listing buttons:')
    const labels = await xPage0.evaluate(() =>
      Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, 30).map((b) => ({
        a: b.getAttribute('aria-label'),
        t: (b.textContent || '').trim().slice(0, 40),
      })),
    )
    console.log(JSON.stringify(labels, null, 2))
  }

  console.log('[automation] DONE. Now accept the speaker request on your phone as @doi.')
  console.log('[automation] Once accepted, the X tab will need ANOTHER click to unmute — re-run with --unmute or click manually.')

  // Don't disconnect — leave Chrome running with both tabs active
  agentBrowser.disconnect()
  xBrowser.disconnect()
})().catch((e) => {
  console.error('[automation] FATAL:', e)
  process.exit(1)
})
