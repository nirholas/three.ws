// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { EventEmitter } from "node:events";
import type { Browser, Page } from "puppeteer";
import { config } from "../config.js";
import { createChildLogger } from "../utils/logger.js";
import * as browser from "./browser.js";
import { login } from "./auth.js";
import * as spaceUI from "./space-ui.js";
import * as audioBridge from "./audio-bridge.js";
import { createSTTProvider } from "../providers/stt.js";
import type { XSpaceBotStatus, XSpaceBotState, STTProvider } from "../types.js";

const log = createChildLogger("spaces");

const SILENCE_THRESHOLD_MS = 1500;
const MIN_AUDIO_CHUNKS = 3;

export class XSpaceBot extends EventEmitter {
  private _browser: Browser | null = null;
  private _page: Page | null = null;
  private _state: XSpaceBotStatus = "disconnected";
  private _spaceUrl: string | null = null;
  private _audioChunks: Buffer[] = [];
  private _silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _captureActive = false;
  private _healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _reconnectAttempts = 0;
  private _stt: STTProvider;

  constructor() {
    super();
    this._stt = createSTTProvider();
  }

  private setState(status: XSpaceBotStatus): void {
    this._state = status;
    this.emit("status", status);
  }

  get status(): XSpaceBotStatus {
    return this._state;
  }

  getStatus(): XSpaceBotState {
    return {
      status: this._state,
      spaceUrl: this._spaceUrl,
      isCapturing: this._captureActive,
    };
  }

  async start(): Promise<void> {
    if (this._browser) {
      log.info("Already running");
      return;
    }

    try {
      this.setState("launching");
      const result = await browser.launch();
      this._browser = result.browser;
      this._page = result.page;

      // Inject audio hooks before navigating
      await audioBridge.injectAudioHooks(
        this._page,
        this.onSpaceAudioChunk.bind(this),
      );

      // Log in
      await login(this._page, this);
      this.setState("logged-in");

      log.info("Ready. Use joinSpace(url) to join a Space.");

      // Auto-join if configured
      if (config.xSpaceUrl) {
        log.info("Auto-joining: %s", config.xSpaceUrl);
        await this.joinSpace(config.xSpaceUrl);
      }
    } catch (err) {
      log.error("Start error: %s", (err as Error).message);
      this.emit("error", (err as Error).message);
      await this.stop();
    }
  }

  async joinSpace(spaceUrl: string): Promise<void> {
    if (!this._page) throw new Error("Browser not started. Call start() first.");

    const busyStates: XSpaceBotStatus[] = [
      "joining-space",
      "in-space-as-listener",
      "requesting-speaker",
      "speaker-requested",
      "speaking-in-space",
    ];
    if (busyStates.includes(this._state)) {
      log.info("Already joining or in a Space, ignoring duplicate request");
      return;
    }

    this._spaceUrl = spaceUrl;
    this._reconnectAttempts = 0;

    try {
      await spaceUI.joinSpace(this._page, spaceUrl, this);

      const speakerResult = await spaceUI.requestSpeaker(this._page, this);

      if (speakerResult === "requested") {
        log.info("Waiting for host to accept speaker request...");
        await spaceUI.waitForSpeakerAccess(this._page, this);
      } else if (speakerResult === "granted") {
        await spaceUI.unmute(this._page, this);
      } else {
        log.info("No request button — trying unmute directly (open space)");
        await spaceUI.unmute(this._page, this);
      }

      this.setState("speaking-in-space");
      this._captureActive = true;
      log.info("Active in Space and ready to speak!");

      this.startHealthCheck();
    } catch (err) {
      log.error("Join error: %s", (err as Error).message);
      this.emit("error", (err as Error).message);
    }
  }

  async leaveSpace(): Promise<void> {
    if (!this._page) return;
    this._captureActive = false;
    this.stopHealthCheck();

    try {
      await spaceUI.leaveSpace(this._page, this);
      this._spaceUrl = null;
      this.setState("logged-in");
    } catch (err) {
      log.error("Leave error: %s", (err as Error).message);
    }
  }

