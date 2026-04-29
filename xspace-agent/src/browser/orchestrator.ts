// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { EventEmitter } from "events"
import type { Browser, Page } from "puppeteer"
import * as browser from "./launcher.js"
import * as auth from "./auth.js"
import * as spaceUI from "./space-ui.js"
import * as audioBridge from "../audio/bridge.js"
import * as stt from "../server/providers/stt.js"
import { browserLogger } from "../server/logger"

export type XSpaceStatus =
  | "disconnected"
  | "launching"
  | "logging-in"
  | "logged-in"
  | "joining-space"
  | "in-space-as-listener"
  | "requesting-speaker"
  | "speaker-requested"
  | "speaker"
  | "speaking"
  | "speaking-in-space"
  | "left-space"
  | "space-ended"
  | "error"

class XSpacesEmitter extends EventEmitter {}
const emitter = new XSpacesEmitter()

let _browser: Browser | null = null
let _page: Page | null = null
let _state: XSpaceStatus = "disconnected"
let _spaceUrl: string | null = null
let _audioChunks: Buffer[] = []
let _silenceTimer: ReturnType<typeof setTimeout> | null = null
let _captureActive = false

const SILENCE_THRESHOLD_MS = 1500 // silence before sending audio to STT
const MIN_AUDIO_CHUNKS = 3 // minimum chunks to bother transcribing

function setState(s: XSpaceStatus): void {
  _state = s
  emitter.emit("status", s)
}

/**
 * Start the X Spaces module — launch browser and log in.
 */
async function start(): Promise<void> {
  if (_browser) {
    browserLogger.warn("already running")
    return
  }

  try {
    setState("launching")
    const result = await browser.launch()
    _browser = result.browser
    _page = result.page

    // Inject audio hooks before navigating to any X page
    await audioBridge.injectAudioHooks(_page, onSpaceAudioChunk)

    // Log in
    await auth.login(_page, emitter)
    setState("logged-in")

    browserLogger.info("ready — use joinSpace(url) to join a Space")

    // Auto-join if URL configured
    const autoJoinUrl = process.env.X_SPACE_URL
    if (autoJoinUrl) {
      browserLogger.info({ spaceUrl: autoJoinUrl }, "auto-joining Space")
      await joinSpace(autoJoinUrl)
    }
  } catch (err) {
    browserLogger.error({ err: (err as Error).message }, "start error")
    emitter.emit("error", (err as Error).message)
    await stop()
  }
}

/**
 * Join an X Space by URL.
 */
async function joinSpace(spaceUrl: string): Promise<void> {
  if (!_page) throw new Error("Browser not started. Call start() first.")
  if (
    _state === "joining-space" ||
    _state === "in-space-as-listener" ||
    _state === "requesting-speaker" ||
    _state === "speaker-requested" ||
    _state === "speaking-in-space"
  ) {
    browserLogger.warn("already joining or in a Space, ignoring duplicate join request")
    return
  }

  _spaceUrl = spaceUrl

  try {
    await spaceUI.joinSpace(_page, spaceUrl, emitter)

    // Try to become a speaker
    const speakerResult = await spaceUI.requestSpeaker(_page, emitter)

    if (speakerResult === "requested") {
      browserLogger.info("waiting for host to accept speaker request")
      await spaceUI.waitForSpeakerAccess(_page, emitter)
    } else if (speakerResult === "granted") {
      await spaceUI.unmute(_page, emitter)
    } else {
      browserLogger.info("no request button found — trying to unmute directly (open space)")
      await spaceUI.unmute(_page, emitter)
    }
    setState("speaking-in-space")

    _captureActive = true
    browserLogger.info({ spaceUrl }, "active in Space and ready to speak")

    startHealthCheck()
  } catch (err) {
    browserLogger.error({ err: (err as Error).message }, "join error")
    emitter.emit("error", (err as Error).message)
  }
}

/**
 * Leave the current Space.
 */
async function leaveSpace(): Promise<void> {
  if (!_page) return
  _captureActive = false

  try {
    await spaceUI.leaveSpace(_page, emitter)
    _spaceUrl = null
    setState("logged-in")
  } catch (err) {
    browserLogger.error({ err: (err as Error).message }, "leave error")
  }
}

/**
 * Send AI-generated TTS audio into the Space.
 */
async function speakInSpace(mp3Buffer: Buffer): Promise<void> {
  if (!_page || _state !== "speaking-in-space") {
    browserLogger.debug("not in a Space or not a speaker, skipping audio injection")
    return
  }

  _captureActive = false
  try {
    await audioBridge.injectAudio(_page, mp3Buffer)
  } catch (err) {
    browserLogger.error({ err: (err as Error).message }, "audio injection error")
    emitter.emit("error", "Audio injection failed: " + (err as Error).message)
  } finally {
    setTimeout(() => {
      _captureActive = true
    }, 1500)
  }
}

/**
 * Handle incoming audio chunks from Space (captured via RTCPeerConnection hook).
 */
function onSpaceAudioChunk(pcmBase64: string, sampleRate: number): void {
  if (!_captureActive) return

  const pcmBuffer = Buffer.from(pcmBase64, "base64")
  _audioChunks.push(pcmBuffer)

  if (_silenceTimer) clearTimeout(_silenceTimer)
  _silenceTimer = setTimeout(async () => {
    if (_audioChunks.length < MIN_AUDIO_CHUNKS) {
      _audioChunks = []
      return
    }

    const chunks = _audioChunks
    _audioChunks = []

    try {
      const wavBuffer = audioBridge.pcmChunksToWav(chunks, sampleRate || 16000)
      const { text } = await stt.transcribe(wavBuffer, "audio/wav")
      if (text && text.trim()) {
        browserLogger.debug({ textLength: text.length }, "Space speaker transcription")
        emitter.emit("transcription", { text: text.trim(), timestamp: Date.now() })
      }
    } catch (err) {
      browserLogger.error({ err: (err as Error).message }, "STT error")
    }
  }, SILENCE_THRESHOLD_MS)
}

/**
 * Periodic health check — detect if Space has ended.
 */
function startHealthCheck(): void {
  const interval = setInterval(async () => {
    if (!_page || _state === "disconnected") {
      clearInterval(interval)
      return
    }

    try {
      const state = await spaceUI.getSpaceState(_page)
      if (state.hasEnded) {
        browserLogger.info("Space has ended")
        _captureActive = false
        setState("space-ended")
        clearInterval(interval)
      }
    } catch {
      // Page may have navigated away
    }
  }, 10000)
}

/**
 * Stop everything — leave Space, close browser.
 */
async function stop(): Promise<void> {
  _captureActive = false
  if (_spaceUrl) await leaveSpace()
  if (_browser) {
    await browser.close(_browser)
    _browser = null
    _page = null
  }
  setState("disconnected")
}

interface XSpacesStatusInfo {
  status: XSpaceStatus
  spaceUrl: string | null
  isCapturing: boolean
}

function getStatus(): XSpacesStatusInfo {
  return {
    status: _state,
    spaceUrl: _spaceUrl,
    isCapturing: _captureActive,
  }
}

export { start, stop, joinSpace, leaveSpace, speakInSpace, getStatus, emitter }


