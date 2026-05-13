// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import type { Page, ElementHandle, JSHandle } from "puppeteer"
import type { EventEmitter } from "events"
import { selectors } from "./selectors.js"
import { spaceUILogger } from "../server/logger"

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Try CSS selector first, then fall back to text/aria-label matching
async function findElement(
  page: Page,
  cssSelector: string,
  textOptions: string[] = []
): Promise<ElementHandle<Element> | null> {
  // Try CSS selector
  try {
    const el = await page.$(cssSelector)
    if (el) return el
  } catch {
    // ignore
  }

  // Fall back to text/aria-label search
  if (textOptions.length > 0) {
    return findButton(page, textOptions)
  }
  return null
}

async function joinSpace(page: Page, spaceUrl: string, emitter: EventEmitter): Promise<boolean> {
  spaceUILogger.info({ spaceUrl }, "navigating to Space")
  emitter.emit("status", "joining-space")

  await page.goto(spaceUrl, { waitUntil: "domcontentloaded", timeout: 45000 })
  await delay(4000)

  // Check if Space has ended
  const ended = await page.evaluate(() => {
    return (
      document.body.innerText.includes("This Space has ended") ||
      document.body.innerText.includes("Space ended")
    )
  })
  if (ended) {
    throw new Error("This Space has already ended")
  }

  // Click Join/Listen button using data-testid first, then text fallback
  const joinBtn = await findElement(page, selectors.SPACE_JOIN_BUTTON, [
    "Start listening",
    "Listen",
    "Join",
    "Join this Space",
    "Tune in",
  ])
  if (joinBtn) {
    // Remove disabled attribute and force-click — X sets disabled on the button
    // even when the Space is live, so we bypass it via JS dispatch
    await page.evaluate((el) => {
      ;(el as HTMLElement).removeAttribute("disabled")
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }, joinBtn)
    spaceUILogger.debug("clicked join button (forced)")
    await delay(3000)
  } else {
    // Last resort: find any disabled join-like button and force-click it
    const forced: JSHandle = await page.evaluateHandle(() => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      return candidates.find((b) => {
        const label = (b.getAttribute("aria-label") || (b as HTMLElement).textContent || "").toLowerCase()
        return (
          label.includes("listen") ||
          label.includes("join") ||
          label.includes("tune in") ||
          label.includes("start listening")
        )
      })
    })
    const forcedEl = forced.asElement()
    if (forcedEl) {
      await page.evaluate((el) => {
        ;(el as HTMLElement).removeAttribute("disabled")
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      }, forcedEl)
      spaceUILogger.debug("force-clicked fallback join button")
      await delay(3000)
    } else {
      spaceUILogger.warn("no join button found, may already be in Space")
    }
  }

  emitter.emit("status", "in-space-as-listener")
  return true
}

// Returns "granted" if already a speaker, "requested" if request was sent, false if failed
async function requestSpeaker(
  page: Page,
  emitter: EventEmitter
): Promise<"granted" | "requested" | false> {
  spaceUILogger.info("requesting to speak")
  emitter.emit("status", "requesting-speaker")

  // Poll for up to 20s — the request-to-speak button may take time to render
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    // Check if already a speaker first (unmute button present)
    const micBtn = await findElement(page, selectors.SPACE_MIC_BUTTON)
    if (micBtn) {
      spaceUILogger.info("already a speaker (mic button found)")
      emitter.emit("status", "speaker")
      return "granted"
    }

    const speakBtn = await findElement(page, selectors.SPACE_REQUEST_SPEAK, [
      "Request to speak",
      "Request",
      "request to speak",
      "Raise hand",
      "Ask to speak",
    ])
    if (speakBtn) {
      // Use Puppeteer's trusted .click() instead of dispatchEvent (synthetic
      // events are not trusted and may be ignored by X's React handlers)
      try {
        await speakBtn.click()
      } catch {
        await page.evaluate((el) => {
          ;(el as HTMLElement).removeAttribute("disabled")
          ;(el as HTMLElement).click()
        }, speakBtn)
      }
      await delay(1000)

      // X Spaces may show a confirmation dialog after clicking — look for
      // "Send request" / "Request" / "Confirm" and click it
      const confirmDeadline = Date.now() + 5000
      while (Date.now() < confirmDeadline) {
        const confirmBtn = await page.evaluateHandle(() => {
          const btns = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"]'))
          return btns.find((b) => {
            const label = (b.getAttribute("aria-label") || "").toLowerCase()
            const text = (b.textContent || "").trim().toLowerCase()
            return (
              text === "send request" ||
              text === "request" ||
              text === "confirm" ||
              label === "send request" ||
              label.includes("send request") ||
              label.includes("confirm request")
            )
          })
        })
        const confirmEl = confirmBtn.asElement() as ElementHandle<Element> | null
        if (confirmEl) {
          try {
            await confirmEl.click()
          } catch {
            await page.evaluate((el) => (el as HTMLElement).click(), confirmEl)
          }
          spaceUILogger.info("clicked confirmation button in request dialog")
          await delay(1000)
          break
        }
        await delay(500)
      }

      spaceUILogger.info("speaker request sent")
      emitter.emit("status", "speaker-requested")
      return "requested"
    }

    await delay(2000)
  }

  // Dump visible buttons for debugging
  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .map((b) => ({
        label: b.getAttribute("aria-label"),
        text: (b as HTMLElement).textContent?.trim().slice(0, 40),
        testid: b.getAttribute("data-testid"),
      }))
      .filter((b) => b.label || b.text)
  )
  spaceUILogger.warn({ buttons: btns.slice(0, 20) }, "could not find request-to-speak button")
  return false
}

