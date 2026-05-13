// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import fs from "fs"
import { execSync } from "child_process"
import type { Page } from "puppeteer"
import { audioLogger } from "../server/logger"

// Check if ffmpeg is available
let hasFFmpeg = false
try {
  execSync("which ffmpeg", { stdio: "ignore" })
  hasFFmpeg = true
} catch {
  audioLogger.warn("ffmpeg not found — MP3-to-WAV conversion will not work. Install with: sudo apt install ffmpeg")
}

/**
 * Inject audio hooks into the page BEFORE Space JS loads.
 * This overrides getUserMedia to return a controllable audio stream,
 * and hooks RTCPeerConnection to capture incoming Space audio.
 *
 * Note: The code inside evaluateOnNewDocument runs in the BROWSER context,
 * not in Node.js. We use type assertions for browser globals.
 */
async function injectAudioHooks(
  page: Page,
  onSpaceAudio: (pcmBase64: string, sampleRate: number) => void
): Promise<void> {
  await page.exposeFunction("__onSpaceAudio", (pcmBase64: string, sampleRate: number) => {
    onSpaceAudio(pcmBase64, sampleRate)
  })

  await page.exposeFunction("__audioLog", (msg: string) => {
    audioLogger.debug(msg)
  })

  // The function below runs entirely in the browser context.
  // TypeScript compiles it but it executes in Chromium's JS engine.
  await page.evaluateOnNewDocument(() => {
    const win = window as unknown as Record<string, unknown>
    const nav = navigator as Navigator

    // ===== AUDIO OUT: Override getUserMedia to return controlled stream =====
    const _origGetUserMedia = nav.mediaDevices.getUserMedia.bind(nav.mediaDevices)

    let audioCtx: AudioContext | null = null
    let destNode: MediaStreamAudioDestinationNode | null = null
    let controlledStream: MediaStream | null = null

    function getControlledStream(): MediaStream {
      if (controlledStream) return controlledStream
      audioCtx = new AudioContext({ sampleRate: 48000 })
      destNode = audioCtx.createMediaStreamDestination()

      const silence = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      gain.gain.value = 0
      silence.connect(gain)
      gain.connect(destNode)
      silence.start()

      controlledStream = destNode.stream

      controlledStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        Object.defineProperty(track, "enabled", {
          get: () => true,
          set: () => {},
          configurable: true,
        })
      })

      ;(win.__audioLog as (msg: string) => void)("Controlled audio stream created (48kHz)")
      return controlledStream
    }

    nav.mediaDevices.getUserMedia = async (
      constraints?: MediaStreamConstraints
    ): Promise<MediaStream> => {
      if (constraints && constraints.audio) {
        ;(win.__audioLog as (msg: string) => void)(
          "getUserMedia intercepted — returning controlled stream"
        )
        const stream = getControlledStream()
        if (constraints.video) {
          const realStream = await _origGetUserMedia({ video: constraints.video })
          realStream.getAudioTracks().forEach((t: MediaStreamTrack) => t.stop())
          stream.getVideoTracks().forEach((t: MediaStreamTrack) => stream.removeTrack(t))
          realStream.getVideoTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t))
        }
        return stream
      }
      return _origGetUserMedia(constraints)
    }

    win.__injectAudioChunk = (pcmFloat32Base64: string) => {
      if (!audioCtx || !destNode) {
        getControlledStream()
      }
      if (audioCtx!.state !== "running") {
        audioCtx!.resume().catch(() => {})
      }
      try {
        const raw = atob(pcmFloat32Base64)
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
        const float32 = new Float32Array(bytes.buffer)

        const buffer = audioCtx!.createBuffer(1, float32.length, 48000)
        buffer.getChannelData(0).set(float32)
        const source = audioCtx!.createBufferSource()
        source.buffer = buffer
        source.connect(destNode!)
        source.start()
      } catch (e) {
        ;(win.__audioLog as (msg: string) => void)(
          "Audio injection error: " + (e as Error).message
        )
      }
    }

    // ===== AUDIO IN: Hook RTCPeerConnection to capture incoming audio =====
    const _OrigRTC = window.RTCPeerConnection

    const HookedRTC = function (
      this: RTCPeerConnection,
      ...args: ConstructorParameters<typeof RTCPeerConnection>
    ) {
      const pc = new _OrigRTC(...args)
      ;(win.__audioLog as (msg: string) => void)("RTCPeerConnection created")

      const handleTrack = (event: RTCTrackEvent) => {
        ;(win.__audioLog as (msg: string) => void)(
          "track event: kind=" + event.track.kind + " id=" + event.track.id
        )
        if (event.track.kind === "audio") {
          ;(win.__audioLog as (msg: string) => void)(
            "Captured incoming audio track from Space"
          )
          captureAudioTrack(event.track)
        }
      }

      pc.addEventListener("track", handleTrack)

      let _ontrack: ((e: RTCTrackEvent) => void) | null = null
      Object.defineProperty(pc, "ontrack", {
        get: () => _ontrack,
        set: (fn: (e: RTCTrackEvent) => void) => {
          _ontrack = fn
          pc.addEventListener("track", (e: Event) => {
            handleTrack(e as RTCTrackEvent)
            if (fn) fn(e as RTCTrackEvent)
          })
        },
      })

      return pc
    } as unknown as typeof RTCPeerConnection

    HookedRTC.prototype = _OrigRTC.prototype
    Object.keys(_OrigRTC).forEach((k) => {
      ;(HookedRTC as unknown as Record<string, unknown>)[k] =
        (_OrigRTC as unknown as Record<string, unknown>)[k]
    })
    window.RTCPeerConnection = HookedRTC

    function captureAudioTrack(track: MediaStreamTrack) {
      try {
        const captureCtx = new AudioContext({ sampleRate: 16000 })
        captureCtx.resume().then(() => {
          ;(win.__audioLog as (msg: string) => void)(
            "Capture AudioContext state: " + captureCtx.state
          )
        })

        const source = captureCtx.createMediaStreamSource(new MediaStream([track]))
        const processor = captureCtx.createScriptProcessor(4096, 1, 1)
        let chunkCount = 0

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const pcm = e.inputBuffer.getChannelData(0)

          let maxVal = 0
          for (let i = 0; i < pcm.length; i++) {
            const abs = Math.abs(pcm[i])
            if (abs > maxVal) maxVal = abs
          }
          if (maxVal < 0.001) return

          const bytes = new Uint8Array(
            pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
          )
          let binary = ""
          const chunk = 8192
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
          }
          ;(win.__onSpaceAudio as (b64: string, sr: number) => void)(btoa(binary), 16000)
          chunkCount++

          if (chunkCount % 50 === 0) {
            ;(win.__audioLog as (msg: string) => void)(
              `Captured ${chunkCount} audio chunks from Space`
            )
          }
        }

        source.connect(processor)
        processor.connect(captureCtx.destination)
        ;(win.__audioLog as (msg: string) => void)("Audio capture pipeline started (16kHz)")
      } catch (e) {
        ;(win.__audioLog as (msg: string) => void)(
          "Audio capture error: " + (e as Error).message
        )
      }
    }
  })
}

