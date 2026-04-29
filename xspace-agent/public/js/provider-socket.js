// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// Socket.IO-based audio provider for Claude/Groq
// Captures mic audio via MediaRecorder, sends to server for STT -> LLM -> TTS pipeline
function initSocketProvider(agent) {
  let mediaRecorder = null
  let audioChunks = []
  let isRecording = false
  let micStream = null
  let playbackContext = null
  let playbackQueue = []
  let isPlaying = false

  // Listen for TTS audio from server (OpenAI TTS)
  agent.socket.on("ttsAudio", async ({ agentId, audio, format }) => {
    if (agentId !== agent.AGENT_ID) return
    try {
      if (!playbackContext) {
        playbackContext = new (window.AudioContext || window.webkitAudioContext)()
      }
      const audioData = Uint8Array.from(atob(audio), c => c.charCodeAt(0))
      const audioBuffer = await playbackContext.decodeAudioData(audioData.buffer.slice(0))

      playbackQueue.push(audioBuffer)
      if (!isPlaying) playNext()
    } catch (err) {
      agent.log("TTS playback error: " + err.message, "error")
    }
  })

  // Listen for browser TTS fallback
  agent.socket.on("ttsBrowser", ({ agentId, text }) => {
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

  // Listen for text deltas from server (for self messages)
  agent.socket.on("textDelta", ({ agentId, delta, messageId, name }) => {
    if (agentId === agent.AGENT_ID) {
      // Accumulate in UI — handled by textComplete
    }
  })

  // Listen for completed text from server (for self messages)
  agent.socket.on("textComplete", (msg) => {
    if (msg.agentId === agent.AGENT_ID) {
      agent.addChat(agent.AGENT_NAME, msg.text, "self")
      agent.log("Response complete")
    }
  })

  function playNext() {
    if (playbackQueue.length === 0) {
      isPlaying = false
      return
    }
    isPlaying = true
    const buffer = playbackQueue.shift()
    const source = playbackContext.createBufferSource()
    source.buffer = buffer
    source.connect(playbackContext.destination)
    source.onended = () => playNext()
    source.start()
    agent.setStatus("speaking")
    agent.log("Playing TTS audio")
  }

  agent.connectBtn.addEventListener("click", startConnection)

  async function startConnection() {
    try {
      agent.connectBtn.disabled = true
      agent.log("Connecting...")

      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      agent.log("Microphone access granted", "success")

      // Set up audio analysis for the mic stream (visual feedback)
      setupMicAnalysis(micStream)

      // Set up MediaRecorder for capturing audio to send to server
      setupRecorder(micStream)

      agent.markConnected()
      agent.log("Connected! Listening for speech...", "success")

    } catch (err) {
      agent.log("Error: " + err.message, "error")
      agent.connectBtn.disabled = false
    }
  }

  function setupMicAnalysis(stream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3

    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const SPEAK_THRESHOLD = 0.04
    const SILENCE_DURATION = 1200 // longer silence for STT batching
    let speaking = false
    let silenceTimer = null

    setInterval(() => {
      analyser.getByteFrequencyData(dataArray)

      let sum = 0
      for (let i = 3; i < 25; i++) sum += dataArray[i]
      const level = (sum / 22) / 255

      agent.audioLevel.style.width = Math.min(level * 150, 100) + "%"
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

  function setupRecorder(stream) {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm"

    mediaRecorder = new MediaRecorder(stream, { mimeType })

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data)
      }
    }

    mediaRecorder.onstop = () => {
      if (audioChunks.length === 0) return

      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType })
      audioChunks = []

      // Convert to base64 and send to server
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result.split(",")[1]
        if (base64) {
          agent.log("Sending audio for transcription...")
          agent.socket.emit("audioData", {
            agentId: agent.AGENT_ID,
            audio: base64,
            mimeType: mediaRecorder.mimeType
          })
        }
      }
      reader.readAsDataURL(blob)
    }
  }

  function startRecording() {
    if (mediaRecorder && mediaRecorder.state === "inactive") {
      audioChunks = []
      mediaRecorder.start(100) // collect in 100ms chunks
      isRecording = true
    }
  }

  function stopRecordingAndSend() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop()
      isRecording = false
      agent.log("Recording stopped, processing...")
    }
  }
}

window.initSocketProvider = initSocketProvider


