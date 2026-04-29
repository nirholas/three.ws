// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { createChildLogger } from "../../utils/logger.js";
import type { LLMProvider } from "../../types.js";

const log = createChildLogger("llm:claude");

interface MessageParam {
  role: "user" | "assistant";
  content: string;
}

export class ClaudeLLM implements LLMProvider {
  readonly type = "socket" as const;
  private client: Anthropic;
  private model: string;
  private history: Record<number, MessageParam[]> = {};

  constructor() {
    if (!config.anthropicApiKey)
      throw new Error("ANTHROPIC_API_KEY is required for Claude provider");
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    this.model = config.claudeModel;
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

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: this.history[agentId] ?? [],
    });

    let fullResponse = "";

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta &&
        "text" in event.delta
      ) {
        const text = event.delta.text;
        fullResponse += text;
        yield text;
      }
    }

    this.addToHistory(agentId, "assistant", fullResponse);
  }

  clearHistory(agentId: number): void {
    this.history[agentId] = [];
  }
}


