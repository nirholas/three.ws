// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import type { AgentCommon } from "../core"

export function initOpenAIRealtime(agent: AgentCommon): void {
  let pc: RTCPeerConnection | null = null
  let dc: RTCDataChannel | null = null

  agent.socket.on("textToAgent", ({ text, from }: { text: string; from: string }) => {
    if (!dc || dc.readyState !== "open") return
    if (agent.AGENT_ID !== 0) return

    agent.log("Received text from " + from + ": " + text)

    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `[CHAT - ${from}]: ${text}` }],
      },
    }
    dc.send(JSON.stringify(event))

    setTimeout(() => {
      dc!.send(JSON.stringify({ type: "response.create" }))
    }, 100)
  })

  agent.connectBtn.addEventListener("click", startConnection)

  async function startConnection(): Promise<void> {
    try {
      agent.connectBtn.disabled = true
      agent.log("Getting session token...")

      const res = await fetch(agent.SESSION_ENDPOINT)
      const data = await res.json()
      const ephemeralKey = data.client_secret.value
      agent.log("Token received", "success")

      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      })

      pc.ontrack = (e: RTCTrackEvent) => {
        agent.log("Audio track received", "success")
        if (e.streams[0]) {
          agent.setupAudioAnalysis(e.streams[0])
          const audio = document.createElement("audio")
          audio.srcObject = e.streams[0]
          audio.autoplay = true
          ;(audio as HTMLAudioElement & { playsInline: boolean }).playsInline = true
          document.body.appendChild(audio)
          audio.play().then(() => {
            agent.log("Audio playback started", "success")
          }).catch((err: Error) => {
            agent.log("Audio play error: " + err.message, "error")
            document.addEventListener("click", () => {
              audio.play()
            }, { once: true })
          })
        }
      }

      pc.oniceconnectionstatechange = () => {
        agent.log("ICE state: " + pc!.iceConnectionState)
        if (pc!.iceConnectionState === "connected" || pc!.iceConnectionState === "completed") {
          agent.markConnected()
        } else if (["failed", "disconnected", "closed"].includes(pc!.iceConnectionState)) {
          agent.markDisconnected()
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => pc!.addTrack(track, stream))
      agent.log("Microphone access granted", "success")

      dc = pc.createDataChannel("oai-events")
      dc.onopen = () => agent.log("Data channel open", "success")
      dc.onmessage = (e: MessageEvent) => handleDataChannelMessage(e, agent)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: "Bearer " + ephemeralKey,
            "Content-Type": "application/sdp",
          },
        },
      )

      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp })
      agent.log("Connection established!", "success")
    } catch (err: unknown) {
      const error = err as Error
      agent.log("Error: " + error.message, "error")
      agent.connectBtn.disabled = false
    }
  }

  function handleDataChannelMessage(e: MessageEvent, agent: AgentCommon): void {
    try {
      const msg = JSON.parse(e.data)

      if (msg.type === "input_audio_buffer.speech_started") {
        agent.setStatus("listening")
        agent.log("Listening to input...")
      } else if (msg.type === "input_audio_buffer.speech_stopped") {
        if (!agent.isSpeaking) agent.setStatus("idle")
      } else if (msg.type === "response.created") {
        agent.socket.emit("requestTurn", { agentId: agent.AGENT_ID })
        agent.currentMessageId = Date.now().toString()
        agent.log("Response started")
      } else if (msg.type === "response.audio_transcript.delta") {
        if (msg.delta) {
          agent.socket.emit("textDelta", {
            agentId: agent.AGENT_ID,
            delta: msg.delta,
            messageId: agent.currentMessageId,
          })
        }
      } else if (msg.type === "response.audio_transcript.done") {
        if (msg.transcript) {
          agent.socket.emit("textComplete", {
            agentId: agent.AGENT_ID,
            text: msg.transcript,
            messageId: agent.currentMessageId,
          })
          agent.addChat(agent.AGENT_NAME, msg.transcript, "self")
          agent.log("Response complete")
        }
      } else if (msg.type === "response.done") {
        agent.log("Response done event")
      } else if (msg.type === "conversation.item.created" && msg.item?.role === "user") {
        const content = msg.item.content || []
        let text = ""
        content.forEach((c: { transcript?: string; text?: string }) => {
          if (c.transcript) text += c.transcript
          if (c.text) text += c.text
        })
        if (text.trim()) {
          agent.log("User said: " + text)
        }
      }
    } catch {
      agent.log("Parse error", "error")
    }
  }
}


