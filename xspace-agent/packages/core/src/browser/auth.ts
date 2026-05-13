// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// X (Twitter) authentication strategies
// Cookie check -> token injection -> form login -> 2FA
// =============================================================================

import type { Page, ElementHandle } from 'puppeteer';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { AuthConfig } from '../types';
import { saveCookies } from './launcher';
import { SELECTORS } from './selectors';
import type { SelectorEngine } from './selector-engine';
import { getLogger } from '../logger';
import { AuthenticationError } from '../errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(): number {
  return 30 + Math.random() * 70;
}

/**
 * Click a button whose visible text contains `text`.
 */
async function clickButtonByText(page: Page, text: string): Promise<boolean> {
  const buttons = await page.$$('button[role="button"], [role="button"]');
  for (const btn of buttons) {
    const t = await page.evaluate(
      (el: Element) => el.textContent?.trim() || '',
      btn,
    );
    if (t.includes(text)) {
      await btn.click();
      return true;
    }
  }
  return false;
}

/**
 * Find an element using SelectorEngine when available, falling back to CSS.
 */
async function findWithEngine(
  page: Page,
  selectorName: string,
  cssSelector: string,
  engine?: SelectorEngine,
): Promise<ElementHandle | null> {
  if (engine) {
    try {
      const el = await engine.find(page, selectorName);
      if (el) return el;
    } catch { /* unknown name — fall through */ }
  }
  try {
    return await page.$(cssSelector);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoginOptions {
  selectorEngine?: SelectorEngine;
}

/**
 * Check whether the page is already authenticated by navigating to the
 * X home timeline and inspecting the resulting URL.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(SELECTORS.HOME_URL, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });
    const url = page.url();
    return url.includes('/home') && !url.includes('/login');
  } catch {
    return false;
  }
}

/**
 * Authenticate the browser session using the provided `AuthConfig`.
 *
 * Strategy order:
 *  1. Check if already logged in via saved cookies.
 *  2. Inject `auth_token` (and optionally `ct0`) cookies if supplied.
 *  3. Fall back to interactive form login (username + password).
 *  4. Handle 2FA if X prompts for it.
 */
export async function login(
  page: Page,
  auth: AuthConfig,
  emitter: EventEmitter,
  opts: LoginOptions = {},
): Promise<boolean> {
  const { selectorEngine } = opts;

  // ------------------------------------------------------------------
  // 1. Already logged in?
  // ------------------------------------------------------------------
  if (await isLoggedIn(page)) {
    getLogger().info('[X-Spaces] Already logged in via cookies');
    emitter.emit('status', 'logged-in');
    return true;
  }

  // ------------------------------------------------------------------
  // 2. Token-based login
  // ------------------------------------------------------------------
  if (auth.token) {
    getLogger().info('[X-Spaces] Logging in via auth_token cookie');
    emitter.emit('status', 'logging-in');

    const cookiesToSet: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      secure: boolean;
      httpOnly: boolean;
      sameSite: 'None' | 'Lax' | 'Strict';
    }> = [
      {
        name: 'auth_token',
        value: auth.token,
        domain: '.x.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
      },
    ];

    if (auth.ct0) {
      cookiesToSet.push({
        name: 'ct0',
        value: auth.ct0,
        domain: '.x.com',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: 'Lax',
      });
    }

    await page.setCookie(...cookiesToSet);

    const ok = await isLoggedIn(page);
    if (!ok) {
      // If username/password are available, fall back instead of throwing
      if (auth.username && auth.password) {
        getLogger().warn(
          '[X-Spaces] auth_token is invalid or expired — falling back to username/password login',
        );
      } else {
        throw new AuthenticationError(
          'auth_token is invalid or expired',
          'Get a fresh auth_token from your browser cookies (Application → Cookies → x.com → auth_token).',
        );
      }
    } else {
      getLogger().info('[X-Spaces] Login successful via auth_token');
      await saveCookies(page, auth.cookiePath);
      emitter.emit('status', 'logged-in');
      return true;
    }
  }

  // ------------------------------------------------------------------
  // 3. Form-based login
  // ------------------------------------------------------------------
  if (!auth.username || !auth.password) {
    throw new AuthenticationError(
      'No authentication credentials provided',
      'Set auth.token (recommended) or auth.username + auth.password in your config.',
    );
  }

  getLogger().info('[X-Spaces] Logging in via browser form as:', auth.username);
  emitter.emit('status', 'logging-in');

  await page.goto('https://x.com/i/flow/login', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });
  await delay(2000);

  // Step 1: Username
  const usernameInput = await findWithEngine(
    page,
    'username-input',
    SELECTORS.LOGIN_USERNAME_INPUT,
    selectorEngine,
  );
  if (!usernameInput) {
    await page.waitForSelector(SELECTORS.LOGIN_USERNAME_INPUT, { timeout: 15000 });
  }
  await delay(500);
  await page.type(SELECTORS.LOGIN_USERNAME_INPUT, auth.username, {
    delay: randomDelay(),
  });
  await delay(500);
  await clickButtonByText(page, 'Next');
  await delay(2000);

  // Step 2: Email/phone verification (if X asks for it)
  const verifyInput = await findWithEngine(
    page,
    'verify-email-input',
    SELECTORS.VERIFY_EMAIL_INPUT,
    selectorEngine,
  );
  if (verifyInput) {
    getLogger().info('[X-Spaces] Verification step — entering email/phone');
    const val = auth.email || auth.username;
    await verifyInput.type(val, { delay: randomDelay() });
    await delay(500);
    const verifyNext = await findWithEngine(
      page,
      'verify-next-button',
      SELECTORS.VERIFY_NEXT_BUTTON,
      selectorEngine,
    );
    if (verifyNext) await verifyNext.click();
    await delay(2000);
  }

  // Step 3: Password
  let passwordInput: ElementHandle | null;
  try {
    passwordInput = await findWithEngine(
      page,
      'password-input',
      SELECTORS.LOGIN_PASSWORD_INPUT,
      selectorEngine,
    );
    if (!passwordInput) {
      passwordInput = await page.waitForSelector(SELECTORS.LOGIN_PASSWORD_INPUT, {
        timeout: 15000,
      });
    }
  } catch {
    if (process.env.DEBUG) {
      const screenshotPath = path.join(os.tmpdir(), `x-login-step3-${crypto.randomUUID()}.png`);
      await page.screenshot({ path: screenshotPath });
      throw new AuthenticationError(
        'Password field not found — X may be blocking the login',
        `Try using auth.token instead of username/password. Debug screenshot: ${screenshotPath}`,
      );
    }
    throw new AuthenticationError(
      'Password field not found — X may be blocking the login',
      'Try using auth.token instead of username/password. Set DEBUG=1 for a screenshot.',
    );
  }

  await delay(500);
  if (passwordInput) {
    await passwordInput.type(auth.password, { delay: randomDelay() });
  }
  await delay(500);

  // Click "Log in"
  const loginBtn = await findWithEngine(
    page,
    'login-button',
    SELECTORS.LOGIN_SUBMIT_BUTTON,
    selectorEngine,
  );
  if (loginBtn) {
    await loginBtn.click();
  } else {
    await clickButtonByText(page, 'Log in');
  }
  await delay(3000);

  // ------------------------------------------------------------------
  // 4. Two-factor authentication
  // ------------------------------------------------------------------
  const twoFaInput = await findWithEngine(
    page,
    'verify-email-input',
    SELECTORS.VERIFY_EMAIL_INPUT,
    selectorEngine,
  );
  if (twoFaInput && page.url().includes('two_factor')) {
    getLogger().info('[X-Spaces] 2FA required');
    emitter.emit('2fa-required', {});

    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('2FA timeout (120s)')),
        120000,
      );
      emitter.once('2fa-code', (c: string) => {
        clearTimeout(timeout);
        resolve(c);
      });
    });

    await twoFaInput.type(code, { delay: 50 });
    const verifyBtn = await findWithEngine(
      page,
      'verify-next-button',
      SELECTORS.VERIFY_NEXT_BUTTON,
      selectorEngine,
    );
    if (verifyBtn) await verifyBtn.click();
    await delay(3000);
  }

  // ------------------------------------------------------------------
  // Final check
  // ------------------------------------------------------------------
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    if (process.env.DEBUG) {
      const screenshotPath = path.join(os.tmpdir(), `x-login-failed-${crypto.randomUUID()}.png`);
      await page.screenshot({ path: screenshotPath });
      throw new AuthenticationError(
        'Login failed — credentials may be invalid or X is blocking the login',
        `Debug screenshot saved at ${screenshotPath}. Consider using auth.token instead.`,
      );
    }
    throw new AuthenticationError(
      'Login failed — credentials may be invalid or X is blocking the login',
      'Consider using auth.token instead. Set DEBUG=1 for a screenshot.',
    );
  }

  getLogger().info('[X-Spaces] Login successful');
  await saveCookies(page, auth.cookiePath);
  emitter.emit('status', 'logged-in');
  return true;
}


