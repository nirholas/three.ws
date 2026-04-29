// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import type { AgentCommon } from "../core"

export function initSocketProvider(agent: AgentCommon): void {
  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []
  let playbackContext: AudioContext | null = null
  const playbackQueue: AudioBuffer[] = []
  let isPlaying = false

  agent.socket.on(
    "ttsAudio",
    async ({ agentId, audio }: { agentId: number; audio: string; format: string }) => {
      if (agentId !== agent.AGENT_ID) return
      try {
        if (!playbackContext) {
          playbackContext = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        }
        const audioData = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))
        const audioBuffer = await playbackContext.decodeAudioData(audioData.buffer.slice(0) as ArrayBuffer)

        playbackQueue.push(audioBuffer)
        if (!isPlaying) playNext()
      } catch (err: unknown) {
        const error = err as Error
        agent.log("TTS playback error: " + error.message, "error")
      }
    },
  )

  agent.socket.on("ttsBrowser", ({ agentId, text }: { agentId: number; text: string }) => {
    if (agentId !== agent.AGENT_ID) return
    if (!window.speechSynthesis) {
      agent.log("Browser TTS not supported", "error")
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.1
    utterance.onstart = () => {
      agent.setStatus("speaking")
      agent.log("Speaking (browser TTS)")
    }
    utterance.onend = () => {
      agent.setStatus("idle")
      agent.log("Finished speaking")
    }
    speechSynthesis.speak(utterance)
  })

  agent.socket.on(
    "textDelta",
    (_data: { agentId: number; delta: string; messageId: string; name: string }) => {
      // Accumulate in UI — handled by textComplete
    },
  )

  agent.socket.on(
    "textComplete",
    (msg: { agentId: number; name: string; text: string }) => {
      if (msg.agentId === agent.AGENT_ID) {
        agent.addChat(agent.AGENT_NAME, msg.text, "self")
        agent.log("Response complete")
      }
    },
  )

  function playNext(): void {
    if (playbackQueue.length === 0) {
      isPlaying = false
      return
    }
    isPlaying = true
    const buffer = playbackQueue.shift()!
    const source = playbackContext!.createBufferSource()
    source.buffer = buffer
    source.connect(playbackContext!.destination)
    source.onended = () => playNext()
    source.start()
    agent.setStatus("speaking")
    agent.log("Playing TTS audio")
  }

  agent.connectBtn.addEventListener("click", startConnection)

  async function startConnection(): Promise<void> {
    try {
      agent.connectBtn.disabled = true
      agent.log("Connecting...")

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      agent.log("Microphone access granted", "success")

      setupMicAnalysis(micStream)
      setupRecorder(micStream)

      agent.markConnected()
      agent.log("Connected! Listening for speech...", "success")
    } catch (err: unknown) {
      const error = err as Error
      agent.log("Error: " + error.message, "error")
      agent.connectBtn.disabled = false
    }
  }

  function setupMicAnalysis(stream: MediaStream): void {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3

    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const SPEAK_THRESHOLD = 0.04
    const SILENCE_DURATION = 1200
    let speaking = false
    let silenceTimer: ReturnType<typeof setTimeout> | null = null

    setInterval(() => {
      analyser.getByteFrequencyData(dataArray)

      let sum = 0
      for (let i = 3; i < 25; i++) sum += dataArray[i]
      const level = (sum / 22) / 255

      ;(agent.audioLevel as HTMLElement).style.width = Math.min(level * 150, 100) + "%"
      agent.socket.emit("audioLevel", { agentId: agent.AGENT_ID, level })

      if (level > SPEAK_THRESHOLD) {
        if (!speaking) {
          speaking = true
          startRecording()
          agent.setStatus("listening")
          agent.log("Speech detected, recording...")
        }
        if (silenceTimer) {
          clearTimeout(silenceTimer)
          silenceTimer = null
        }
      } else if (speaking && !silenceTimer) {
        silenceTimer = setTimeout(() => {
          speaking = false
          stopRecordingAndSend()
          agent.setStatus("idle")
          silenceTimer = null
        }, SILENCE_DURATION)
      }
    }, 33)
  }

  function setupRecorder(stream: MediaStream): void {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm"

    mediaRecorder = new MediaRecorder(stream, { mimeType })

    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data)
      }
    }

    mediaRecorder.onstop = () => {
      if (audioChunks.length === 0) return

      const blob = new Blob(audioChunks, { type: mediaRecorder!.mimeType })
      audioChunks = []

      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1]
        if (base64) {
          agent.log("Sending audio for transcription...")
          agent.socket.emit("audioData", {
            agentId: agent.AGENT_ID,
            audio: base64,
            mimeType: mediaRecorder!.mimeType,
          })
        }
      }
      reader.readAsDataURL(blob)
    }
  }

  function startRecording(): void {
    if (mediaRecorder && mediaRecorder.state === "inactive") {
      audioChunks = []
      mediaRecorder.start(100)
    }
  }

  function stopRecordingAndSend(): void {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop()
      agent.log("Recording stopped, processing...")
    }
  }
}


