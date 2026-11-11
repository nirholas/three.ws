# three.ws on the Microsoft agent stack

three.ws gives an agent built with Microsoft's agent tools the ability to make and
find 3D content: free text-to-3D generation (a textured GLB plus a browser viewer
link), a catalog of thousands of ready-made CC0 props, rigged characters and
motion clips, and messaging with three.ws AI agents. There are three ways in,
and they share one backend, so pick by the stack you already use.

| You build with | Use | Install |
|---|---|---|
| Semantic Kernel (Python) | [`threews-semantic-kernel`](../integrations/microsoft/semantic-kernel-python/) | `pip install threews-semantic-kernel` |
| Semantic Kernel (.NET) | [`ThreeWs.SemanticKernel`](../integrations/microsoft/semantic-kernel-dotnet/) | `dotnet add package ThreeWs.SemanticKernel` |
| Microsoft Agent Framework (Python or .NET) | the MCP studio server, plus the .NET plugin if you like | [samples](../integrations/microsoft/agent-framework/) |
| Foundry Agent Service | the MCP studio server as a remote MCP tool | [quickstart](mcp-tools.md#quickstart-attach-the-studio-to-a-foundry-agent) |
| Microsoft 365 Copilot and Teams | the declarative agent | [copilot-teams](../integrations/microsoft/copilot-teams/) |

## The two surfaces

**Native plugin functions** (Semantic Kernel packages). Six functions that call
the three.ws REST API directly:

| Function | Does | Key |
|---|---|---|
| `generate_3d_model` | text to a textured GLB; waits for the job and retries one transient GPU failure | no |
| `get_3d_job_status` | status of a generation, with `glb_url` and `viewer_url` once done | no |
| `find_3d_asset` | search the free catalog (`object`, `character`, `animation`) | no |
| `list_my_agents` | agents on your three.ws account | yes |
| `search_public_agents` | the public agent directory | no |
| `message_agent` | send a message to a three.ws agent and get its reply | no |

Every function returns JSON with `ok: true` or `ok: false` plus an `error` and a
`code`, so the model can explain or retry instead of the turn failing.

**The MCP studio server** at `https://three.ws/api/mcp-studio`. Streamable HTTP,
free, no key, 16 tools (generation, rigging, avatars, model inspection, docs
search). Any MCP client works: Agent Framework's `MCPStreamableHTTPTool` (Python)
or the `ModelContextProtocol` client (.NET), Semantic Kernel's MCP plugin, and
Foundry's remote MCP tool. Both SK packages include a one-line attach:
`create_three_ws_mcp_plugin()` in Python, `kernel.AddThreeWsStudioMcpAsync()` in
.NET. The full tool list is in [mcp-tools.md](mcp-tools.md).

The tool schemas use only plain JSON Schema types (no `anyOf`, `allOf`, `oneOf`
or multi-type unions) and advertise only spec-conformant `_meta` keys, which is
what Foundry and Agent Framework's strict MCP validation require.

## Auth

Generation, catalog search, the public directory and messaging need nothing. A
three.ws API key (create one at [three.ws/dashboard/api](https://three.ws/dashboard/api))
is only needed to list your own agents. Both packages read `THREE_WS_API_KEY`
and `THREE_WS_BASE_URL` from the environment.

## Timing

A free draft generation usually lands in one to three minutes. The plugins wait
for it. Over MCP, `forge_free` answers within 40 seconds with either the model or
a pending `job_id` that `get_job` collects, so clients with a short tool-call
timeout (Foundry's is 100 seconds for a non-streaming MCP call) never lose a
generation. When the GPU pool is busy the tool says so and the agent can retry.

## Verify it yourself

Each package ships live tests that call the real API (nothing is mocked):

```bash
cd integrations/microsoft/semantic-kernel-python && pip install -e ".[test]" && pytest
cd integrations/microsoft/semantic-kernel-dotnet && dotnet test tests/ThreeWs.SemanticKernel.Tests
```

The Agent Framework samples exit 0 only when the agent returns a real model URL.

Microsoft, Semantic Kernel, Microsoft Agent Framework, Microsoft Foundry, Azure,
Microsoft 365 Copilot and Microsoft Teams are trademarks of the Microsoft group
of companies.
