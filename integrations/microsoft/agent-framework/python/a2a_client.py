"""Call a three.ws agent over A2A with Microsoft Agent Framework's A2A client.

Three live calls against the three.ws A2A endpoint, using `A2AAgent` from
agent-framework-a2a (which sits on the a2a-sdk client and speaks A2A 1.0):

  1. a plain question, answered in one response,
  2. a Forge 3D generation, streamed (SSE) to its GLB,
  3. a second generation, canceled while it runs.

No three.ws account or key is needed. Pass THREE_WS_API_KEY to call as an
account (sent as the X-API-Key header the agent card declares).

    pip install -r requirements-a2a.txt
    python a2a_client.py                      # https://three.ws
    THREE_WS_BASE_URL=http://localhost:3142 python a2a_client.py

Exit code 0 only when all three calls behaved: a non-empty answer, a streamed
GLB URL, and a task that ends `canceled`.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

import httpx
from a2a.client import A2ACardResolver
from a2a.types import CancelTaskRequest, GetTaskRequest, Message, Part, Role, SendMessageRequest, TaskState
from agent_framework_a2a import A2AAgent

BASE_URL = os.environ.get("THREE_WS_BASE_URL", "https://three.ws").rstrip("/")
API_KEY = os.environ.get("THREE_WS_API_KEY")
PROMPT = os.environ.get("THREE_WS_PROMPT", "a small ceramic robot figurine")


def say(label: str, text: str) -> None:
    print(f"[{label}] {text}", flush=True)


def user_message(text: str) -> Message:
    return Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER, parts=[Part(text=text)])


async def main() -> int:
    headers = {"x-api-key": API_KEY} if API_KEY else {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=600), headers=headers) as http:
        # The card an A2A platform reads. The endpoint-relative path is the one
        # Copilot Studio probes after you paste the endpoint URL.
        card = await A2ACardResolver(http, f"{BASE_URL}/api/agents/a2a-paid").get_agent_card(
            relative_card_path="/.well-known/agent.json"
        )
        # The card names the production endpoint. Aim every interface at the base
        # URL in use, so a local or staging server is exercised, not production.
        for interface in card.supported_interfaces:
            interface.url = interface.url.replace("https://three.ws", BASE_URL, 1)
        say("card", f"{card.name}, streaming={card.capabilities.streaming}, skills={[s.id for s in card.skills]}")

        async with A2AAgent(agent_card=card, http_client=http) as agent:
            # 1. A plain question.
            answer = await agent.run("List the paid service catalog")
            text = answer.text.strip()
            say("question", text[:300])
            if not text:
                return 1

            # 2. A streamed generation.
            say("stream", f"asking for {PROMPT!r}")
            glb = None
            updates = 0
            async for update in agent.run(f"Generate a 3D model of {PROMPT}", stream=True):
                updates += 1
                if update.text:
                    say("stream", update.text.strip()[:200])
                for content in update.contents:
                    uri = getattr(content, "uri", None)
                    if uri and uri.endswith(".glb"):
                        glb = uri
            say("stream", f"{updates} updates, GLB: {glb}")
            if not glb:
                return 1

            # 3. A cancel. Start a generation on the raw client, take the task
            # id from the first event, cancel it, and read the task back.
            request = SendMessageRequest(message=user_message(f"Generate a 3D model of {PROMPT}, brass finish"))
            task_id = None
            async for event in agent.client.send_message(request):
                if event.HasField("task"):
                    task_id = event.task.id
                    break
                if event.HasField("status_update"):
                    task_id = event.status_update.task_id
                    break
            if not task_id:
                return 1
            canceled = await agent.client.cancel_task(CancelTaskRequest(id=task_id))
            say("cancel", f"task {task_id} -> {TaskState.Name(canceled.status.state)}")
            after = await agent.client.get_task(GetTaskRequest(id=task_id))
            say("cancel", f"read back -> {TaskState.Name(after.status.state)}")
            if after.status.state != TaskState.TASK_STATE_CANCELED:
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
