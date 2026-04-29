/**
 * Debug version: join X Space with screenshots at each stage.
 * Usage: node join-debug.mjs https://x.com/i/spaces/SPACE_ID
 */

import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env
try {
  const envContent = readFileSync(path.join(__dirname, '.env'), 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
} catch {}

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: node join-debug.mjs <space-url>')
  process.exit(1)
}

// Use the lower-level classes directly for more control
const {
  BrowserLifecycle,
  AudioPipeline,
} = await import('./packages/core/dist/index.js')

const browserLifecycle = new BrowserLifecycle(
  { headless: true },
  { token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 },
)

browserLifecycle.on('status', (s) => console.log(`[status] ${s}`))

const screenshotDir = path.join(__dirname, 'debug-screenshots')
import { mkdirSync } from 'fs'
mkdirSync(screenshotDir, { recursive: true })

async function screenshot(page, name) {
  const file = path.join(screenshotDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`[screenshot] ${file}`)
}

try {
  console.log('[1] Launching browser...')
  const dummyHandler = () => {}
  const page = await browserLifecycle.launch(dummyHandler)

  console.log('[2] Authenticating...')
  await browserLifecycle.authenticate()
  await screenshot(page, '01-authenticated')

  console.log('[3] Navigating to Space...')
  await page.goto(spaceUrl, { waitUntil: 'networkidle2', timeout: 45000 })
  await new Promise(r => setTimeout(r, 3000))
  await screenshot(page, '02-space-loaded')

  // Dump all buttons on the page
  const buttons = await page.evaluate(() => {
    return [...document.querySelectorAll('button, [role="button"]')]
      .map(b => ({
        tag: b.tagName,
        label: b.getAttribute('aria-label'),
        testid: b.getAttribute('data-testid'),
        text: (b.textContent || '').trim().slice(0, 60),
        classes: b.className?.slice(0, 80),
      }))
  })
  console.log('[buttons on page]', JSON.stringify(buttons, null, 2))

  // Try to find and click the join button
  console.log('[4] Looking for join button...')
  const joinBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')]
    const join = btns.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase()
      const text = (b.textContent || '').trim().toLowerCase()
      return label.includes('listen') || label.includes('join') || label.includes('tune in') ||
             text.includes('start listening') || text.includes('join') || text.includes('play')
    })
    if (join) {
      join.click()
      return { label: join.getAttribute('aria-label'), text: (join.textContent || '').trim().slice(0, 40) }
    }
    return null
  })
  console.log('[join button]', joinBtn)
  await new Promise(r => setTimeout(r, 5000))
  await screenshot(page, '03-after-join-click')

  // Dump buttons again after joining
  const buttons2 = await page.evaluate(() => {
    return [...document.querySelectorAll('button, [role="button"]')]
      .map(b => ({
        tag: b.tagName,
        label: b.getAttribute('aria-label'),
        testid: b.getAttribute('data-testid'),
        text: (b.textContent || '').trim().slice(0, 60),
      }))
  })
  console.log('[buttons after join]', JSON.stringify(buttons2, null, 2))

  // Look for request-to-speak or unmute
  console.log('[5] Looking for request-to-speak / unmute...')
  const speakBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')]
    const speak = btns.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase()
      const text = (b.textContent || '').trim().toLowerCase()
      return label.includes('request') || label.includes('speak') || label.includes('hand') ||
             label.includes('unmute') || label.includes('mute') || label.includes('microphone') ||
             text.includes('request') || text.includes('speak') || text.includes('hand')
    })
    if (speak) {
      return { label: speak.getAttribute('aria-label'), text: (speak.textContent || '').trim().slice(0, 40), tag: speak.tagName }
    }
    return null
  })
  console.log('[speak/unmute button]', speakBtn)

  if (speakBtn) {
    // Click it
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role="button"]')]
      const speak = btns.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase()
        return label.includes('request') || label.includes('speak') || label.includes('hand') ||
               label.includes('unmute')
      })
      if (speak) speak.click()
    })
    console.log('[clicked speak/unmute button]')
    await new Promise(r => setTimeout(r, 3000))
    await screenshot(page, '04-after-speak-click')

    // Check for confirmation dialog
    const buttons3 = await page.evaluate(() => {
      return [...document.querySelectorAll('button, [role="button"]')]
        .map(b => ({
          label: b.getAttribute('aria-label'),
          text: (b.textContent || '').trim().slice(0, 60),
        }))
    })
    console.log('[buttons after speak click]', JSON.stringify(buttons3, null, 2))
  }

  // Wait and take final screenshot
  await new Promise(r => setTimeout(r, 5000))
  await screenshot(page, '05-final-state')

  // Keep alive for 60s to observe
  console.log('[6] Keeping alive for 60s... Check the Space now.')
  await new Promise(r => setTimeout(r, 60000))
  await screenshot(page, '06-after-wait')

  await browserLifecycle.cleanup()
} catch (err) {
  console.error('[error]', err?.message || err)
  try {
    const page = browserLifecycle.getPage()
    if (page) await screenshot(page, 'error-state')
  } catch {}
  await browserLifecycle.cleanup().catch(() => {})
  process.exit(1)
}


