// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// DEPRECATED: Use packages/core/src/browser/ instead.
// Will be removed in v1.0.

const fs = require("fs")
const { execSync } = require("child_process")
const { AUDIO_FILE } = require("./browser")

// Check if ffmpeg is available
let hasFFmpeg = false
try {
  execSync("which ffmpeg", { stdio: "ignore" })
  hasFFmpeg = true
} catch {
  console.warn("[X-Spaces] ffmpeg not found — MP3-to-WAV conversion will not work. Install with: sudo apt install ffmpeg")
}

/**
 * Inject audio hooks into the page BEFORE Space JS loads.
 * This overrides getUserMedia to return a controllable audio stream,
 * and hooks RTCPeerConnection to capture incoming Space audio.
 */
async function injectAudioHooks(page, onSpaceAudio) {
  // Expose Node function to receive captured Space audio
  await page.exposeFunction("__onSpaceAudio", (pcmBase64, sampleRate) => {
    onSpaceAudio(pcmBase64, sampleRate)
  })

  // Expose Node function for logging from page context
  await page.exposeFunction("__audioLog", (msg) => {
    console.log("[X-Spaces:AudioBridge]", msg)
  })

  // Inject hooks via evaluateOnNewDocument (runs before any page JS)
  await page.evaluateOnNewDocument(() => {
    // ===== AUDIO OUT: Override getUserMedia to return controlled stream =====
    const _origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)

    let audioCtx = null
    let destNode = null
    let controlledStream = null

    function getControlledStream() {
      if (controlledStream) return controlledStream
      audioCtx = new AudioContext({ sampleRate: 48000 })
      destNode = audioCtx.createMediaStreamDestination()

      // Create a silent oscillator to keep the stream alive
      const silence = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      gain.gain.value = 0
      silence.connect(gain)
      gain.connect(destNode)
      silence.start()

      controlledStream = destNode.stream

      // Force audio tracks to always stay enabled — prevent X from muting us
      controlledStream.getAudioTracks().forEach(track => {
        Object.defineProperty(track, 'enabled', {
          get: () => true,
          set: () => {},
          configurable: true
        })
      })

      window.__audioLog("Controlled audio stream created (48kHz)")
      return controlledStream
    }

    // Override getUserMedia
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        window.__audioLog("getUserMedia intercepted — returning controlled stream")
        const stream = getControlledStream()
        // If video is also requested, get real video and merge
        if (constraints.video) {
          const realStream = await _origGetUserMedia({ video: constraints.video })
          realStream.getAudioTracks().forEach(t => t.stop())
          stream.getVideoTracks().forEach(t => stream.removeTrack(t))
          realStream.getVideoTracks().forEach(t => stream.addTrack(t))
        }
        return stream
      }
      return _origGetUserMedia(constraints)
    }

    // Function to inject audio chunks from Node
    window.__injectAudioChunk = (pcmFloat32Base64) => {
      if (!audioCtx || !destNode) {
        getControlledStream()
      }
      // Resume AudioContext if suspended (can happen in headless Chrome)
      if (audioCtx.state !== 'running') {
        audioCtx.resume().catch(() => {})
      }
      try {
        const raw = atob(pcmFloat32Base64)
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
        const float32 = new Float32Array(bytes.buffer)

        const buffer = audioCtx.createBuffer(1, float32.length, 48000)
        buffer.getChannelData(0).set(float32)
        const source = audioCtx.createBufferSource()
        source.buffer = buffer
        source.connect(destNode)
        source.start()
      } catch (e) {
        window.__audioLog("Audio injection error: " + e.message)
      }
    }

    // ===== AUDIO IN: Hook RTCPeerConnection to capture incoming audio =====
    const _OrigRTC = window.RTCPeerConnection
    window.RTCPeerConnection = function (...args) {
      const pc = new _OrigRTC(...args)
      window.__audioLog("RTCPeerConnection created")

      const handleTrack = (event) => {
        window.__audioLog("track event: kind=" + event.track.kind + " id=" + event.track.id)
        if (event.track.kind === "audio") {
          window.__audioLog("Captured incoming audio track from Space")
          captureAudioTrack(event.track)
        }
      }

      pc.addEventListener("track", handleTrack)

      // Also hook via ontrack setter in case X assigns it directly
      let _ontrack = null
      Object.defineProperty(pc, "ontrack", {
        get: () => _ontrack,
        set: (fn) => {
          _ontrack = fn
          pc.addEventListener("track", (e) => {
            handleTrack(e)
            if (fn) fn(e)
          })
        }
      })

      return pc
    }
    // Copy static methods and prototype
    window.RTCPeerConnection.prototype = _OrigRTC.prototype
    Object.keys(_OrigRTC).forEach(k => {
      window.RTCPeerConnection[k] = _OrigRTC[k]
    })

    function captureAudioTrack(track) {
      try {
        const captureCtx = new AudioContext({ sampleRate: 16000 })
        // Resume immediately — headless Chrome may start contexts suspended
        captureCtx.resume().then(() => {
          window.__audioLog("Capture AudioContext state: " + captureCtx.state)
        })

        const source = captureCtx.createMediaStreamSource(new MediaStream([track]))
        const processor = captureCtx.createScriptProcessor(4096, 1, 1)
        let chunkCount = 0

        processor.onaudioprocess = (e) => {
          const pcm = e.inputBuffer.getChannelData(0)

          // Only send if there's actual audio (not silence)
          let maxVal = 0
          for (let i = 0; i < pcm.length; i++) {
            const abs = Math.abs(pcm[i])
            if (abs > maxVal) maxVal = abs
          }
          if (maxVal < 0.001) return // skip silence

          // Convert Float32Array to base64
          const bytes = new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength))
          let binary = ""
          const chunk = 8192
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
          }
          window.__onSpaceAudio(btoa(binary), 16000)
          chunkCount++

          if (chunkCount % 50 === 0) {
            window.__audioLog(`Captured ${chunkCount} audio chunks from Space`)
          }
        }

        source.connect(processor)
        processor.connect(captureCtx.destination)
        window.__audioLog("Audio capture pipeline started (16kHz)")
      } catch (e) {
        window.__audioLog("Audio capture error: " + e.message)
      }
    }
  })
}

