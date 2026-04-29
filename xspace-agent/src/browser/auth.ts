// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

import type { Page, ElementHandle } from "puppeteer"
import type { EventEmitter } from "events"
import { saveCookies } from "./launcher.js"
import { authLogger } from "../server/logger"

const X_USERNAME = process.env.X_USERNAME
const X_PASSWORD = process.env.X_PASSWORD
const X_EMAIL = process.env.X_EMAIL || ""
const X_AUTH_TOKEN = process.env.X_AUTH_TOKEN || ""
const X_CT0 = process.env.X_CT0 || ""

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://x.com/home", { waitUntil: "networkidle2", timeout: 15000 })
    const url = page.url()
    return url.includes("/home") && !url.includes("/login")
  } catch {
    return false
  }
}

async function login(page: Page, emitter: EventEmitter): Promise<boolean> {
  // Check if already logged in via saved cookies
  if (await isLoggedIn(page)) {
    authLogger.info("already logged in via cookies")
    emitter.emit("status", "logged-in")
    return true
  }

  // Fast path: inject auth_token directly if provided in .env
  if (X_AUTH_TOKEN) {
    authLogger.info("logging in via auth token cookie")
    emitter.emit("status", "logging-in")
    const cookiesToSet: Array<{
      name: string
      value: string
      domain: string
      path: string
      secure: boolean
      httpOnly: boolean
      sameSite: "None" | "Lax"
    }> = [
      {
        name: "auth_token",
        value: X_AUTH_TOKEN,
        domain: ".x.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "None",
      },
    ]
    if (X_CT0) {
      cookiesToSet.push({
        name: "ct0",
        value: X_CT0,
        domain: ".x.com",
        path: "/",
        secure: false,
        httpOnly: false,
        sameSite: "Lax",
      })
    }
    await page.setCookie(...cookiesToSet)
    const ok = await isLoggedIn(page)
    if (!ok) {
      if (X_USERNAME && X_PASSWORD) {
        authLogger.warn("auth_token is invalid or expired — falling back to username/password login")
      } else {
        throw new Error("X_AUTH_TOKEN is invalid or expired — get a fresh one from your browser")
      }
    } else {
      authLogger.info("login successful via auth token")
      await saveCookies(page)
      emitter.emit("status", "logged-in")
      return true
    }
  }

  if (!X_USERNAME || !X_PASSWORD) {
    throw new Error("Set X_AUTH_TOKEN (recommended) or X_USERNAME + X_PASSWORD in .env")
  }

  authLogger.info("logging in via browser form")
  emitter.emit("status", "logging-in")

  await page.goto("https://x.com/i/flow/login", { waitUntil: "networkidle2", timeout: 30000 })
  await delay(2000)

  // Step 1: Username
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 })
  await delay(500)
  await page.type('input[autocomplete="username"]', X_USERNAME, { delay: randomDelay() })
  await delay(500)
  await clickButtonByText(page, "Next")
  await delay(2000)

  // Step 2: Email/phone verification (if X asks for it)
  const verifyInput = await page.$('input[data-testid="ocfEnterTextTextInput"]')
  if (verifyInput) {
    authLogger.debug("verification step — entering email/phone")
    const val = X_EMAIL || X_USERNAME
    await verifyInput.type(val, { delay: randomDelay() })
    await delay(500)
    const verifyNext = await page.$('[data-testid="ocfEnterTextNextButton"]')
    if (verifyNext) await verifyNext.click()
    await delay(2000)
  }

  // Step 3: Password
  let passwordInput: ElementHandle<Element> | null
  try {
    passwordInput = await page.waitForSelector('input[name="password"], input[type="password"]', {
      timeout: 15000,
    })
  } catch {
    await page.screenshot({ path: "/tmp/x-login-step3.png" })
    throw new Error(
      "Password field not found — X may be blocking the login. Try setting X_AUTH_TOKEN instead. Screenshot: /tmp/x-login-step3.png"
    )
  }
  await delay(500)
  if (passwordInput) {
    await passwordInput.type(X_PASSWORD, { delay: randomDelay() })
  }
  await delay(500)

  // Click Log in
  const loginBtn = await page.$('[data-testid="LoginForm_Login_Button"]')
  if (loginBtn) {
    await loginBtn.click()
  } else {
    await clickButtonByText(page, "Log in")
  }
  await delay(3000)

  // 2FA
  const twoFaInput = await page.$('input[data-testid="ocfEnterTextTextInput"]')
  if (twoFaInput && page.url().includes("two_factor")) {
    authLogger.info("2FA required")
    emitter.emit("2fa-required", {})
    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("2FA timeout (120s)")), 120000)
      emitter.once("2fa-code", (c: string) => {
        clearTimeout(timeout)
        resolve(c)
      })
    })
    await twoFaInput.type(code, { delay: 50 })
    const verifyBtn = await page.$('[data-testid="ocfEnterTextNextButton"]')
    if (verifyBtn) await verifyBtn.click()
    await delay(3000)
  }

  const loggedIn = await isLoggedIn(page)
  if (!loggedIn) {
    await page.screenshot({ path: "/tmp/x-login-failed.png" })
    throw new Error("Login failed — screenshot at /tmp/x-login-failed.png. Consider using X_AUTH_TOKEN instead.")
  }

  authLogger.info("login successful")
  await saveCookies(page)
  emitter.emit("status", "logged-in")
  return true
}

async function clickButtonByText(page: Page, text: string): Promise<boolean> {
  const buttons = await page.$$('button[role="button"], [role="button"]')
  for (const btn of buttons) {
    const t = await page.evaluate((el) => (el as HTMLElement).textContent?.trim() || "", btn)
    if (t.includes(text)) {
      await btn.click()
      return true
    }
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function randomDelay(): number {
  return 30 + Math.random() * 70
}

export { login, isLoggedIn }


