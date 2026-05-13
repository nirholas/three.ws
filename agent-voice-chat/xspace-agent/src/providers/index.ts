// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§89]

import { config } from "../config.js";
import { createChildLogger } from "../utils/logger.js";
import type { LLMProvider } from "../types.js";

const log = createChildLogger("providers");

export function createLLMProvider(): LLMProvider {
  log.info("Creating LLM provider: %s", config.aiProvider);

  switch (config.aiProvider) {
    case "claude": {
      const { ClaudeLLM } = require("./llm/claude.js") as {
        ClaudeLLM: new () => LLMProvider;
      };
      return new ClaudeLLM();
    }
    case "groq": {
      const { GroqLLM } = require("./llm/groq.js") as {
        GroqLLM: new () => LLMProvider;
      };
      return new GroqLLM();
    }
    case "openai-chat": {
      const { OpenAIChatLLM } = require("./llm/openai-chat.js") as {
        OpenAIChatLLM: new () => LLMProvider;
      };
      return new OpenAIChatLLM();
    }
    case "openai":
    default: {
      const { OpenAIRealtimeLLM } = require("./llm/openai-realtime.js") as {
        OpenAIRealtimeLLM: new () => LLMProvider;
      };
      return new OpenAIRealtimeLLM();
    }
  }
}

export { createSTTProvider } from "./stt.js";
export { createTTSProvider } from "./tts.js";