async function unmute(page: Page, emitter: EventEmitter): Promise<boolean> {
  spaceUILogger.info("unmuting...")

  // Poll up to 30s — Unmute button appears in same spot as Request to speak
  // once the host accepts the speaker request
  let unmuteBtn: ElementHandle<Element> | null = null
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    unmuteBtn = await page
      .evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
        return btns.find((b) => {
          const label = (b.getAttribute("aria-label") || "").toLowerCase()
          const text = ((b as HTMLElement).textContent || "").trim().toLowerCase()
          return (
            label === "unmute" ||
            label.includes("unmute") ||
            label.includes("turn on mic") ||
            label.includes("turn on microphone") ||
            label.includes("start speaking") ||
            label.includes("enable mic") ||
            text === "unmute"
          )
        })
      })
      .then((h) => h.asElement() as ElementHandle<Element> | null)
      .catch(() => null)

    if (unmuteBtn) break
    await delay(1000)
  }

  if (unmuteBtn) {
    await page.evaluate((el) => {
      ;(el as HTMLElement).removeAttribute("disabled")
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }, unmuteBtn)
    await delay(500)
    spaceUILogger.info("unmuted")
    emitter.emit("status", "speaking")
    return true
  }

  // Dump all button labels and screenshot for debugging
  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .map((b) => ({
        label: b.getAttribute("aria-label"),
        text: (b as HTMLElement).textContent?.trim().slice(0, 40),
        testid: b.getAttribute("data-testid"),
      }))
      .filter((b) => b.label || b.text)
  )
  spaceUILogger.warn({ buttons: btns.slice(0, 20) }, "could not find unmute button")
  await page.screenshot({ path: "/tmp/x-unmute-debug.png" })
  spaceUILogger.debug("screenshot saved to /tmp/x-unmute-debug.png")
  return false
}

async function leaveSpace(page: Page, emitter: EventEmitter): Promise<void> {
  spaceUILogger.info("leaving Space")

  const leaveBtn = await findElement(page, selectors.SPACE_LEAVE_BUTTON, [
    "Leave",
    "Leave quietly",
    "leave",
  ])
  if (leaveBtn) {
    await leaveBtn.click()
    await delay(1000)

    // Confirm leave if prompted
    const confirmBtn = await findButton(page, ["Leave", "Yes"])
    if (confirmBtn) await confirmBtn.click()
    await delay(1000)
  }

  emitter.emit("status", "left-space")
  spaceUILogger.info("left Space")
}

interface SpaceStateInfo {
  isLive: boolean
  hasEnded: boolean
  isSpeaker: boolean
  speakerCount: number
}

async function getSpaceState(page: Page): Promise<SpaceStateInfo> {
  return await page.evaluate(() => {
    const text = document.body.innerText
    const state = {
      isLive:
        text.includes("LIVE") ||
        !!document.querySelector('[data-testid="SpaceLiveIndicator"]'),
      hasEnded:
        text.includes("This Space has ended") || text.includes("Space ended"),
      isSpeaker: !!document.querySelector(
        'button[aria-label*="Mute"], button[aria-label*="unmute"], button[aria-label*="Unmute"]'
      ),
      speakerCount: document.querySelectorAll('[data-testid="SpaceSpeakerAvatar"]').length,
    }
    return state
  })
}

// Waits for host to accept speaker request, then immediately clicks Unmute
async function waitForSpeakerAccess(
  page: Page,
  emitter: EventEmitter,
  timeoutMs = 300000
): Promise<boolean> {
  spaceUILogger.info("waiting for host to accept speaker request")

  try {
    // Wait for the Unmute button to appear — this IS the signal that host accepted
    await page.waitForSelector('button[aria-label="Unmute"]', { timeout: timeoutMs })
  } catch {
    // Check if space ended
    const ended = await page.evaluate(
      () =>
        document.body.innerText.includes("This Space has ended") ||
        document.body.innerText.includes("Space ended")
    )
    if (ended) throw new Error("Space ended while waiting for speaker access")
    throw new Error("Timed out waiting for speaker access")
  }

  spaceUILogger.info("speaker access granted — unmuting")
  emitter.emit("status", "speaker")

  // Click the Unmute button that just appeared
  const unmuteBtn = await page.$('button[aria-label="Unmute"]')
  if (unmuteBtn) {
    await page.evaluate((el) => {
      ;(el as HTMLElement).removeAttribute("disabled")
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }, unmuteBtn)
    await delay(500)
    spaceUILogger.info("unmuted")
    emitter.emit("status", "speaking")
  }

  return true
}

// Helper: find a button by text content
async function findButton(
  page: Page,
  textOptions: string[]
): Promise<ElementHandle<Element> | null> {
  for (const text of textOptions) {
    const btn: JSHandle = await page.evaluateHandle((t: string) => {
      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"], div[role="button"]')
      )
      return buttons.find((b) => {
        const content = (b as HTMLElement).textContent?.trim() || ""
        const label = b.getAttribute("aria-label") || ""
        return (
          content.toLowerCase().includes(t.toLowerCase()) ||
          label.toLowerCase().includes(t.toLowerCase())
        )
      })
    }, text)

    const el = btn.asElement() as ElementHandle<Element> | null
    if (el) return el
  }
  return null
}

export { joinSpace, requestSpeaker, unmute, leaveSpace, getSpaceState, waitForSpeakerAccess }


