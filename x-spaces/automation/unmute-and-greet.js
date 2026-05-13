// User has accepted speaker request on phone.
// Steps: navigate X tab back to the Space if drifted -> poll for unmute -> click ->
// then fire a response.create on the agent data channel so it greets in the Space.
const puppeteer = require('puppeteer-core')

const SPACE_URL = process.argv[2]
if (!SPACE_URL || !SPACE_URL.includes('x.com/i/spaces/')) {
  console.error('usage: node unmute-and-greet.js <https://x.com/i/spaces/...>')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const UNMUTE_NEEDLES = [
  'unmute',
  'turn on microphone',
  'start speaking',
  'turn on mic',
  'speak now',
]

async function findAndClick(page, needles, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await page.evaluate((needles) => {
      const all = Array.from(document.querySelectorAll('button, [role="button"]'))
      for (const b of all) {
        const text = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase()
        for (const n of needles) {
          if (text.includes(n)) {
            const rect = b.getBoundingClientRect()
            if (rect.width > 4 && rect.height > 4) {
              b.scrollIntoView({ block: 'center' })
              b.click()
              return { ok: true, n, label: text.slice(0, 80) }
            }
          }
        }
      }
      return { ok: false }
    }, needles)
    if (r.ok) return r
    await sleep(1500)
  }
  return { ok: false }
}

;(async () => {
  const xb = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
  let xPage = (await xb.pages()).find((p) => p.url().includes('/spaces/'))
  if (!xPage) {
    console.log('[unmute] X tab not on Space, re-navigating')
    xPage = (await xb.pages())[0]
    await xPage.goto(SPACE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await sleep(4_000)
  }
  console.log('[unmute] X tab url:', xPage.url())

  console.log('[unmute] polling for unmute / start-speaking button (90s)...')
  const r = await findAndClick(xPage, UNMUTE_NEEDLES, 90_000)
  if (!r.ok) {
    console.error('[unmute] could not find unmute button; dumping labels:')
    const labels = await xPage.evaluate(() =>
      Array.from(document.querySelectorAll('button, [role="button"]'))
        .slice(0, 30)
        .map((b) => ({ a: b.getAttribute('aria-label'), t: (b.textContent || '').trim().slice(0, 40) })),
    )
    console.log(JSON.stringify(labels, null, 2))
    xb.disconnect()
    process.exit(2)
  }
  console.log('[unmute] clicked:', r.n, '|', r.label)
  await sleep(1500)

  // Trigger greeting from agent
  const ab = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const agentPage = (await ab.pages()).find((p) => p.url().includes('/agent1'))
  if (!agentPage) {
    console.error('[unmute] no agent page')
    process.exit(3)
  }
  const sent = await agentPage.evaluate(() => {
    if (typeof dc !== 'undefined' && dc.readyState === 'open') {
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {
          instructions:
            "You are now broadcasting in the Space. Greet the room warmly in one or two sentences — say hi, mention you're co-hosting with doi to chat about three.ws, and invite anyone to jump in.",
        },
      }))
      return true
    }
    return false
  })
  console.log('[unmute] greet dispatched:', sent)
  ab.disconnect()
  xb.disconnect()
})().catch((e) => { console.error('[unmute] FATAL:', e); process.exit(1) })
