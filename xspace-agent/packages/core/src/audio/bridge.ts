// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import type { Page } from "puppeteer";
import type { BrowserMode } from "../types";
import { getLogger } from "../logger";
import { captureWorkletCode } from "./worklets/capture";
import { injectionWorkletCode } from "./worklets/injection";

export async function injectAudioHooks(
  page: Page,
  onSpaceAudio: (pcmBase64: string, sampleRate: number) => void,
  mode: BrowserMode = 'managed'
): Promise<void> {
  await page.exposeFunction(
    "__onSpaceAudio",
    (pcmBase64: string, sampleRate: number) => {
      onSpaceAudio(pcmBase64, sampleRate);
    }
  );
  await page.exposeFunction("__audioLog", (msg: string) => {
    getLogger().debug("[AudioBridge]", msg);
  });

  // Pass worklet source code as arguments to evaluateOnNewDocument
  await page.evaluateOnNewDocument(
    (captureCode: string, injectionCode: string) => {
      const _origGetUserMedia =
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

      // Injection context (controlled stream for TTS playback)
      let injectionCtx: AudioContext | null = null;
      let destNode: MediaStreamAudioDestinationNode | null = null;
      let controlledStream: MediaStream | null = null;
      let injectionWorkletNode: AudioWorkletNode | null = null;

      // Capture contexts — tracked for proper cleanup
      const captureCtxList: AudioContext[] = [];
      const captureWorkletNodes: AudioWorkletNode[] = [];
      const capturedTrackIds = new Set<string>();

      // Echo cancellation state
      let ttsPlaying = false;
      let ttsCooldownTimer: ReturnType<typeof setTimeout> | null = null;
      let injectionEnergy = 0;

      // ── Injection context setup ──────────────────────────────

      async function getControlledStream(): Promise<MediaStream> {
        if (controlledStream) return controlledStream;
        injectionCtx = new AudioContext({ sampleRate: 48000 });
        destNode = injectionCtx.createMediaStreamDestination();

        // Register and create the injection AudioWorklet
        const injectionBlob = new Blob([injectionCode], {
          type: "application/javascript",
        });
        const injectionUrl = URL.createObjectURL(injectionBlob);
        try {
          await injectionCtx.audioWorklet.addModule(injectionUrl);
        } finally {
          URL.revokeObjectURL(injectionUrl);
        }

        injectionWorkletNode = new AudioWorkletNode(
          injectionCtx,
          "injection-processor"
        );
        injectionWorkletNode.connect(destNode);

        // Listen for playback events from the worklet
        injectionWorkletNode.port.onmessage = (event) => {
          if (event.data.type === "playback-started") {
            (window as any).__audioLog("Injection worklet: playback started");
          } else if (event.data.type === "playback-ended") {
            (window as any).__audioLog(
              "Injection worklet: playback ended (" +
                event.data.totalSamples +
                " samples)"
            );
          } else if (event.data.type === "queue-low") {
            // Could be used for streaming TTS in the future
          }
        };

        controlledStream = destNode.stream;
        controlledStream.getAudioTracks().forEach((track) => {
          Object.defineProperty(track, "enabled", {
            get: () => true,
            set: () => {},
            configurable: true,
          });
        });
        (window as any).__audioLog(
          "Controlled audio stream created (48kHz, AudioWorklet)"
        );
        return controlledStream;
      }

      // Override getUserMedia — return controlled stream for audio requests
      navigator.mediaDevices.getUserMedia = async (
        constraints?: MediaStreamConstraints
      ): Promise<MediaStream> => {
        if (constraints && constraints.audio) {
          (window as any).__audioLog(
            "getUserMedia intercepted — returning controlled stream"
          );
          const stream = await getControlledStream();
          if (constraints.video) {
            const realStream = await _origGetUserMedia({
              video: constraints.video,
            });
            realStream.getAudioTracks().forEach((t) => t.stop());
            stream.getVideoTracks().forEach((t) => stream.removeTrack(t));
            realStream.getVideoTracks().forEach((t) => stream.addTrack(t));
          }
          return stream;
        }
        return _origGetUserMedia(constraints);
      };

      // ── Echo gate API ────────────────────────────────────────

      (window as any).__setTTSPlaying = (
        playing: boolean,
        cooldownMs: number = 300
      ): void => {
        if (playing) {
          if (ttsCooldownTimer !== null) {
            clearTimeout(ttsCooldownTimer);
            ttsCooldownTimer = null;
          }
          ttsPlaying = true;
        } else {
          ttsCooldownTimer = setTimeout(() => {
            ttsPlaying = false;
            injectionEnergy = 0;
            ttsCooldownTimer = null;
          }, cooldownMs);
        }
      };

      // ── Audio chunk injection (via AudioWorklet) ─────────────

      (window as any).__injectAudioChunk = (pcmFloat32Base64: string): void => {
        if (!injectionCtx || !injectionWorkletNode) {
          // Stream not yet created — queue will be handled after setup
          (window as any).__audioLog(
            "Injection context not ready, skipping chunk"
          );
          return;
        }
        if (injectionCtx.state !== "running")
          injectionCtx.resume().catch(() => {});

        try {
          const raw = atob(pcmFloat32Base64);
          if (raw.length % 4 !== 0 || raw.length < 4) {
            (window as any).__audioLog(
              "Invalid PCM data: length " +
                raw.length +
                " is not float32-aligned"
            );
            return;
          }
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++)
            bytes[i] = raw.charCodeAt(i);
          const float32 = new Float32Array(bytes.buffer);

          // Compute injection energy for echo cancellation
          let sumSq = 0;
          for (let i = 0; i < float32.length; i++)
            sumSq += float32[i] * float32[i];
          injectionEnergy = sumSq / float32.length;

          // Audio level monitoring
          let hasClipping = false;
          let allSilence = true;
          for (let i = 0; i < float32.length; i++) {
            if (Math.abs(float32[i]) >= 0.99) hasClipping = true;
            if (Math.abs(float32[i]) > 0.001) allSilence = false;
          }
          if (hasClipping)
            (window as any).__audioLog(
              "Warning: clipping detected in TTS chunk"
            );
          if (allSilence)
            (window as any).__audioLog(
              "Warning: injecting silent TTS chunk"
            );

          // Enqueue to the injection worklet instead of BufferSource
          injectionWorkletNode.port.postMessage({
            type: "enqueue",
            buffer: Array.from(float32),
          });
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          (window as any).__audioLog("Audio injection error: " + message);
        }
      };

      // Expose injection energy for Node-side echo cancellation
      (window as any).__getInjectionEnergy = (): number => injectionEnergy;

      // ── Browser-side MP3 decoding ────────────────────────────

      (window as any).__decodeMp3 = async (
        mp3Base64: string
      ): Promise<number[]> => {
        const binary = atob(mp3Base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
          bytes[i] = binary.charCodeAt(i);

        const ctx = injectionCtx || new AudioContext({ sampleRate: 48000 });
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        const pcm = audioBuffer.getChannelData(0); // Mono
        return Array.from(pcm);
      };

      // ── Dispose ──────────────────────────────────────────────

      (window as any).__disposeAudio = (): void => {
        // Stop and release capture contexts
        captureWorkletNodes.forEach((node) => {
          try {
            node.disconnect();
          } catch {
            /* ignore */
          }
        });
        captureWorkletNodes.length = 0;
        captureCtxList.forEach((ctx) => ctx.close().catch(() => {}));
        captureCtxList.length = 0;
        capturedTrackIds.clear();

        // Disconnect injection worklet and close injection context
        try {
          injectionWorkletNode?.disconnect();
        } catch {
          /* ignore */
        }
        injectionWorkletNode = null;
        controlledStream?.getAudioTracks().forEach((t) => t.stop());
        controlledStream = null;
        destNode = null;
        injectionCtx?.close().catch(() => {});
        injectionCtx = null;

        // Clear echo cancellation state
        if (ttsCooldownTimer !== null) {
          clearTimeout(ttsCooldownTimer);
          ttsCooldownTimer = null;
        }
        ttsPlaying = false;
        injectionEnergy = 0;

        (window as any).__audioLog("Audio resources disposed");
      };

      // ── RTCPeerConnection hook ───────────────────────────────

      const _OrigRTC = window.RTCPeerConnection;
      (window as any).RTCPeerConnection = function (
        ...args: ConstructorParameters<typeof RTCPeerConnection>
      ): RTCPeerConnection {
        const pc = new _OrigRTC(...args);
        (window as any).__audioLog("RTCPeerConnection created");

        // Expose for WebRTC stats monitoring
        (window as any).__rtcPeerConnection = pc;

        const handleTrack = (event: RTCTrackEvent): void => {
          (window as any).__audioLog(
            "track event: kind=" + event.track.kind
          );
          if (event.track.kind === "audio") captureAudioTrack(event.track);
        };
        pc.addEventListener("track", handleTrack);

        let _ontrack:
          | ((this: RTCPeerConnection, ev: RTCTrackEvent) => any)
          | null = null;
        Object.defineProperty(pc, "ontrack", {
          get: () => _ontrack,
          set: (
            fn: ((this: RTCPeerConnection, ev: RTCTrackEvent) => any) | null
          ) => {
            _ontrack = fn;
            pc.addEventListener("track", (e) => {
              handleTrack(e);
              if (fn) fn.call(pc, e);
            });
          },
        });

        return pc;
      };
      (window as any).RTCPeerConnection.prototype = _OrigRTC.prototype;
      Object.keys(_OrigRTC).forEach((k) => {
        (window as any).RTCPeerConnection[k] = (_OrigRTC as any)[k];
      });

      // ── Audio capture via AudioWorklet ───────────────────────

      async function captureAudioTrack(track: MediaStreamTrack): Promise<void> {
        if (capturedTrackIds.has(track.id)) return;
        capturedTrackIds.add(track.id);

        try {
          const captureCtx = new AudioContext({ sampleRate: 16000 });
          captureCtxList.push(captureCtx);
          await captureCtx.resume();

          const source = captureCtx.createMediaStreamSource(
            new MediaStream([track])
          );

          // Try AudioWorklet first, fall back to ScriptProcessor if unavailable
          if (captureCtx.audioWorklet) {
            const blob = new Blob([captureCode], {
              type: "application/javascript",
            });
            const url = URL.createObjectURL(blob);
            try {
              await captureCtx.audioWorklet.addModule(url);
            } finally {
              URL.revokeObjectURL(url);
            }

            const workletNode = new AudioWorkletNode(
              captureCtx,
              "capture-processor"
            );
            captureWorkletNodes.push(workletNode);

            let chunkCount = 0;
            workletNode.port.onmessage = (event) => {
              if (event.data.type !== "audio-data") return;

              // Echo gate: suppress capture while TTS is playing or cooling down
              if (ttsPlaying) return;

              const buffer = event.data.buffer as Float32Array;
              const bytes = new Uint8Array(buffer.buffer);
              let binary = "";
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(
                  null,
                  Array.from(bytes.subarray(i, i + chunkSize))
                );
              }
              (window as any).__onSpaceAudio(btoa(binary), 16000);
              chunkCount++;
              if (chunkCount % 50 === 0) {
                (window as any).__audioLog(
                  "Captured " + chunkCount + " audio chunks (worklet)"
                );
              }
            };

            source.connect(workletNode);
            // AudioWorklet nodes don't need to connect to destination
            // but we do it for Chrome compatibility
            workletNode.connect(captureCtx.destination);
          } else {
            // Fallback: ScriptProcessorNode for older browsers
            (window as any).__audioLog(
              "AudioWorklet unavailable, falling back to ScriptProcessor"
            );
            const processor = captureCtx.createScriptProcessor(4096, 1, 1);
            let chunkCount = 0;
            processor.onaudioprocess = (e: AudioProcessingEvent): void => {
              if (ttsPlaying) return;

              const pcm = e.inputBuffer.getChannelData(0);
              let maxVal = 0;
              for (let i = 0; i < pcm.length; i++) {
                const abs = Math.abs(pcm[i]);
                if (abs > maxVal) maxVal = abs;
              }
              if (maxVal < 0.001) return;
              const bytes = new Uint8Array(
                pcm.buffer.slice(
                  pcm.byteOffset,
                  pcm.byteOffset + pcm.byteLength
                )
              );
              let binary = "";
              const chunk = 8192;
              for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode.apply(
                  null,
                  Array.from(bytes.subarray(i, i + chunk))
                );
              }
              (window as any).__onSpaceAudio(btoa(binary), 16000);
              chunkCount++;
              if (chunkCount % 50 === 0) {
                (window as any).__audioLog(
                  "Captured " + chunkCount + " audio chunks (ScriptProcessor)"
                );
              }
            };
            source.connect(processor);
            processor.connect(captureCtx.destination);
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          (window as any).__audioLog("Audio capture error: " + message);
        }
      }
    },
    captureWorkletCode,
    injectionWorkletCode
  );
}

