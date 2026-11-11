// Microsoft Agent Framework (.NET) sample: an agent that designs a 3D prop for a scene.
//
// Tools come from two places, the two ways a .NET team will wire three.ws:
//   * the ThreeWs.SemanticKernel plugin's native functions (generation that waits
//     for the model and retries a transient GPU failure); a KernelFunction is an
//     AIFunction, so Agent Framework takes them as they are;
//   * the free three.ws 3D Studio MCP server, whose MCP tools are AIFunctions already.
//
// Run:
//   export OPENAI_API_KEY=...        # any OpenAI-compatible provider works
//   dotnet run -- "a lighthouse keeper's desk on a stormy night"
// Optional: OPENAI_BASE_URL, THREE_WS_MODEL (default gpt-5.4-mini), THREE_WS_BASE_URL.

using System.ClientModel;
using System.Diagnostics;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.SemanticKernel;
using OpenAI;
using ThreeWs.SemanticKernel;

const string Instructions = """
    You are a prop designer for 3D scenes. For the scene the user describes:
    1. Pick the single most important prop the scene needs and say why in one sentence.
    2. Call search_catalog for that prop (kind "object", limit 3) and note the closest ready-made match.
    3. Call generate_3d_model with a vivid single-object prompt for a custom version of the prop, tier "draft".
    4. If it returns a job_id with status queued or running, call get_3d_job_status until it is done or failed.
       Never invent a URL.
    5. Finish with exactly these lines:
       PROP: <name>
       MODEL: <glb_url from the tool result>
       VIEWER: <viewer_url from the tool result>
       CATALOG MATCH: <title and glb url, or "none">
    """;

var scene = args.Length > 0 ? string.Join(' ', args) : "a lighthouse keeper's desk on a stormy night";
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("Set OPENAI_API_KEY (or another OpenAI-compatible key plus OPENAI_BASE_URL).");
var model = Environment.GetEnvironmentVariable("THREE_WS_MODEL") ?? "gpt-5.4-mini";
var options = new OpenAIClientOptions { NetworkTimeout = TimeSpan.FromMinutes(5) };
if (Environment.GetEnvironmentVariable("OPENAI_BASE_URL") is { Length: > 0 } baseUrl) options.Endpoint = new Uri(baseUrl);

using var threeWs = ThreeWsClient.FromEnvironment();
var plugin = KernelPluginFactory.CreateFromObject(new ThreeWsPlugin(threeWs), "threews");
await using var studio = await ThreeWsMcp.ConnectAsync(threeWs.BaseUrl);
var studioTools = await studio.ListToolsAsync();

var tools = new List<AITool>();
tools.AddRange(studioTools.Where(t => t.Name == "search_catalog"));
tools.AddRange(plugin.Where(f => f.Name is "generate_3d_model" or "get_3d_job_status"));

AIAgent agent = new OpenAIClient(new ApiKeyCredential(apiKey), options)
    .GetChatClient(model)
    .AsIChatClient()
    .AsAIAgent(instructions: Instructions, name: "prop-designer", tools: tools);

Console.WriteLine($"scene: {scene}\n");
var timer = Stopwatch.StartNew();
var response = await agent.RunAsync(scene);
Console.WriteLine(response.Text);
Console.WriteLine($"\n[{timer.Elapsed.TotalSeconds:0}s]");
return response.Text.Contains("MODEL: https://", StringComparison.Ordinal) ? 0 : 1;
