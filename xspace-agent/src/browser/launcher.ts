// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import path from "path"
import fs from "fs"
import type { Browser, Page } from "puppeteer"
import { browserLogger } from "../server/logger"

puppeteer.use(StealthPlugin())

const COOKIES_PATH = path.join(__dirname, "..", "..", "x-spaces", ".cookies.json")
const AUDIO_FILE = "/tmp/agent-audio.wav"

// Create a silent WAV file for fake mic input
function createSilentWav(): string {
  const sampleRate = 48000
  const duration = 1 // 1 second
  const numSamples = sampleRate * duration
  const dataSize = numSamples * 2 // 16-bit = 2 bytes per sample
  const headerSize = 44
  const buffer = Buffer.alloc(headerSize + dataSize)

  // WAV header
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16) // chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  // data is already zeros (silence)

  fs.writeFileSync(AUDIO_FILE, buffer)
  return AUDIO_FILE
}

async function launch(): Promise<{ browser: Browser; page: Page }> {
  createSilentWav()

  const browser = await puppeteer.launch({
    headless: "new" as unknown as boolean,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${AUDIO_FILE}`,
      "--autoplay-policy=no-user-gesture-required",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      "--window-size=1280,720",
    ],
    defaultViewport: { width: 1280, height: 720 },
  })

  const page = await browser.newPage()
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  )

  // Restore cookies if they exist
  if (fs.existsSync(COOKIES_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"))
      await page.setCookie(...cookies)
      browserLogger.info("restored saved cookies")
    } catch (e) {
      browserLogger.warn({ err: (e as Error).message }, "failed to restore cookies")
    }
  }

  return { browser, page }
}

async function saveCookies(page: Page): Promise<void> {
  const cookies = await page.cookies()
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2))
  browserLogger.debug("cookies saved")
}

async function close(browser: Browser): Promise<void> {
  if (browser) {
    await browser.close()
    browserLogger.info("browser closed")
  }
}

export { launch, saveCookies, close, AUDIO_FILE, COOKIES_PATH }