/**
 * Convert MP3 buffer to PCM Float32 base64 for injection into page.
 * Uses ffmpeg to convert MP3 -> raw PCM float32 48kHz mono.
 */
function mp3ToPcmFloat32(mp3Buffer) {
  if (!hasFFmpeg) {
    throw new Error("ffmpeg required for MP3 to PCM conversion")
  }

  const tmpIn = "/tmp/agent-tts-input.mp3"
  const tmpOut = "/tmp/agent-tts-output.raw"

  fs.writeFileSync(tmpIn, mp3Buffer)
  execSync(`ffmpeg -y -i ${tmpIn} -f f32le -acodec pcm_f32le -ac 1 -ar 48000 ${tmpOut} 2>/dev/null`)

  const pcmBuffer = fs.readFileSync(tmpOut)

  // Clean up
  try { fs.unlinkSync(tmpIn) } catch {}
  try { fs.unlinkSync(tmpOut) } catch {}

  return pcmBuffer
}

/**
 * Inject TTS audio (MP3 buffer) into the Space via the page's controlled stream.
 * Chunks the audio to avoid page.evaluate size limits.
 */
async function injectAudio(page, mp3Buffer) {
  const pcmBuffer = mp3ToPcmFloat32(mp3Buffer)
  const CHUNK_SIZE = 48000 * 4 // 1 second of float32 at 48kHz

  for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK_SIZE) {
    const chunk = pcmBuffer.subarray(offset, offset + CHUNK_SIZE)
    const base64 = chunk.toString("base64")

    await page.evaluate((b64) => {
      if (window.__injectAudioChunk) {
        window.__injectAudioChunk(b64)
      }
    }, base64)

    // Wait roughly the duration of the chunk to pace playback
    const durationMs = (chunk.length / 4 / 48000) * 1000
    await new Promise(r => setTimeout(r, durationMs * 0.9))
  }
}

/**
 * Convert captured PCM Float32 chunks to a WAV buffer suitable for STT.
 * @param {Buffer[]} pcmChunks - Array of raw PCM Float32 buffers
 * @param {number} sampleRate - Sample rate (default 16000)
 */
function pcmChunksToWav(pcmChunks, sampleRate = 16000) {
  const totalLength = pcmChunks.reduce((sum, c) => sum + c.length, 0)
  const pcmData = Buffer.concat(pcmChunks)

  // Convert Float32 to Int16
  const float32 = new Float32Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 4)
  const int16 = Buffer.alloc(float32.length * 2)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, i * 2)
  }

  // WAV header
  const dataSize = int16.length
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, int16])
}

module.exports = { injectAudioHooks, injectAudio, mp3ToPcmFloat32, pcmChunksToWav }


