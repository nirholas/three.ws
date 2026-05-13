// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import axios from "axios";
import { config } from "../../config.js";
import { createChildLogger } from "../../utils/logger.js";
import type { LLMProvider, SessionData } from "../../types.js";

const log = createChildLogger("llm:openai-realtime");

export class OpenAIRealtimeLLM implements LLMProvider {
  readonly type = "webrtc" as const;
  private apiKey: string;
  private model: string;

  constructor() {
    if (!config.openaiApiKey)
      throw new Error("OPENAI_API_KEY is required for OpenAI Realtime provider");
    this.apiKey = config.openaiApiKey;
    this.model = config.openaiRealtimeModel;
    log.info("Initialized with model: %s", this.model);
  }

  async *streamResponse(
    _agentId: number,
    _userText: string,
    _systemPrompt: string,
  ): AsyncGenerator<string, void, unknown> {
    // WebRTC mode — streaming is handled client-side
    yield "";
  }

  async createSession(
    agentId: number,
    prompts: Record<number, string>,
    voices: Record<number, string>,
  ): Promise<SessionData> {
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      {
        model: this.model,
        modalities: ["audio", "text"],
        voice: voices[agentId],
        instructions: prompts[agentId],
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: config.providerTimeout,
      },
    );

    return response.data as SessionData;
  }
}


