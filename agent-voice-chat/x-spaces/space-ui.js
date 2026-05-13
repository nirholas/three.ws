// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// DEPRECATED: Use packages/core/src/browser/ instead.
// Will be removed in v1.0.

const selectors = require("./selectors")

function delay(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Try CSS selector first, then fall back to text/aria-label matching
async function findElement(page, cssSelector, textOptions = []) {
  // Try CSS selector
  try {
    const el = await page.$(cssSelector)
    if (el) return el
  } catch {}

  // Fall back to text/aria-label search
  if (textOptions.length > 0) {
    return findButton(page, textOptions)
  }
  return null
}

async function joinSpace(page, spaceUrl, emitter) {
  console.log("[X-Spaces] Navigating to Space:", spaceUrl)
  emitter.emit("status", "joining-space")

  await page.goto(spaceUrl, { waitUntil: "domcontentloaded", timeout: 45000 })
  await delay(4000)

  // Check if Space has ended
  const ended = await page.evaluate(() => {
    return document.body.innerText.includes("This Space has ended") ||
           document.body.innerText.includes("Space ended")
  })
  if (ended) {
    throw new Error("This Space has already ended")
  }

  // Click Join/Listen button using data-testid first, then text fallback
  const joinBtn = await findElement(
    page,
    selectors.SPACE_JOIN_BUTTON,
    ["Start listening", "Listen", "Join", "Join this Space", "Tune in"]
  )
  if (joinBtn) {
    // Remove disabled attribute and force-click — X sets disabled on the button
    // even when the Space is live, so we bypass it via JS dispatch
    await page.evaluate(el => {
      el.removeAttribute("disabled")
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }, joinBtn)
    console.log("[X-Spaces] Clicked join button (forced)")
    await delay(3000)
  } else {
    // Last resort: find any disabled join-like button and force-click it
    const forced = await page.evaluateHandle(() => {
      const candidates = [...document.querySelectorAll('button, [role="button"]')]
      return candidates.find(b => {
        const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase()
        return label.includes("listen") || label.includes("join") || label.includes("tune in") || label.includes("start listening")
      })
    })
    const forcedEl = forced.asElement()
    if (forcedEl) {
      await page.evaluate(el => {
        el.removeAttribute("disabled")
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      }, forcedEl)
      console.log("[X-Spaces] Force-clicked fallback join button")
      await delay(3000)
    } else {
      console.log("[X-Spaces] No join button found, may already be in Space")
    }
  }

  emitter.emit("status", "in-space-as-listener")
  return true
}

// Returns "granted" if already a speaker, "requested" if request was sent, false if failed
async function requestSpeaker(page, emitter) {
  console.log("[X-Spaces] Requesting to speak...")
  emitter.emit("status", "requesting-speaker")

  // Check if already a speaker first (unmute button present)
  const micBtn = await findElement(page, selectors.SPACE_MIC_BUTTON)
  if (micBtn) {
    console.log("[X-Spaces] Already a speaker (mic button found)")
    emitter.emit("status", "speaker")
    return "granted"
  }

  const speakBtn = await findElement(
    page,
    selectors.SPACE_REQUEST_SPEAK,
    ["Request to speak", "Request", "request to speak"]
  )
  if (speakBtn) {
    await speakBtn.click()
    console.log("[X-Spaces] Speaker request sent")
    emitter.emit("status", "speaker-requested")
    return "requested"
  }

  console.log("[X-Spaces] Could not find request-to-speak button")
  return false
}

async function unmute(page, emitter) {
  console.log("[X-Spaces] Unmuting...")

  // Poll up to 30s — Unmute button appears in same spot as Request to speak
  // once the host accepts the speaker request
  let unmuteBtn = null
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    unmuteBtn = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll('button[role="button"], [role="button"]')]
      return btns.find(b => {
        const label = (b.getAttribute("aria-label") || "").toLowerCase()
        const text = (b.textContent || "").trim().toLowerCase()
        return label === "unmute" || label.includes("turn on mic") ||
               text === "unmute" || label.includes("start speaking")
      })
    }).then(h => h.asElement()).catch(() => null)

    if (unmuteBtn) break
    await delay(1000)
  }

  if (unmuteBtn) {
    await page.evaluate(el => {
      el.removeAttribute("disabled")
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }, unmuteBtn)
    await delay(500)
    console.log("[X-Spaces] Unmuted")
    emitter.emit("status", "speaking")
    return true
  }

  // Dump all button labels and screenshot for debugging
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .map(b => ({ label: b.getAttribute("aria-label"), text: b.textContent?.trim().slice(0, 40), testid: b.getAttribute("data-testid") }))
      .filter(b => b.label || b.text)
  )
  console.log("[X-Spaces] Could not find unmute button. Buttons on page:", JSON.stringify(btns.slice(0, 20)))
  await page.screenshot({ path: "/tmp/x-unmute-debug.png" })
  console.log("[X-Spaces] Screenshot saved to /tmp/x-unmute-debug.png")
  return false
}