/**
 * Convert MP3 buffer to PCM Float32 for injection into page.
 */
function mp3ToPcmFloat32(mp3Buffer: Buffer): Buffer {
  if (!hasFFmpeg) {
    throw new Error("ffmpeg required for MP3 to PCM conversion")
  }

  const tmpIn = "/tmp/agent-tts-input.mp3"
  const tmpOut = "/tmp/agent-tts-output.raw"

  fs.writeFileSync(tmpIn, mp3Buffer)
  execSync(
    `ffmpeg -y -i ${tmpIn} -f f32le -acodec pcm_f32le -ac 1 -ar 48000 ${tmpOut} 2>/dev/null`
  )

  const pcmBuffer = fs.readFileSync(tmpOut)

  try { fs.unlinkSync(tmpIn) } catch { /* ignore */ }
  try { fs.unlinkSync(tmpOut) } catch { /* ignore */ }

  return pcmBuffer
}

/**
 * Inject TTS audio (MP3 buffer) into the Space via the page's controlled stream.
 */
async function injectAudio(page: Page, mp3Buffer: Buffer): Promise<void> {
  const pcmBuffer = mp3ToPcmFloat32(mp3Buffer)
  const CHUNK_SIZE = 48000 * 4

  for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK_SIZE) {
    const chunk = pcmBuffer.subarray(offset, offset + CHUNK_SIZE)
    const base64 = chunk.toString("base64")

    await page.evaluate((b64: string) => {
      const injectFn = (window as unknown as Record<string, unknown>).__injectAudioChunk as
        | ((b: string) => void)
        | undefined
      if (injectFn) injectFn(b64)
    }, base64)

    const durationMs = (chunk.length / 4 / 48000) * 1000
    await new Promise<void>((r) => setTimeout(r, durationMs * 0.9))
  }
}

/**
 * Convert captured PCM Float32 chunks to a WAV buffer suitable for STT.
 */
function pcmChunksToWav(pcmChunks: Buffer[], sampleRate = 16000): Buffer {
  const pcmData = Buffer.concat(pcmChunks)

  const float32 = new Float32Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 4)
  const int16 = Buffer.alloc(float32.length * 2)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2)
  }

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

export { injectAudioHooks, injectAudio, mp3ToPcmFloat32, pcmChunksToWav }


