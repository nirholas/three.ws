// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import axios from "axios";
import { config } from "../../config.js";
import { createChildLogger } from "../../utils/logger.js";
import type { LLMProvider } from "../../types.js";

const log = createChildLogger("llm:openai-chat");

interface MessageParam {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenAIChatLLM implements LLMProvider {
  readonly type = "socket" as const;
  private apiKey: string;
  private model: string;
  private history: Record<number, MessageParam[]> = {};

  constructor() {
    if (!config.openaiApiKey)
      throw new Error("OPENAI_API_KEY is required for OpenAI Chat provider");
    this.apiKey = config.openaiApiKey;
    this.model = config.openaiModel;
    log.info("Initialized with model: %s", this.model);
  }

  private addToHistory(
    agentId: number,
    role: "user" | "assistant",
    content: string,
  ): void {
    if (!this.history[agentId]) this.history[agentId] = [];
    this.history[agentId]!.push({ role, content });
    if (this.history[agentId]!.length > 20) {
      this.history[agentId] = this.history[agentId]!.slice(-20);
    }
  }

  async *streamResponse(
    agentId: number,
    userText: string,
    systemPrompt: string,
  ): AsyncGenerator<string, void, unknown> {
    this.addToHistory(agentId, "user", userText);

    const messages: MessageParam[] = [
      { role: "system", content: systemPrompt },
      ...(this.history[agentId] ?? []),
    ];

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: this.model,
        messages,
        max_tokens: config.maxTokens,
        stream: true,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        responseType: "stream",
        timeout: config.providerTimeout,
      },
    );

    let fullResponse = "";

    for await (const chunk of response.data as AsyncIterable<Buffer>) {
      const lines = chunk
        .toString()
        .split("\n")
        .filter((l: string) => l.startsWith("data: "));
      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            yield delta;
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    this.addToHistory(agentId, "assistant", fullResponse);
  }

  clearHistory(agentId: number): void {
    this.history[agentId] = [];
  }
}


