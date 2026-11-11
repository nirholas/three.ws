"""Microsoft Agent Framework (Python) sample: an agent that designs a 3D prop for a scene.

The agent gets the free three.ws 3D Studio MCP server as its only tool source.
Given a scene, it picks the hero prop, checks the ready-made catalog, then
generates a custom textured GLB and returns real, downloadable URLs.

Run:
    pip install -r requirements.txt
    export OPENAI_API_KEY=...            # any OpenAI-compatible provider works
    python design_prop.py "a lighthouse keeper's desk on a stormy night"

Optional:
    OPENAI_BASE_URL     an OpenAI-compatible endpoint (Groq, OpenRouter, Ollama, ...)
    THREE_WS_MODEL      chat model id (default gpt-5.4-mini)
    THREE_WS_BASE_URL   three.ws origin (default https://three.ws)
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

from agent_framework import Agent, MCPStreamableHTTPTool
from agent_framework.openai import OpenAIChatCompletionClient

INSTRUCTIONS = """\
You are a prop designer for 3D scenes. For the scene the user describes:
1. Pick the single most important prop the scene needs and say why in one sentence.
2. Call search_catalog for that prop (kind "object", limit 3) and note the closest ready-made match.
3. Call forge_free with a vivid single-object prompt for a custom version of the prop, tier "draft".
4. If forge_free returns a pending job instead of a model, call check_job with its job_id
   until the job is done or failed. Never invent a URL.
5. Finish with exactly these lines:
   PROP: <name>
   MODEL: <glb url from the tool result>
   VIEWER: <viewer url from the tool result>
   CATALOG MATCH: <title and glb url, or "none">
"""


async def main(scene: str) -> int:
    base = os.environ.get("THREE_WS_BASE_URL", "https://three.ws").rstrip("/")
    client = OpenAIChatCompletionClient(
        model=os.environ.get("THREE_WS_MODEL", "gpt-5.4-mini"),
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=os.environ.get("OPENAI_BASE_URL") or None,
    )
    studio = MCPStreamableHTTPTool(
        name="threews_studio",
        url=f"{base}/api/mcp-studio",
        description="three.ws free 3D Studio: search ready-made assets and generate 3D models.",
        allowed_tools=["search_catalog", "forge_free", "check_job"],
        # A generation can hold the call open for a few minutes before it answers.
        request_timeout=300,
        load_prompts=False,
    )
    started = time.monotonic()
    async with studio:
        agent = Agent(client, INSTRUCTIONS, name="prop-designer", tools=[studio])
        print(f"scene: {scene}\n", flush=True)
        response = await agent.run(scene)
    print(response.text)
    print(f"\n[{time.monotonic() - started:.0f}s]")
    return 0 if "MODEL: https://" in response.text else 1


if __name__ == "__main__":
    scene_arg = " ".join(sys.argv[1:]) or "a lighthouse keeper's desk on a stormy night"
    sys.exit(asyncio.run(main(scene_arg)))
