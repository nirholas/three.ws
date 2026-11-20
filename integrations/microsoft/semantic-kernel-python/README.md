# threews-semantic-kernel

A [Semantic Kernel](https://github.com/microsoft/semantic-kernel) plugin for
[three.ws](https://three.ws). It gives an SK agent six native functions on the
three.ws HTTP API (generate a textured 3D model from text, poll a generation,
search ready-made 3D assets, list your agents, search public agents, message an
agent) and one helper that attaches the free three.ws 3D Studio MCP server.

Every function returns a JSON string the model can read: `{"ok": true, ...}` on
success, `{"ok": false, "error": "...", "code": "..."}` when something needs a
different input, a key, or a retry. Errors explain what to do next instead of
raising into the kernel.

## Install

```bash
pip install threews-semantic-kernel          # plugin only
pip install "threews-semantic-kernel[mcp]"   # plus the MCP Studio helper
```

Python 3.10 or newer and `semantic-kernel` 1.30 or newer.

## Auth

Making a 3D model needs a free three.ws account, so every model has an owner who
can publish or delete it (new models are unlisted until you publish them). Create
an API key at [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys)
and set `THREE_WS_API_KEY`. Asset search, job status, the public agent directory
and messaging work without one. Without a key, `generate_3d_model` answers
`{"ok": false, "code": "needs_key"}` with that link before any request is sent.

| Variable | Needed for | Default |
|---|---|---|
| `THREE_WS_API_KEY` | `generate_3d_model`, `list_my_agents` and the MCP Studio tools that make or rig a model | unset |
| `THREE_WS_BASE_URL` | pointing at another deployment | `https://three.ws` |

You can also pass `api_key=` and `base_url=` to `ThreeWsPlugin(...)` or
`ThreeWsClient(...)`.

## The functions

| Function | What it does | Key |
|---|---|---|
| `generate_3d_model(prompt, tier="draft")` | Text to a textured GLB. Waits up to 4 minutes and retries once on a transient GPU failure; if the model is still cooking it returns the `job_id` and a `next_step`. Tiers: `draft`, `standard`, `high`. | yes |
| `get_3d_job_status(job_id)` | Status of a generation, with `glb_url` and a `viewer_url` when done. | no |
| `find_3d_asset(query, kind=None, limit=5)` | Search thousands of ready-made CC0 props (`object`), rigged characters (`character`) and motion clips (`animation`). | no |
| `list_my_agents()` | The agents on your account, with their public pages. | yes |
| `search_public_agents(query="", limit=5)` | The public three.ws agent directory. | no |
| `message_agent(message, agent_id=None)` | Send a message to a three.ws agent (or the default three.ws assistant) and get its reply. | no |

## Example: a chat agent that makes 3D assets

```python
import asyncio
import os

from openai import AsyncOpenAI
from semantic_kernel import Kernel
from semantic_kernel.connectors.ai import FunctionChoiceBehavior
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion, OpenAIChatPromptExecutionSettings
from semantic_kernel.contents import ChatHistory

from threews_semantic_kernel import ThreeWsPlugin


async def main() -> None:
    kernel = Kernel()
    chat = OpenAIChatCompletion(
        ai_model_id=os.environ.get("THREE_WS_MODEL", "gpt-5.4-mini"),
        async_client=AsyncOpenAI(base_url=os.environ.get("OPENAI_BASE_URL")),
    )
    kernel.add_service(chat)
    kernel.add_plugin(ThreeWsPlugin(), plugin_name="threews")

    history = ChatHistory(system_message="You make 3D assets with the threews tools. Return real links only.")
    history.add_user_message("Find a ready-made lantern, then generate a weathered bronze ship's lantern.")
    settings = OpenAIChatPromptExecutionSettings(function_choice_behavior=FunctionChoiceBehavior.Auto())
    reply = await chat.get_chat_message_content(history, settings, kernel=kernel)
    print(reply)


asyncio.run(main())
```

A runnable copy is in [`examples/chat_agent.py`](examples/chat_agent.py). Any
OpenAI-compatible provider works through `OPENAI_BASE_URL`; with Azure OpenAI,
swap in `AzureChatCompletion`.

Call a function directly, without a model:

```python
import json
from semantic_kernel.functions import KernelArguments

result = await kernel.invoke(
    plugin_name="threews",
    function_name="find_3d_asset",
    arguments=KernelArguments(query="chair", kind="object", limit=3),
)
for item in json.loads(str(result))["items"]:
    print(item["title"], item["glb_url"])
```

## Example: the MCP Studio server

The three.ws 3D Studio MCP server (`https://three.ws/api/mcp-studio`) exposes 16
tools, including rigging, avatar generation, model inspection and documentation
search. Attach all of them with one call:

```python
from threews_semantic_kernel import create_three_ws_mcp_plugin

async with create_three_ws_mcp_plugin() as studio:   # plugin name "threews_studio"
    kernel.add_plugin(studio)
    ...
```

The helper sends `THREE_WS_API_KEY` (or `api_key=`) as a bearer, which the
studio's `forge_free`, `mesh_forge`, `forge_avatar` and `rig_mesh` tools need;
without a key they answer `sign_in_required` and the catalog and docs tools
still work. It returns SK's `MCPStreamableHttpPlugin`, so every keyword SK
accepts (`load_prompts`, `headers`, ...) passes through.

## Use the client without Semantic Kernel

```python
import os

from threews_semantic_kernel import ThreeWsClient

async with ThreeWsClient(api_key=os.environ["THREE_WS_API_KEY"]) as client:
    job = await client.generate_model("a carved wooden owl figurine", tier="draft")
    print(job["glb_url"], job["viewer_url"])
```

## Tests

`tests/test_live.py` calls the real three.ws API; nothing is mocked.
`tests/test_account.py` checks the key the client puts on the wire, offline.

```bash
pip install -e ".[test]"
pytest -m "not slow"   # about 1 minute
pytest                 # adds one real GPU generation (a few minutes)
```

Set `THREE_WS_API_KEY` to also run the generation and `list_my_agents` tests;
making a model needs an account, so they skip without one.

## Publish (maintainers)

```bash
python -m pip install --upgrade build twine
python -m build                 # writes dist/threews_semantic_kernel-0.1.0{.tar.gz,-py3-none-any.whl}
python -m twine check dist/*
python -m twine upload dist/*   # PyPI API token as the password, user __token__
```

Bump `version` in `pyproject.toml` and `__version__` in
`src/threews_semantic_kernel/__init__.py` together before each release.

## Related

- [.NET package](../semantic-kernel-dotnet/) with the same functions
- [Agent Framework samples](../agent-framework/)
- [three.ws on the Microsoft agent stack](../../../docs/microsoft-agent-stack.md)

Microsoft and Semantic Kernel are trademarks of the Microsoft group of companies.
License: Apache-2.0.
