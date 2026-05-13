// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Puppeteer browser launcher with stealth plugin and CDP connection support
// =============================================================================

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import type { Browser, Page } from 'puppeteer';
import type { BrowserConfig, BrowserMode } from '../types';
import { getLogger } from '../logger';
import { SecureCookieStore } from './secure-cookie-store';

puppeteer.use(StealthPlugin());

const DEFAULT_COOKIES_FILENAME = '.cookies.json';

// Generate a randomised, process-scoped temp path for the silent WAV file.
// Using os.tmpdir() + a random suffix avoids both predictable paths and
// clashes between concurrent processes.
const AUDIO_FILE = path.join(os.tmpdir(), `agent-audio-${crypto.randomUUID()}.wav`);

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a 1-second silent WAV file (48 kHz, 16-bit mono) for the fake
 * audio-capture device that Chromium uses in headless mode.
 */
function createSilentWav(): string {
  const sampleRate = 48000;
  const duration = 1; // 1 second
  const numSamples = sampleRate * duration;
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // data region is already zeroed (silence)

  fs.writeFileSync(AUDIO_FILE, buffer, { mode: 0o600 });
  return AUDIO_FILE;
}

// Clean up the temp WAV on process exit so it doesn't linger in /tmp.
function cleanupAudioFile(): void {
  try {
    if (fs.existsSync(AUDIO_FILE)) fs.unlinkSync(AUDIO_FILE);
  } catch {
    // Best-effort cleanup
  }
}
process.once('exit', cleanupAudioFile);
process.once('SIGINT', () => {
  cleanupAudioFile();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanupAudioFile();
  process.exit(143);
});

/**
 * Resolve the cookies file path. If a `cookiePath` is supplied it takes
 * precedence, otherwise falls back to `<userDataDir>/.cookies.json` or the
 * default location next to this module.
 */
function resolveCookiesPath(config?: BrowserConfig, cookiePath?: string): string {
  if (cookiePath) return cookiePath;
  if (config?.userDataDir) {
    return path.join(config.userDataDir, DEFAULT_COOKIES_FILENAME);
  }
  return path.join(__dirname, DEFAULT_COOKIES_FILENAME);
}

// ---------------------------------------------------------------------------
// BrowserManager: Unified API for managed and connect modes
// ---------------------------------------------------------------------------

export class BrowserManager {
  private _browser: Browser | null = null;
  private _page: Page | null = null;
  private config: BrowserConfig;

  constructor(config?: BrowserConfig) {
    this.config = config ?? {};
  }

  get isConnectMode(): boolean {
    return (this.config.mode ?? 'managed') === 'connect';
  }

  get browser(): Browser | null {
    return this._browser;
  }

  get page(): Page | null {
    return this._page;
  }

  async launch(): Promise<{ browser: Browser; page: Page }> {
    if (this._browser) {
      throw new Error('Browser already launched. Call close() first.');
    }

    if (this.isConnectMode) {
      return this.connectToExisting();
    } else {
      return this.launchManaged();
    }
  }

  private async launchManaged(): Promise<{ browser: Browser; page: Page }> {
    createSilentWav();

    const headless = this.config.headless ?? true;
    const extraArgs = this.config.args ?? [];

    const launchArgs: string[] = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${AUDIO_FILE}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--window-size=1280,720',
      ...extraArgs,
    ];

    if (this.config.proxy) {
      launchArgs.push(`--proxy-server=${this.config.proxy}`);
    }

    this._browser = await (puppeteer as any).launch({
      headless: headless ? 'new' : false,
      executablePath: this.config.executablePath,
      userDataDir: this.config.userDataDir,
      args: launchArgs,
      defaultViewport: { width: 1280, height: 720 },
    });

    this._page = await this._browser!.newPage();
    await this._page.setUserAgent(DEFAULT_USER_AGENT);

    // Restore cookies if they exist (supports encrypted and legacy plain-text)
    const cookiesPath = resolveCookiesPath(this.config);
    if (fs.existsSync(cookiesPath)) {
      try {
        const encryptionKey = process.env.COOKIE_ENCRYPTION_KEY;
        let cookies: unknown[];
        if (encryptionKey) {
          const store = new SecureCookieStore(encryptionKey);
          cookies = await store.load(cookiesPath);
        } else {
          cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
        }
        await this._page.setCookie(...(cookies as any[]));
        getLogger().info('[X-Spaces] Restored saved cookies');
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        getLogger().warn('[X-Spaces] Failed to restore cookies:', message);
      }
    }