/**
 * Dispose all audio resources created by injectAudioHooks in the given page.
 * Call this when the agent leaves a space to prevent memory leaks.
 */
export async function disposeAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    if ((window as any).__disposeAudio) {
      (window as any).__disposeAudio();
    }
  });
}

/**
 * Decode MP3 to PCM Float32 using the browser's built-in AudioContext.decodeAudioData.
 * Eliminates the ffmpeg dependency for MP3 decoding.
 */
export async function mp3ToPcmFloat32Browser(
  page: Page,
  mp3Buffer: Buffer
): Promise<Float32Array> {
  const base64 = mp3Buffer.toString("base64");
  const pcmArray: number[] = await page.evaluate(
    async (b64: string) => {
      if ((window as any).__decodeMp3) {
        return (window as any).__decodeMp3(b64);
      }
      throw new Error("Audio bridge not initialized — __decodeMp3 unavailable");
    },
    base64
  );
  return new Float32Array(pcmArray);
}

/**
 * Inject TTS audio into the Space with proper duration-based timing.
 * Uses the browser's AudioContext for MP3 decoding (no ffmpeg needed).
 */
export async function injectAudio(
  page: Page,
  mp3Buffer: Buffer,
  ttsCooldownMs: number = 300
): Promise<{ durationMs: number }> {
  // Decode MP3 in the browser — no ffmpeg child process needed
  const pcmData = await mp3ToPcmFloat32Browser(page, mp3Buffer);

  const sampleRate = 48000;
  const durationMs = (pcmData.length / sampleRate) * 1000;
  const CHUNK_SIZE = 4096; // ~85ms at 48kHz

  // Signal echo gate: mute capture while TTS is playing
  await page.evaluate(() => {
    if ((window as any).__setTTSPlaying)
      (window as any).__setTTSPlaying(true);
  });

  try {
    // Enqueue all chunks to the injection worklet
    for (let offset = 0; offset < pcmData.length; offset += CHUNK_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, pcmData.length);
      const chunk = pcmData.slice(offset, end);
      const chunkArray = Array.from(chunk);
      await page.evaluate((arr: number[]) => {
        if ((window as any).__injectAudioChunk) {
          // Re-encode as base64 for the existing injection API
          const float32 = new Float32Array(arr);
          const bytes = new Uint8Array(float32.buffer);
          let binary = "";
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(
              null,
              Array.from(bytes.subarray(i, i + chunkSize))
            );
          }
          (window as any).__injectAudioChunk(btoa(binary));
        }
      }, chunkArray);
    }

    // Wait for actual playback duration (not estimated from chunk count)
    await new Promise<void>((r) => setTimeout(r, durationMs + 100));
  } finally {
    // Re-enable capture after cooldown
    await page.evaluate((ms: number) => {
      if ((window as any).__setTTSPlaying)
        (window as any).__setTTSPlaying(false, ms);
    }, ttsCooldownMs);
  }

  return { durationMs };
}

