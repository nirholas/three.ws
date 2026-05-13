// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§75]

import { createChildLogger } from "../utils/logger.js";
import { config } from "../config.js";
import type { XSpaceBot } from "../spaces/index.js";
import type {
  SpaceState,
  SpaceMessage,
  SpaceNamespace,
  SpaceSocket,
  LLMProvider,
  TTSProvider,
} from "../types.js";

const log = createChildLogger("admin:socket");

function isWallet(str: string): boolean {
  return str.length >= 32 && /^[a-zA-Z0-9]+$/.test(str);
}

function shortenNick(name: string | undefined): string {
  if (!name) return "User";
  if (isWallet(name)) return name.slice(0, 4) + "..." + name.slice(-4);
  return name;
}

export function setupSocketHandlers(
  spaceNS: SpaceNamespace,
  spaceState: SpaceState,
  provider: LLMProvider,
  tts: TTSProvider,
  prompts: Record<number, string>,
  xBot: XSpaceBot | null,
): void {
  function broadcastSpaceState(): void {
    spaceNS.emit("stateUpdate", {
      agents: spaceState.agents,
      currentTurn: spaceState.currentTurn,
      turnQueue: spaceState.turnQueue,
    });
  }

  function requestTurn(agentId: number): boolean {
    if (spaceState.currentTurn === null && !spaceState.isProcessing) {
      spaceState.currentTurn = agentId;
      spaceState.isProcessing = true;
      spaceNS.emit("turnGranted", { agentId });
      broadcastSpaceState();
      return true;
    }
    if (
      !spaceState.turnQueue.includes(agentId) &&
      spaceState.currentTurn !== agentId
    ) {
      spaceState.turnQueue.push(agentId);
      broadcastSpaceState();
    }
    return false;
  }

  function releaseTurn(agentId: number): void {
    if (spaceState.currentTurn === agentId) {
      spaceState.currentTurn = null;
      spaceState.isProcessing = false;
      if (spaceState.turnQueue.length > 0) {
        const nextAgent = spaceState.turnQueue.shift()!;
        setTimeout(() => {
          spaceState.currentTurn = nextAgent;
          spaceState.isProcessing = true;
          spaceNS.emit("turnGranted", { agentId: nextAgent });
          broadcastSpaceState();
        }, 500);
      } else {
        broadcastSpaceState();
      }
    }
  }

  function addMessage(msg: SpaceMessage): void {
    spaceState.messages.push(msg);
    if (spaceState.messages.length > 100) {
      spaceState.messages = spaceState.messages.slice(-100);
    }
  }

  async function handleLLMResponse(
    socket: SpaceSocket,
    agentId: number,
    userText: string,
  ): Promise<void> {
    requestTurn(agentId);
    const messageId = Date.now().toString();
    const agentName = spaceState.agents[agentId]?.name ?? "Agent";

    spaceNS.emit("agentStatus", { agentId, status: "speaking", name: agentName });
    if (spaceState.agents[agentId]) spaceState.agents[agentId]!.status = "speaking";
    broadcastSpaceState();

    let fullText = "";
    try {
      for await (const delta of provider.streamResponse(
        agentId,
        userText,
        prompts[agentId] ?? "",
      )) {
        fullText += delta;
        spaceNS.emit("textDelta", { agentId, delta, messageId, name: agentName });
      }

      const msg: SpaceMessage = {
        id: messageId,
        agentId,
        name: agentName,
        text: fullText,
        timestamp: Date.now(),
      };
      addMessage(msg);
      spaceNS.emit("textComplete", msg);

      // TTS
      try {
        const audioBuffer = await tts.synthesize(fullText, agentId);
        if (audioBuffer) {
          socket.emit("ttsAudio", {
            agentId,
            audio: audioBuffer.toString("base64"),
            format: "mp3",
          });
        } else {
          socket.emit("ttsBrowser", { agentId, text: fullText });
        }
      } catch (ttsErr) {
        log.error("TTS error: %s", (ttsErr as Error).message);
        socket.emit("ttsBrowser", { agentId, text: fullText });
      }
    } catch (err) {
      log.error("LLM error (%s): %s", config.aiProvider, (err as Error).message);
    } finally {
      if (spaceState.agents[agentId])
        spaceState.agents[agentId]!.status = "idle";
      spaceNS.emit("agentStatus", { agentId, status: "idle", name: agentName });
      releaseTurn(agentId);
    }
  }

  // ── X Space bot events ──────────────────────────────────────────────────

  if (xBot) {
    xBot.on("status", (status: string) => {
      log.info("X-Spaces status: %s", status);
      spaceNS.emit("xSpacesStatus", { status });

      // Auto-intro when joining a Space
      if (status === "speaking-in-space") {
        setTimeout(async () => {
          if (!requestTurn(0)) return;
          try {
            let intro = "";
            for await (const delta of provider.streamResponse(
              0,
              "You just joined an X Space as a speaker. Say a short intro line in character — 1 sentence max, no hashtags.",
              prompts[0] ?? "",
            )) {
              intro += delta;
            }
            intro = intro.trim() || "yo i'm here, let's go";
            const audioBuffer = await tts.synthesize(intro, 0);
            if (audioBuffer) await xBot.speakInSpace(audioBuffer);
          } catch (e) {
            log.error("Intro error: %s", (e as Error).message);
          } finally {
            releaseTurn(0);
          }
        }, 2000);
      }
    });

    xBot.on("error", (err: string) => {
      log.error("X-Spaces error: %s", err);
      spaceNS.emit("xSpacesError", { error: err });
    });

    xBot.on("2fa-required", () => {
      spaceNS.emit("xSpaces2faRequired", {});
    });

    xBot.on("transcription", async ({ text }: { text: string }) => {
      log.info('Heard in Space: "%s"', text);
      const userMsg: SpaceMessage = {
        id: Date.now().toString(),
        agentId: -1,
        name: "X Space Speaker",
        text,
        timestamp: Date.now(),
        isUser: true,
        source: "x-space",
      };
      addMessage(userMsg);
      spaceNS.emit("textComplete", userMsg);

      const agentId = 0;
      if (!requestTurn(agentId)) {
        log.info("Already responding, skipping transcription");
        return;
      }

      const messageId = Date.now().toString();
      const agentName = spaceState.agents[agentId]?.name ?? "Agent";

      spaceNS.emit("agentStatus", { agentId, status: "speaking", name: agentName });
      if (spaceState.agents[agentId])
        spaceState.agents[agentId]!.status = "speaking";
      broadcastSpaceState();

      let fullText = "";
      try {
        for await (const delta of provider.streamResponse(
          agentId,
          text,
          prompts[agentId] ?? "",
        )) {
          fullText += delta;
          spaceNS.emit("textDelta", { agentId, delta, messageId, name: agentName });
        }

        const msg: SpaceMessage = {
          id: messageId,
          agentId,
          name: agentName,
          text: fullText,
          timestamp: Date.now(),
        };
        addMessage(msg);
        spaceNS.emit("textComplete", msg);

        const audioBuffer = await tts.synthesize(fullText, agentId);
        if (audioBuffer) {
          await xBot.speakInSpace(audioBuffer);
          spaceNS.emit("ttsAudio", {
            agentId,
            audio: audioBuffer.toString("base64"),
            format: "mp3",
          });
        }
      } catch (err) {
        log.error("Response error: %s", (err as Error).message);
      } finally {
        if (spaceState.agents[agentId])
          spaceState.agents[agentId]!.status = "idle";
        spaceNS.emit("agentStatus", { agentId, status: "idle", name: agentName });
        releaseTurn(agentId);
      }
    });
  }

  // ── Socket.IO connection handler ────────────────────────────────────────

  spaceNS.on("connection", (socket: SpaceSocket) => {
    log.info("Client connected: %s", socket.id);

    // Send initial state
    socket.emit("stateUpdate", {
      agents: spaceState.agents,
      currentTurn: spaceState.currentTurn,
      turnQueue: spaceState.turnQueue,
    });
    socket.emit("messageHistory", spaceState.messages.slice(-50));

    // Agent lifecycle
    socket.on("agentConnect", ({ agentId }) => {
      if (spaceState.agents[agentId]) {
        spaceState.agents[agentId]!.connected = true;
        spaceState.agents[agentId]!.status = "idle";
        spaceState.agents[agentId]!.socketId = socket.id;
        log.info("Agent %d connected", agentId);
        broadcastSpaceState();
      }
    });

    socket.on("agentDisconnect", ({ agentId }) => {
      if (spaceState.agents[agentId]) {
        spaceState.agents[agentId]!.connected = false;
        spaceState.agents[agentId]!.status = "offline";
        if (spaceState.currentTurn === agentId) releaseTurn(agentId);
        spaceState.turnQueue = spaceState.turnQueue.filter(
          (id) => id !== agentId,
        );
        log.info("Agent %d disconnected", agentId);
        broadcastSpaceState();
      }
    });

    socket.on("statusChange", ({ agentId, status }) => {
      if (spaceState.agents[agentId]) {
        spaceState.agents[agentId]!.status = status as import("../types.js").AgentStatus;
        spaceNS.emit("agentStatus", {
          agentId,
          status,
          name: spaceState.agents[agentId]!.name,
        });
        broadcastSpaceState();
      }
    });

    // Turn management
    socket.on("requestTurn", ({ agentId }) => {
      const granted = requestTurn(agentId);
      socket.emit("turnResponse", {
        granted,
        currentTurn: spaceState.currentTurn,
      });
    });

    socket.on("releaseTurn", ({ agentId }) => releaseTurn(agentId));

    // Text streaming
    socket.on("textDelta", ({ agentId, delta, messageId }) => {
      spaceNS.emit("textDelta", {
        agentId,
        delta,
        messageId,
        name: spaceState.agents[agentId]?.name ?? "Agent",
      });
    });

    socket.on("textComplete", ({ agentId, text, messageId }) => {
      const msg: SpaceMessage = {
        id: messageId,
        agentId,
        name: spaceState.agents[agentId]?.name ?? "Agent",
        text,
        timestamp: Date.now(),
      };
      addMessage(msg);
      spaceNS.emit("textComplete", msg);
    });

    // Audio processing
    socket.on("audioData", async ({ agentId, audio, mimeType }) => {
      if (provider.type === "webrtc") return;
      try {
        spaceNS.emit("agentStatus", {
          agentId,
          status: "listening",
          name: spaceState.agents[agentId]?.name ?? "Agent",
        });
        if (spaceState.agents[agentId])
          spaceState.agents[agentId]!.status = "listening";
        broadcastSpaceState();

        const { createSTTProvider } = await import("../providers/stt.js");
        const stt = createSTTProvider();
        const audioBuffer = Buffer.from(audio, "base64");
        const { text } = await stt.transcribe(
          audioBuffer,
          mimeType ?? "audio/webm",
        );

        if (!text?.trim()) {
          if (spaceState.agents[agentId])
            spaceState.agents[agentId]!.status = "idle";
          spaceNS.emit("agentStatus", {
            agentId,
            status: "idle",
            name: spaceState.agents[agentId]?.name ?? "Agent",
          });
          broadcastSpaceState();
          return;
        }

        log.info('Agent %d heard: "%s"', agentId, text);
        const userMsg: SpaceMessage = {
          id: Date.now().toString(),
          agentId: -1,
          name: "User (voice)",
          text,
          timestamp: Date.now(),
          isUser: true,
        };
        addMessage(userMsg);
        spaceNS.emit("textComplete", userMsg);
        await handleLLMResponse(socket, agentId, text);
      } catch (err) {
        log.error("Audio pipeline error: %s", (err as Error).message);
        if (spaceState.agents[agentId])
          spaceState.agents[agentId]!.status = "idle";
        spaceNS.emit("agentStatus", {
          agentId,
          status: "idle",
          name: spaceState.agents[agentId]?.name ?? "Agent",
        });
        broadcastSpaceState();
      }
    });

    // User chat messages
    socket.on("userMessage", ({ text, from }) => {
      const msg: SpaceMessage = {
        id: Date.now().toString(),
        agentId: -1,
        name: from ?? "User",
        text,
        timestamp: Date.now(),
        isUser: true,
      };
      addMessage(msg);
      spaceNS.emit("userMessage", msg);
      spaceNS.emit("textComplete", msg);

      if (provider.type === "socket") {
        void handleLLMResponse(
          socket,
          0,
          `[CHAT - ${shortenNick(from)}]: ${text}`,
        );
      } else {
        spaceNS.emit("textToAgent", {
          text,
          from: shortenNick(from),
        });
      }
    });

    socket.on("textToAgentDirect", async ({ agentId, text, from }) => {
      if (provider.type === "webrtc") return;
      const chatText = from
        ? `[CHAT - ${shortenNick(from)}]: ${text}`
        : text;
      await handleLLMResponse(socket, agentId, chatText);
    });

    socket.on("audioLevel", ({ agentId, level }) =>
      spaceNS.emit("audioLevel", { agentId, level }),
    );

    // X Space bot controls
    if (xBot) {
      socket.on("xspace:start", async () => {
        try {
          await xBot.start();
        } catch (e) {
          socket.emit("xSpacesError", { error: (e as Error).message });
        }
      });

      socket.on("xspace:join", async ({ spaceUrl }) => {
        try {
          await xBot.joinSpace(spaceUrl);
        } catch (e) {
          socket.emit("xSpacesError", { error: (e as Error).message });
        }
      });

      socket.on("xspace:leave", async () => {
        try {
          await xBot.leaveSpace();
        } catch (e) {
          socket.emit("xSpacesError", { error: (e as Error).message });
        }
      });

      socket.on("xspace:stop", async () => {
        try {
          await xBot.stop();
        } catch (e) {
          socket.emit("xSpacesError", { error: (e as Error).message });
        }
      });

      socket.on("xspace:status", () => {
        socket.emit("xSpacesStatus", xBot.getStatus());
      });

      socket.on("xspace:2fa", ({ code }) => {
        xBot.emit("2fa-code", code);
      });
    }

    // Disconnect
    socket.on("disconnect", () => {
      for (const id in spaceState.agents) {
        const numId = parseInt(id, 10);
        if (spaceState.agents[numId]?.socketId === socket.id) {
          spaceState.agents[numId]!.connected = false;
          spaceState.agents[numId]!.status = "offline";
          if (spaceState.currentTurn === numId) releaseTurn(numId);
          spaceState.turnQueue = spaceState.turnQueue.filter(
            (aid) => aid !== numId,
          );
        }
      }
      broadcastSpaceState();
      log.info("Client disconnected: %s", socket.id);
    });
  });
}


