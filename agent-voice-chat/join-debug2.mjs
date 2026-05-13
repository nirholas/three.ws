/**
 * Debug: test if audio hooks injection prevents Space dock from loading.
 * Compares: with hooks vs without hooks.
 */
import { readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
try {
  const envContent = readFileSync(path.join(__dirname, '.env'), 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
} catch {}

const spaceUrl = process.argv[2]
if (!spaceUrl) { console.error('Usage: node join-debug2.mjs <url>'); process.exit(1) }

const { BrowserLifecycle } = await import('./packages/core/dist/index.js')
const dir = path.join(__dirname, 'debug-screenshots')
mkdirSync(dir, { recursive: true })

// Test 1: Launch WITH audio hooks (normal flow)
console.log('=== TEST: Normal flow with audio hooks ===')
const bl1 = new BrowserLifecycle(
  { headless: true },
  { token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 },
)
const page1 = await bl1.launch(() => {})
await bl1.authenticate()
console.log('[1] Navigating to Space...')
await page1.goto(spaceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 5000))
// Find and click join
const joinResult1 = await page1.evaluate(() => {
  const btns = [...document.querySelectorAll('button, [role="button"]')]
  const join = btns.find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('listen'))
  if (join) { join.click(); return 'clicked' }
  return 'not found'
})
console.log('[1] Join button:', joinResult1)
await new Promise(r => setTimeout(r, 8000))
const btns1 = await page1.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"]')]
    .map(b => b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 30))
    .filter(Boolean)
)
console.log('[1] Buttons WITH hooks:', btns1.filter(b =>
  b.toLowerCase().includes('request') || b.toLowerCase().includes('unmute') ||
  b.toLowerCase().includes('mute') || b.toLowerCase().includes('leave') ||
  b.toLowerCase().includes('collapse') || b.toLowerCase().includes('manage')
))
await page1.screenshot({ path: path.join(dir, 'test1-with-hooks.png') })
await bl1.cleanup()

// Test 2: Launch WITHOUT audio hooks (bypass)
console.log('\n=== TEST: Without audio hooks (raw Puppeteer) ===')
const puppeteer = (await import('puppeteer-extra')).default
const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
puppeteer.use(StealthPlugin())
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
const page2 = await browser.newPage()
// Set cookies
await page2.setCookie(
  { name: 'auth_token', value: process.env.X_AUTH_TOKEN, domain: '.x.com' },
  { name: 'ct0', value: process.env.X_CT0, domain: '.x.com' },
)
console.log('[2] Navigating to Space...')
await page2.goto(spaceUrl, { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise(r => setTimeout(r, 5000))
const joinResult2 = await page2.evaluate(() => {
  const btns = [...document.querySelectorAll('button, [role="button"]')]
  const join = btns.find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('listen'))
  if (join) { join.click(); return 'clicked' }
  return 'not found'
})
console.log('[2] Join button:', joinResult2)
await new Promise(r => setTimeout(r, 8000))
const btns2 = await page2.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"]')]
    .map(b => b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 30))
    .filter(Boolean)
)
console.log('[2] Buttons WITHOUT hooks:', btns2.filter(b =>
  b.toLowerCase().includes('request') || b.toLowerCase().includes('unmute') ||
  b.toLowerCase().includes('mute') || b.toLowerCase().includes('leave') ||
  b.toLowerCase().includes('collapse') || b.toLowerCase().includes('manage')
))
await page2.screenshot({ path: path.join(dir, 'test2-no-hooks.png') })
await browser.close()

console.log('\nDone. Compare debug-screenshots/test1-with-hooks.png and test2-no-hooks.png')