    return { browser: this._browser!, page: this._page! };
  }

  private async connectToExisting(): Promise<{ browser: Browser; page: Page }> {
    const wsEndpoint = this.config.cdpEndpoint ?? (await this.discoverEndpoint());

    this._browser = await (puppeteer as any).connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null, // use browser's real viewport
    });

    const pages = await this._browser!.pages();
    this._page =
      pages.find(p => p.url().includes('x.com')) ??
      pages.find(p => p.url().includes('twitter.com')) ??
      pages[0];

    // If no X.com tab found, navigate current tab to home
    if (!this._page?.url().includes('x.com') && !this._page?.url().includes('twitter.com')) {
      await this._page?.goto('https://x.com/home', { waitUntil: 'networkidle2' });
    }

    await this.verifyAuthenticated();

    return { browser: this._browser!, page: this._page! };
  }

  private async discoverEndpoint(): Promise<string> {
    const host = this.config.cdpHost ?? 'localhost';
    const port = this.config.cdpPort ?? 9222;

    // Chrome exposes /json/version at the debug port
    const res = await fetch(`http://${host}:${port}/json/version`);
    if (!res.ok) {
      throw new Error(
        `Cannot connect to Chrome at ${host}:${port}. ` +
        `Launch Chrome with: google-chrome --remote-debugging-port=${port}`
      );
    }

    const data = (await res.json()) as { webSocketDebuggerUrl: string };
    return data.webSocketDebuggerUrl;
  }

  private async verifyAuthenticated(): Promise<void> {
    if (!this._page) throw new Error('Page not initialized');

    const isLoggedIn = await this._page.evaluate(() => {
      // Check for home timeline or app tab indicators
      return (
        document.querySelector('[data-testid="primaryColumn"]') !== null ||
        document.querySelector('[data-testid="AppTabBar_Home_Link"]') !== null
      );
    });

    if (!isLoggedIn) {
      throw new Error(
        'Chrome is connected but not logged into X.com. ' +
        'Please log in manually in your Chrome browser first.'
      );
    }
  }

  async close(): Promise<void> {
    if (this.isConnectMode) {
      // In connect mode, disconnect from the browser but don't close it
      // (the user's Chrome session remains open)
      await this._browser?.disconnect();
      getLogger().info('[X-Spaces] Disconnected from Chrome');
    } else {
      // In managed mode, close the browser instance
      await this._browser?.close();
      getLogger().info('[X-Spaces] Browser closed');
    }
    this._browser = null;
    this._page = null;
  }

  async healthCheck(): Promise<{
    connected: boolean;
    mode: BrowserMode;
    pageUrl: string;
  }> {
    try {
      const url = await this._page?.url();
      return {
        connected: true,
        mode: this.config.mode ?? 'managed',
        pageUrl: url ?? 'unknown',
      };
    } catch {
      return {
        connected: false,
        mode: this.config.mode ?? 'managed',
        pageUrl: 'disconnected',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Backward-compatibility exports (thin wrappers around BrowserManager)
// ---------------------------------------------------------------------------

/**
 * Launch a Puppeteer browser instance configured for X Spaces interaction.
 * Returns the `Browser` and a pre-configured `Page`.
 *
 * @deprecated Use `BrowserManager` class directly for more control.
 */
export async function launchBrowser(
  config?: BrowserConfig
): Promise<{ browser: Browser; page: Page }> {
  const manager = new BrowserManager(config);
  return manager.launch();
}

/**
 * Persist the current page cookies to disk.
 */
export async function saveCookies(
  page: Page,
  cookiePath?: string
): Promise<void> {
  const resolvedPath = cookiePath ?? path.join(__dirname, DEFAULT_COOKIES_FILENAME);
  const cookies = await page.cookies();
  const encryptionKey = process.env.COOKIE_ENCRYPTION_KEY;
  if (encryptionKey) {
    const store = new SecureCookieStore(encryptionKey);
    await store.save(cookies, resolvedPath);
  } else {
    fs.writeFileSync(resolvedPath, JSON.stringify(cookies, null, 2), { mode: 0o600 });
  }
  getLogger().info('[X-Spaces] Cookies saved');
}

/**
 * Close the browser instance gracefully.
 *
 * @deprecated Use `BrowserManager.close()` which handles both modes correctly.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  if (browser) {
    await browser.close();
    getLogger().info('[X-Spaces] Browser closed');
  }
}

export { AUDIO_FILE };


