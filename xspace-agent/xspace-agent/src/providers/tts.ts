// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

import axios from "axios";
import { config } from "../config.js";
import { createChildLogger } from "../utils/logger.js";
import type { TTSProvider } from "../types.js";

const log = createChildLogger("tts");

const openaiVoiceMap: Record<number, string> = {
  0: "onyx",
  1: "nova",
};

class OpenAITTS implements TTSProvider {
  async synthesize(text: string, agentId = 0): Promise<Buffer | null> {
    const apiKey = config.openaiApiKey;
    if (!apiKey) return null;

    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "tts-1",
        input: text,
        voice: openaiVoiceMap[agentId] ?? "alloy",
        response_format: "mp3",
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: config.providerTimeout,
      },
    );

    return Buffer.from(response.data as ArrayBuffer);
  }
}

class ElevenLabsTTS implements TTSProvider {
  private voiceMap: Record<number, string> = {
    0: config.elevenlabsVoice0,
    1: config.elevenlabsVoice1,
  };

  async synthesize(text: string, agentId = 0): Promise<Buffer | null> {
    const apiKey = config.elevenlabsApiKey;
    if (!apiKey) return null;

    const voiceId = this.voiceMap[agentId] ?? this.voiceMap[0]!;
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
        timeout: config.providerTimeout,
      },
    );

    return Buffer.from(response.data as ArrayBuffer);
  }
}

class BrowserTTS implements TTSProvider {
  async synthesize(_text: string, _agentId = 0): Promise<null> {
    // Browser TTS returns null — the client handles synthesis
    return null;
  }
}

export function createTTSProvider(): TTSProvider {
  log.info("Using TTS provider: %s", config.ttsProvider);
  switch (config.ttsProvider) {
    case "elevenlabs":
      return new ElevenLabsTTS();
    case "openai":
      return new OpenAITTS();
    case "browser":
    default:
      return new BrowserTTS();
  }
}