async function leaveSpace(page, emitter) {
  console.log("[X-Spaces] Leaving Space...")

  const leaveBtn = await findElement(
    page,
    selectors.SPACE_LEAVE_BUTTON,
    ["Leave", "Leave quietly", "leave"]
  )
  if (leaveBtn) {
    await leaveBtn.click()
    await delay(1000)

    // Confirm leave if prompted
    const confirmBtn = await findButton(page, ["Leave", "Yes"])
    if (confirmBtn) await confirmBtn.click()
    await delay(1000)
  }

  emitter.emit("status", "left-space")
  console.log("[X-Spaces] Left Space")
}

async function getSpaceState(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText
    const state = {
      isLive: text.includes("LIVE") || !!document.querySelector('[data-testid="SpaceLiveIndicator"]'),
      hasEnded: text.includes("This Space has ended") || text.includes("Space ended"),
      isSpeaker: !!document.querySelector('button[aria-label*="Mute"], button[aria-label*="unmute"], button[aria-label*="Unmute"]'),
      speakerCount: document.querySelectorAll('[data-testid="SpaceSpeakerAvatar"]').length
    }
    return state
  })
}

// Waits for host to accept speaker request, then immediately clicks Unmute
async function waitForSpeakerAccess(page, emitter, timeoutMs = 300000) {
  console.log("[X-Spaces] Waiting for host to accept speaker request...")

  try {
    // Wait for the Unmute button to appear — this IS the signal that host accepted
    await page.waitForSelector('button[aria-label="Unmute"]', { timeout: timeoutMs })
  } catch {
    // Check if space ended
    const ended = await page.evaluate(() =>
      document.body.innerText.includes("This Space has ended") || document.body.innerText.includes("Space ended")
    )
    if (ended) throw new Error("Space ended while waiting for speaker access")
    throw new Error("Timed out waiting for speaker access")
  }

  console.log("[X-Spaces] Speaker access granted — unmuting...")
  emitter.emit("status", "speaker")

  // Click the Unmute button that just appeared
  const unmuteBtn = await page.$('button[aria-label="Unmute"]')
  if (unmuteBtn) {
    await page.evaluate(el => {
      el.removeAttribute("disabled")
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    }, unmuteBtn)
    await delay(500)
    console.log("[X-Spaces] Unmuted")
    emitter.emit("status", "speaking")
  }

  return true
}

// Helper: find a button by text content
async function findButton(page, textOptions) {
  for (const text of textOptions) {
    const btn = await page.evaluateHandle((t) => {
      const buttons = [...document.querySelectorAll('button, [role="button"], div[role="button"]')]
      return buttons.find(b => {
        const content = b.textContent?.trim() || ""
        const label = b.getAttribute("aria-label") || ""
        return content.toLowerCase().includes(t.toLowerCase()) ||
               label.toLowerCase().includes(t.toLowerCase())
      })
    }, text)

    if (btn && btn.asElement()) return btn.asElement()
  }
  return null
}

// Helper: find the microphone/mute toggle button
async function findMicButton(page) {
  return await page.evaluateHandle(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')]
    return btns.find(b => {
      const label = (b.getAttribute("aria-label") || "").toLowerCase()
      return label.includes("mute") || label.includes("microphone") || label.includes("mic")
    })
  }).then(h => h.asElement())
}

module.exports = { joinSpace, requestSpeaker, unmute, leaveSpace, getSpaceState, waitForSpeakerAccess }


