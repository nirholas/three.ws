# ThreeWs.SemanticKernel

A [Semantic Kernel](https://github.com/microsoft/semantic-kernel) plugin for
[three.ws](https://three.ws), usable from Semantic Kernel and from Microsoft
Agent Framework. It gives an agent six native functions on the three.ws HTTP API
(generate a textured 3D model from text, poll a generation, search ready-made 3D
assets, list your agents, search public agents, message an agent) and a one-line
attach for the free three.ws 3D Studio MCP server.

Every function returns compact JSON the model can read: `{"ok":true,...}` on
success, `{"ok":false,"error":"...","code":"..."}` when something needs a
different input, a key, or a retry. Failures never throw into the kernel.

## Install

```bash
dotnet add package ThreeWs.SemanticKernel
```

Targets .NET 8. Depends on `Microsoft.SemanticKernel.Core` 1.82 and the
official `ModelContextProtocol` 2.4 SDK.

## Auth

Generation, asset search, the public agent directory and messaging work with no
account and no key. Only `list_my_agents` needs a key.

| Variable | Needed for | Default |
|---|---|---|
| `THREE_WS_API_KEY` | `list_my_agents` (create one at [three.ws/dashboard/api](https://three.ws/dashboard/api)) | unset |
| `THREE_WS_BASE_URL` | pointing at another deployment | `https://three.ws` |

`ThreeWsClient.FromEnvironment()` reads both. You can also pass them to
`new ThreeWsClient(baseUrl, apiKey)`.

## The functions

| Function | What it does | Key |
|---|---|---|
| `generate_3d_model(prompt, tier = "standard")` | Text to a textured GLB. Waits up to 4 minutes (configurable) and retries once on a transient GPU failure; if the model is still cooking it returns the `job_id`. Tiers: `draft`, `standard`, `high`. | no |
| `get_3d_job_status(job_id)` | Status of a generation, with `glb_url` and `viewer_url` once done. | no |
| `find_3d_asset(query, kind = "", limit = 5)` | Search thousands of ready-made CC0 props (`object`), rigged characters (`character`) and motion clips (`animation`). | no |
| `list_my_agents()` | The agents on your account, with their public pages. | yes |
| `search_public_agents(query = "", limit = 5)` | The public three.ws agent directory. | no |
| `message_agent(message, agent_id = null)` | Send a message to a three.ws agent (or the default three.ws assistant) and get its reply. | no |

## Example: Semantic Kernel chat with auto function calling

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using ThreeWs.SemanticKernel;

var builder = Kernel.CreateBuilder();
builder.AddOpenAIChatCompletion("gpt-5.4-mini", Environment.GetEnvironmentVariable("OPENAI_API_KEY")!);
builder.Plugins.AddFromObject(new ThreeWsPlugin(), "threews");
var kernel = builder.Build();

var chat = kernel.GetRequiredService<IChatCompletionService>();
var history = new ChatHistory("You make 3D assets with the threews tools. Return real links only.");
history.AddUserMessage("Find a ready-made lantern, then generate a weathered bronze ship's lantern.");
var settings = new OpenAIPromptExecutionSettings { FunctionChoiceBehavior = FunctionChoiceBehavior.Auto() };
var reply = await chat.GetChatMessageContentAsync(history, settings, kernel);
Console.WriteLine(reply);
```

`AddOpenAIChatCompletion` comes from `Microsoft.SemanticKernel.Connectors.OpenAI`;
with Azure OpenAI use `AddAzureOpenAIChatCompletion` instead.

## Example: Microsoft Agent Framework

A `KernelFunction` is an `AIFunction`, so Agent Framework takes the plugin's
functions as they are, next to the MCP studio tools:

```csharp
using var threeWs = ThreeWsClient.FromEnvironment();
var plugin = KernelPluginFactory.CreateFromObject(new ThreeWsPlugin(threeWs), "threews");
await using var studio = await ThreeWsMcp.ConnectAsync();

var tools = new List<AITool>();
tools.AddRange(plugin);                                    // native functions
tools.AddRange(await studio.ListToolsAsync());             // 16 MCP studio tools

AIAgent agent = chatClient.AsAIAgent(instructions: "...", tools: tools);
```

The full runnable sample is in
[`../agent-framework/dotnet`](../agent-framework/dotnet).

## Example: the MCP Studio server in a kernel

```csharp
await using var studio = await kernel.AddThreeWsStudioMcpAsync();   // plugin "threews_studio"
```

It connects to `https://three.ws/api/mcp-studio` over Streamable HTTP and adds
all 16 studio tools (generation, rigging, avatars, model inspection, docs search)
as one plugin. Keep the returned client alive while the kernel uses the tools.

## Use the client directly

```csharp
using var client = ThreeWsClient.FromEnvironment();
var job = await client.GenerateModelAsync("a carved wooden owl figurine", tier: "draft");
Console.WriteLine($"{job.GlbUrl}\n{job.ViewerUrl}");
```

## Tests

The xUnit tests call the real three.ws API; nothing is mocked.

```bash
dotnet test tests/ThreeWs.SemanticKernel.Tests --filter "Category!=Slow"   # about 1 minute
dotnet test tests/ThreeWs.SemanticKernel.Tests                             # adds one real GPU generation
```

Set `THREE_WS_API_KEY` to also run the signed-in `list_my_agents` test.

## Publish (maintainers)

```bash
dotnet pack src/ThreeWs.SemanticKernel -c Release -o dist
dotnet nuget push dist/ThreeWs.SemanticKernel.0.1.0.nupkg \
  --source https://api.nuget.org/v3/index.json --api-key "$NUGET_API_KEY"
```

Bump `<Version>` in the csproj before each release. After the first push,
switch the Agent Framework sample's `ProjectReference` to a `PackageReference`.

## Related

- [Python package](../semantic-kernel-python/) with the same functions
- [Agent Framework samples](../agent-framework/)
- [three.ws on the Microsoft agent stack](../../../docs/microsoft-agent-stack.md)

Microsoft, Semantic Kernel and Microsoft Agent Framework are trademarks of the
Microsoft group of companies. License: Apache-2.0.