  async speakInSpace(mp3Buffer: Buffer): Promise<void> {
    if (!this._page || this._state !== "speaking-in-space") {
      log.info("Not in a Space or not a speaker, skipping audio injection");
      return;
    }

    // Pause capture to prevent echo loop
    this._captureActive = false;
    try {
      await audioBridge.injectAudio(this._page, mp3Buffer);
    } catch (err) {
      log.error("Audio injection error: %s", (err as Error).message);
      this.emit("error", "Audio injection failed: " + (err as Error).message);
    } finally {
      // Resume capture after cooldown
      setTimeout(() => {
        this._captureActive = true;
      }, 1500);
    }
  }

  async stop(): Promise<void> {
    this._captureActive = false;
    this.stopHealthCheck();
    if (this._spaceUrl) await this.leaveSpace();
    if (this._browser) {
      await browser.closeBrowser(this._browser);
      this._browser = null;
      this._page = null;
    }
    this.setState("disconnected");
  }

  // ── Audio capture ───────────────────────────────────────────────────────

  private onSpaceAudioChunk(pcmBase64: string, sampleRate: number): void {
    if (!this._captureActive) return;

    const pcmBuffer = Buffer.from(pcmBase64, "base64");
    this._audioChunks.push(pcmBuffer);

    if (this._silenceTimer) clearTimeout(this._silenceTimer);
    this._silenceTimer = setTimeout(async () => {
      if (this._audioChunks.length < MIN_AUDIO_CHUNKS) {
        this._audioChunks = [];
        return;
      }

      const chunks = this._audioChunks;
      this._audioChunks = [];

      try {
        const wavBuffer = audioBridge.pcmChunksToWav(
          chunks,
          sampleRate || 16000,
        );
        const { text } = await this._stt.transcribe(wavBuffer, "audio/wav");
        if (text?.trim()) {
          log.info('Space speaker said: "%s"', text);
          this.emit("transcription", {
            text: text.trim(),
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        log.error("STT error: %s", (err as Error).message);
      }
    }, SILENCE_THRESHOLD_MS);
  }

  // ── Health check & reconnection ─────────────────────────────────────────

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this._healthCheckInterval = setInterval(async () => {
      if (!this._page || this._state === "disconnected") {
        this.stopHealthCheck();
        return;
      }

      // Check browser health
      const healthy = await browser.isHealthy(this._page);
      if (!healthy) {
        log.error("Browser is unresponsive");
        await this.handleDisconnect();
        return;
      }

      try {
        const state = await spaceUI.getSpaceState(this._page);
        if (state.hasEnded) {
          log.info("Space has ended");
          this._captureActive = false;
          this.setState("space-ended");
          this.stopHealthCheck();
        }
      } catch {
        // Page may have navigated away
      }
    }, 10000);
  }

  private stopHealthCheck(): void {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (
      this._reconnectAttempts >= config.reconnectMaxRetries ||
      !this._spaceUrl
    ) {
      log.error("Max reconnection attempts reached or no Space URL, stopping");
      await this.stop();
      return;
    }

    this._reconnectAttempts++;
    const delay =
      config.reconnectBaseDelayMs * Math.pow(2, this._reconnectAttempts - 1);
    log.info(
      "Reconnecting in %dms (attempt %d/%d)",
      delay,
      this._reconnectAttempts,
      config.reconnectMaxRetries,
    );

    await new Promise((r) => setTimeout(r, delay));

    try {
      const savedUrl = this._spaceUrl;
      await this.stop();
      await this.start();
      if (savedUrl) await this.joinSpace(savedUrl);
    } catch (err) {
      log.error("Reconnection failed: %s", (err as Error).message);
      await this.handleDisconnect();
    }
  }
}