/**
 * Legacy ffmpeg-based MP3 to PCM conversion.
 * Kept as a fallback for environments where browser decoding isn't available
 * (e.g., headless Chrome without audio codec support).
 */
export function mp3ToPcmFloat32(mp3Buffer: Buffer): Buffer {
  // Lazy imports to avoid loading fs/child_process unless needed
  const fs = require("fs") as typeof import("fs");
  const { execSync } = require("child_process") as typeof import("child_process");

  let hasFFmpeg = false;
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    hasFFmpeg = true;
  } catch {
    // ffmpeg not available
  }

  if (!hasFFmpeg) {
    throw new Error(
      "ffmpeg required for MP3 to PCM conversion (fallback mode). " +
        "Install ffmpeg or use browser-based decoding via injectAudio()."
    );
  }

  const tmpIn = "/tmp/agent-tts-input.mp3";
  const tmpOut = "/tmp/agent-tts-output.raw";
  fs.writeFileSync(tmpIn, mp3Buffer);
  execSync(
    `ffmpeg -y -i ${tmpIn} -f f32le -acodec pcm_f32le -ac 1 -ar 48000 ${tmpOut} 2>/dev/null`
  );
  const pcmBuffer = fs.readFileSync(tmpOut);
  try {
    fs.unlinkSync(tmpIn);
  } catch {
    // ignore cleanup errors
  }
  try {
    fs.unlinkSync(tmpOut);
  } catch {
    // ignore cleanup errors
  }
  return pcmBuffer;
}

/** Convert PCM Float32 chunks to WAV format for STT processing. */
export function pcmChunksToWav(
  pcmChunks: Buffer[],
  sampleRate: number = 16000
): Buffer {
  const pcmData = Buffer.concat(pcmChunks);
  const float32 = new Float32Array(
    pcmData.buffer,
    pcmData.byteOffset,
    pcmData.byteLength / 4
  );
  const int16 = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2);
  }

  const dataSize = int16.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, int16]);
}


