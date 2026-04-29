// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// DEPRECATED: Use packages/core/src/browser/ instead.
// Will be removed in v1.0.

const EventEmitter = require("events")
const browser = require("./browser")
const auth = require("./auth")
const spaceUI = require("./space-ui")
const audioBridge = require("./audio-bridge")
const stt = require("../providers/stt")

class XSpacesEmitter extends EventEmitter {}
const emitter = new XSpacesEmitter()

let _browser = null
let _page = null
let _state = "disconnected"
let _spaceUrl = null
let _audioChunks = []
let _silenceTimer = null
let _captureActive = false

const SILENCE_THRESHOLD_MS = 1500 // silence before sending audio to STT
const MIN_AUDIO_CHUNKS = 3        // minimum chunks to bother transcribing

function setState(s) {
  _state = s
  emitter.emit("status", s)
}

/**
 * Start the X Spaces module — launch browser and log in.
 */
async function start() {
  if (_browser) {
    console.log("[X-Spaces] Already running")
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

    console.log("[X-Spaces] Ready. Use joinSpace(url) to join a Space.")

    // Auto-join if URL configured
    const autoJoinUrl = process.env.X_SPACE_URL
    if (autoJoinUrl) {
      console.log("[X-Spaces] Auto-joining:", autoJoinUrl)
      await joinSpace(autoJoinUrl)
    }
  } catch (err) {
    console.error("[X-Spaces] Start error:", err.message)
    emitter.emit("error", err.message)
    await stop()
  }
}

/**
 * Join an X Space by URL.
 */
async function joinSpace(spaceUrl) {
  if (!_page) throw new Error("Browser not started. Call start() first.")
  if (_state === "joining-space" || _state === "in-space-as-listener" ||
      _state === "requesting-speaker" || _state === "speaker-requested" ||
      _state === "speaking-in-space") {
    console.log("[X-Spaces] Already joining or in a Space, ignoring duplicate join request")
    return
  }

  _spaceUrl = spaceUrl

  try {
    await spaceUI.joinSpace(_page, spaceUrl, emitter)

    // Try to become a speaker
    const speakerResult = await spaceUI.requestSpeaker(_page, emitter)

    if (speakerResult === "requested") {
      // waitForSpeakerAccess waits for host to accept AND unmutes immediately
      console.log("[X-Spaces] Waiting for host to accept speaker request...")
      await spaceUI.waitForSpeakerAccess(_page, emitter)
    } else if (speakerResult === "granted") {
      // Already a speaker — just unmute
      await spaceUI.unmute(_page, emitter)
    } else {
      // No request button — open space, unmute button may already be present
      console.log("[X-Spaces] No request button found — trying to unmute directly (open space)")
      await spaceUI.unmute(_page, emitter)
    }
    setState("speaking-in-space")

    _captureActive = true
    console.log("[X-Spaces] Active in Space and ready to speak!")

    // Start periodic health check
    startHealthCheck()
  } catch (err) {
    console.error("[X-Spaces] Join error:", err.message)
    emitter.emit("error", err.message)
  }
}

/**
 * Leave the current Space.
 */
async function leaveSpace() {
  if (!_page) return
  _captureActive = false

  try {
    await spaceUI.leaveSpace(_page, emitter)
    _spaceUrl = null
    setState("logged-in")
  } catch (err) {
    console.error("[X-Spaces] Leave error:", err.message)
  }
}

/**
 * Send AI-generated TTS audio into the Space.
 * @param {Buffer} mp3Buffer - MP3 audio from TTS
 */
async function speakInSpace(mp3Buffer) {
  if (!_page || _state !== "speaking-in-space") {
    console.log("[X-Spaces] Not in a Space or not a speaker, skipping audio injection")
    return
  }

  // Pause capture while speaking to prevent self-capture/echo loop
  _captureActive = false
  try {
    await audioBridge.injectAudio(_page, mp3Buffer)
  } catch (err) {
    console.error("[X-Spaces] Audio injection error:", err.message)
    emitter.emit("error", "Audio injection failed: " + err.message)
  } finally {
    // Resume capture after a short cooldown (let echo die down)
    setTimeout(() => { _captureActive = true }, 1500)
  }
}

/**
 * Handle incoming audio chunks from Space (captured via RTCPeerConnection hook).
 * Accumulates chunks with VAD, then sends to STT when silence detected.
 */
function onSpaceAudioChunk(pcmBase64, sampleRate) {
  if (!_captureActive) return

  const pcmBuffer = Buffer.from(pcmBase64, "base64")
  _audioChunks.push(pcmBuffer)

  // Reset silence timer
  if (_silenceTimer) clearTimeout(_silenceTimer)
  _silenceTimer = setTimeout(async () => {
    if (_audioChunks.length < MIN_AUDIO_CHUNKS) {
      _audioChunks = []
      return
    }

    const chunks = _audioChunks
    _audioChunks = []

    try {
      // Convert PCM chunks to WAV for STT
      const wavBuffer = audioBridge.pcmChunksToWav(chunks, sampleRate || 16000)

      // Transcribe
      const { text } = await stt.transcribe(wavBuffer, "audio/wav")
      if (text && text.trim()) {
        console.log("[X-Spaces] Space speaker said:", text)
        emitter.emit("transcription", { text: text.trim(), timestamp: Date.now() })
      }
    } catch (err) {
      console.error("[X-Spaces] STT error:", err.message)
    }
  }, SILENCE_THRESHOLD_MS)
}

/**
 * Periodic health check — detect if Space has ended.
 */
function startHealthCheck() {
  const interval = setInterval(async () => {
    if (!_page || _state === "disconnected") {
      clearInterval(interval)
      return
    }

    try {
      const state = await spaceUI.getSpaceState(_page)
      if (state.hasEnded) {
        console.log("[X-Spaces] Space has ended")
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
async function stop() {
  _captureActive = false
  if (_spaceUrl) await leaveSpace()
  if (_browser) {
    await browser.close(_browser)
    _browser = null
    _page = null
  }
  setState("disconnected")
}

function getStatus() {
  return {
    status: _state,
    spaceUrl: _spaceUrl,
    isCapturing: _captureActive
  }
}

module.exports = { start, stop, joinSpace, leaveSpace, speakInSpace, getStatus, emitter }


