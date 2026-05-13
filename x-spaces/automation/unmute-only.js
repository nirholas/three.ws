// Finds and clicks the unmute/start-speaking button in the X Space tab.
const puppeteer = require('puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const NEEDLES = ['unmute', 'turn on microphone', 'start speaking', 'turn on mic', 'speak now']

;(async () => {
  const xb = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
  const xPage = (await xb.pages()).find((p) => p.url().includes('/spaces/')) || (await xb.pages())[0]
  console.log('[unmute] url:', xPage.url())

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const r = await xPage.evaluate((needles) => {
      const all = Array.from(document.querySelectorAll('button, [role="button"]'))
      for (const b of all) {
        const t = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase()
        for (const n of needles) {
          if (t.includes(n)) {
            const rect = b.getBoundingClientRect()
            if (rect.width > 4 && rect.height > 4) {
              b.scrollIntoView({ block: 'center' })
              b.click()
              return { ok: true, n, label: t.slice(0, 80) }
            }
          }
        }
      }
      return { ok: false }
    }, NEEDLES)
    if (r.ok) { console.log('[unmute] clicked:', r.n, '|', r.label); xb.disconnect(); return }
    await sleep(1500)
  }
  console.log('[unmute] not found; dumping labels:')
  const labels = await xPage.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .slice(0, 30)
      .map((b) => ({ a: b.getAttribute('aria-label'), t: (b.textContent || '').trim().slice(0, 40) })),
  )
  console.log(JSON.stringify(labels, null, 2))
  xb.disconnect()
})().catch((e) => { console.error('[unmute] FATAL:', e); process.exit(1) })
