// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import axios from "axios";
import FormData from "form-data";
import { config } from "../config.js";
import { createChildLogger } from "../utils/logger.js";
import type { STTProvider } from "../types.js";

const log = createChildLogger("stt");

class GroqSTT implements STTProvider {
  async transcribe(
    audioBuffer: Buffer,
    mimeType = "audio/webm",
  ): Promise<{ text: string }> {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error("Missing GROQ_API_KEY for STT");

    const ext = mimeType.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: `audio.${ext}`,
      contentType: mimeType,
    });
    form.append("model", "whisper-large-v3");

    const response = await axios.post(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: config.providerTimeout,
      },
    );

    const text = (response.data as { text?: string }).text ?? "";
    if (text) log.debug('Transcribed: "%s"', text);
    return { text };
  }
}

class OpenAISTT implements STTProvider {
  async transcribe(
    audioBuffer: Buffer,
    mimeType = "audio/webm",
  ): Promise<{ text: string }> {
    const apiKey = config.openaiApiKey;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY for STT");

    const ext = mimeType.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: `audio.${ext}`,
      contentType: mimeType,
    });
    form.append("model", "whisper-1");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: config.providerTimeout,
      },
    );

    const text = (response.data as { text?: string }).text ?? "";
    if (text) log.debug('Transcribed: "%s"', text);
    return { text };
  }
}

export function createSTTProvider(): STTProvider {
  log.info("Using STT provider: %s", config.sttProvider);
  switch (config.sttProvider) {
    case "openai":
      return new OpenAISTT();
    case "groq":
    default:
      return new GroqSTT();
  }
}


