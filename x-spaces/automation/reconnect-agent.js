// Reload the agent tab and click Connect again after fixing the API.
const puppeteer = require('puppeteer-core')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function clickByText(page, label, timeoutMs = 15_000) {
  const start = Date.now()
  const needle = label.toLowerCase()
  while (Date.now() - start < timeoutMs) {
    const handle = await page.evaluateHandle((needle) => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      return buttons.find((b) => {
        const text = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase()
        const rect = b.getBoundingClientRect()
        return text.includes(needle) && rect.width > 4 && rect.height > 4
      })
    }, needle)
    const el = handle.asElement()
    if (el) {
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
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await browser.pages()
  let agentPage = pages.find((p) => p.url().includes('/agent1')) || pages[0]
  console.log('[reconnect] reloading', agentPage.url())
  await agentPage.goto('http://localhost:3000/agent1', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await sleep(2_000)
  const clicked = await clickByText(agentPage, 'connect', 15_000)
  console.log('[reconnect] connect clicked:', clicked)
  await sleep(2_000)
  // Dump any error/status text from the page log
  const status = await agentPage.evaluate(() => document.body.innerText.slice(-1000))
  console.log('[reconnect] page tail:\n', status)
  browser.disconnect()
})().catch((e) => { console.error('FATAL:', e); process.exit(1) })
