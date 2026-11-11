"""Semantic Kernel chat agent that finds and generates 3D assets with the three.ws plugin.

Run:
    pip install threews-semantic-kernel
    export OPENAI_API_KEY=...          # any OpenAI-compatible provider works
    python examples/chat_agent.py "a weathered bronze ship's lantern"

Optional:
    OPENAI_BASE_URL     an OpenAI-compatible endpoint (Groq, OpenRouter, Ollama, ...)
    THREE_WS_MODEL      chat model id (default gpt-5.4-mini)
    THREE_WS_BASE_URL   three.ws origin (default https://three.ws)
"""

from __future__ import annotations

import asyncio
import os
import sys

from openai import AsyncOpenAI
from semantic_kernel import Kernel
from semantic_kernel.connectors.ai import FunctionChoiceBehavior
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion, OpenAIChatPromptExecutionSettings
from semantic_kernel.contents import ChatHistory

from threews_semantic_kernel import ThreeWsPlugin

SYSTEM = (
    "You make 3D assets with the threews tools. First call find_3d_asset for a ready-made match, "
    "then call generate_3d_model with tier draft for a custom version. If it returns a job_id that is "
    "not done, call get_3d_job_status until it is. Reply with the catalog match and the generated "
    "model's glb_url and viewer_url. Never invent a URL."
)


async def main(subject: str) -> int:
    kernel = Kernel()
    chat = OpenAIChatCompletion(
        ai_model_id=os.environ.get("THREE_WS_MODEL", "gpt-5.4-mini"),
        async_client=AsyncOpenAI(base_url=os.environ.get("OPENAI_BASE_URL") or None, timeout=600),
    )
    kernel.add_service(chat)
    kernel.add_plugin(ThreeWsPlugin(), plugin_name="threews")

    history = ChatHistory(system_message=SYSTEM)
    history.add_user_message(f"I need a 3D model of {subject}.")
    settings = OpenAIChatPromptExecutionSettings(function_choice_behavior=FunctionChoiceBehavior.Auto())
    reply = await chat.get_chat_message_content(history, settings, kernel=kernel)
    text = str(reply)
    print(text)
    return 0 if "https://" in text else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(" ".join(sys.argv[1:]) or "a weathered bronze ship's lantern")))
