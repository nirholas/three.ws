# Microsoft Agent Framework samples: the prop designer

Two runnable [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
agents, one in Python and one in .NET, that design a 3D prop for a scene. Given a
scene ("a lighthouse keeper's desk on a stormy night") each agent:

1. picks the single prop the scene most needs,
2. searches the free three.ws catalog for a ready-made match,
3. generates a custom textured GLB with three.ws, waiting for the job,
4. ends with real, downloadable `MODEL:` and `VIEWER:` URLs.

Neither sample needs a three.ws account or key. Both need an OpenAI-compatible
chat model that supports tool calling.

| Sample | Tool source | Path |
|---|---|---|
| Python | the three.ws 3D Studio MCP server only (`search_catalog`, `forge_free`, `check_job`) | [`python/design_prop.py`](python/design_prop.py) |
| .NET | MCP `search_catalog` plus the [ThreeWs.SemanticKernel](../semantic-kernel-dotnet/) plugin's `generate_3d_model` and `get_3d_job_status` | [`dotnet/Program.cs`](dotnet/Program.cs) |

The .NET sample takes the plugin's functions from
`ThreeWsPlugin.CreateAITools()`, which binds each Semantic Kernel function to a
`Kernel` so it runs inside Agent Framework's function invocation.

## Python

```bash
cd python
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=...
python design_prop.py "a lighthouse keeper's desk on a stormy night"
```

`requirements.txt` pins `tenacity` explicitly: `agent-framework-core` 1.25
imports it for MCP reconnects without declaring it.

## .NET

```bash
cd dotnet
export OPENAI_API_KEY=...
dotnet run -- "an alchemist's workbench in a candlelit tower"
```

The project references the plugin source through a `ProjectReference`. Once
`ThreeWs.SemanticKernel` is on NuGet, swap it for the `PackageReference` shown
in the csproj comment.

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `OPENAI_API_KEY` | key for the chat model provider | required |
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint (Azure OpenAI v1, Groq, NVIDIA NIM, Ollama, llama.cpp, ...) | OpenAI |
| `THREE_WS_MODEL` | chat model id; it must support tool calling | `gpt-5.4-mini` |
| `THREE_WS_BASE_URL` | three.ws origin | `https://three.ws` |

Each sample exits 0 only when the answer contains a real `MODEL: https://` line,
so either one works as a smoke test in a script.

## What a run looks like

A free generation usually takes one to three minutes. When the GPU pool is busy,
`forge_free` says so and the Python agent retries up to three times. The .NET
plugin waits up to four minutes and retries one transient GPU failure itself.

## Related

- [Python Semantic Kernel package](../semantic-kernel-python/)
- [.NET Semantic Kernel package](../semantic-kernel-dotnet/)
- [Foundry quickstart for the MCP studio](../../../docs/mcp-tools.md#quickstart-attach-the-studio-to-a-foundry-agent)
- [three.ws on the Microsoft agent stack](../../../docs/microsoft-agent-stack.md)

Microsoft, Microsoft Agent Framework, Semantic Kernel, Azure and Microsoft
Foundry are trademarks of the Microsoft group of companies.
