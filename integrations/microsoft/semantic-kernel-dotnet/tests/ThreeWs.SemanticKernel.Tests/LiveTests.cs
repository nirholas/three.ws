using System.Text.Json;
using Microsoft.SemanticKernel;
using Xunit;

namespace ThreeWs.SemanticKernel.Tests;

// Every call goes to the real three.ws API; nothing is mocked. Set
// THREE_WS_BASE_URL to test another deployment. The generation test runs a real
// GPU job (a few minutes); filter it out with --filter "Category!=Slow".
public sealed class LiveTests : IDisposable
{
    private static readonly string Base = (Environment.GetEnvironmentVariable("THREE_WS_BASE_URL") ?? ThreeWsClient.DefaultBaseUrl).TrimEnd('/');
    private readonly ThreeWsClient _client = new(Base);
    private readonly Kernel _kernel;

    public LiveTests()
    {
        _kernel = new Kernel();
        _kernel.Plugins.AddFromObject(new ThreeWsPlugin(_client), "threews");
    }

    public void Dispose() => _client.Dispose();

    private async Task<JsonElement> Invoke(string function, KernelArguments? args = null)
    {
        var result = await _kernel.InvokeAsync("threews", function, args ?? new KernelArguments());
        return JsonDocument.Parse(result.GetValue<string>()!).RootElement;
    }

    [Fact]
    public void PluginExposesSixDescribedFunctions()
    {
        var plugin = _kernel.Plugins["threews"];
        Assert.Equal(
            new[] { "find_3d_asset", "generate_3d_model", "get_3d_job_status", "list_my_agents", "message_agent", "search_public_agents" },
            plugin.Select(f => f.Name).OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(plugin, f => Assert.True(f.Description.Length > 40, f.Name));
        var generate = plugin["generate_3d_model"].Metadata.Parameters;
        Assert.Contains(generate, p => p.Name == "prompt" && p.IsRequired && p.Description.Length > 10);
    }

    [Fact]
    public async Task FindAssetReturnsReachableGlbs()
    {
        var output = await Invoke("find_3d_asset", new() { ["query"] = "lantern", ["kind"] = "object", ["limit"] = 3 });
        Assert.True(output.GetProperty("ok").GetBoolean());
        var first = output.GetProperty("items")[0];
        Assert.Equal("object", first.GetProperty("kind").GetString());
        var glb = first.GetProperty("glb_url").GetString()!;
        Assert.StartsWith("https://", glb);
        Assert.EndsWith(".glb", glb);
        using var http = new HttpClient();
        using var head = await http.SendAsync(new HttpRequestMessage(HttpMethod.Head, glb));
        Assert.True(head.IsSuccessStatusCode, $"{glb} answered {(int)head.StatusCode}");
    }

    [Fact]
    public async Task FindAssetRejectsUnknownKind()
    {
        var output = await Invoke("find_3d_asset", new() { ["query"] = "chair", ["kind"] = "vehicle" });
        Assert.False(output.GetProperty("ok").GetBoolean());
        Assert.Equal("validation_error", output.GetProperty("code").GetString());
    }

    [Fact]
    public async Task SearchPublicAgents()
    {
        var output = await Invoke("search_public_agents", new() { ["limit"] = 3 });
        Assert.True(output.GetProperty("ok").GetBoolean());
        var count = output.GetProperty("count").GetInt32();
        Assert.InRange(count, 1, 3);
        var agent = output.GetProperty("agents")[0];
        Assert.False(string.IsNullOrEmpty(agent.GetProperty("id").GetString()));
        Assert.StartsWith($"{Base}/agents/", agent.GetProperty("page_url").GetString());
    }

    [Fact]
    public async Task ListMyAgentsWithoutKeyExplainsHowToGetOne()
    {
        var output = await Invoke("list_my_agents");
        Assert.False(output.GetProperty("ok").GetBoolean());
        Assert.Equal("needs_key", output.GetProperty("code").GetString());
        Assert.Contains("dashboard/api", output.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ListMyAgentsWithUnknownKeyIsAReal401()
    {
        using var client = new ThreeWsClient(Base, "sk_" + "live_thisKeyDoesNotExist000000000000");
        var err = await Assert.ThrowsAsync<ThreeWsException>(() => client.ListMyAgentsAsync());
        Assert.Equal(401, err.Status);
        Assert.Equal("needs_key", err.Code);
    }

    [Fact]
    public async Task ListMyAgentsWithKeyWhenConfigured()
    {
        var key = Environment.GetEnvironmentVariable("THREE_WS_API_KEY");
        if (string.IsNullOrEmpty(key)) return;
        using var client = new ThreeWsClient(Base, key);
        var agents = await client.ListMyAgentsAsync();
        Assert.All(agents, a => Assert.EndsWith(a.Id, a.PageUrl));
    }

    [Fact]
    public async Task MessageAgentReturnsARealReply()
    {
        var output = await Invoke("message_agent", new() { ["message"] = "In one short sentence, what is a GLB file?" });
        Assert.True(output.GetProperty("ok").GetBoolean(), output.ToString());
        Assert.True(output.GetProperty("reply").GetString()!.Length > 10);
        Assert.False(string.IsNullOrEmpty(output.GetProperty("model").GetString()));
    }

    [Fact]
    public async Task UnknownJobIsAnError()
    {
        var output = await Invoke("get_3d_job_status", new() { ["job_id"] = "not-a-real-job" });
        Assert.False(output.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task TooShortPromptIsRejectedBeforeAnyCall()
    {
        var output = await Invoke("generate_3d_model", new() { ["prompt"] = "a" });
        Assert.Equal("validation_error", output.GetProperty("code").GetString());
    }

    [Fact]
    [Trait("Category", "Slow")]
    public async Task GenerateModelEndToEnd()
    {
        var output = await Invoke("generate_3d_model", new() { ["prompt"] = "a carved wooden ship's wheel", ["tier"] = "draft" });
        Assert.True(output.GetProperty("ok").GetBoolean(), output.ToString());
        if (output.GetProperty("status").GetString() != "done")
        {
            output = await Invoke("get_3d_job_status", new() { ["job_id"] = output.GetProperty("job_id").GetString() });
        }
        Assert.Equal("done", output.GetProperty("status").GetString());
        var glb = output.GetProperty("glb_url").GetString()!;
        Assert.StartsWith($"{Base}/viewer?src=", output.GetProperty("viewer_url").GetString());
        using var http = new HttpClient();
        var bytes = await http.GetByteArrayAsync(glb);
        Assert.Equal("glTF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
    }

    [Fact]
    public async Task McpStudioToolsJoinTheKernelAndRun()
    {
        var kernel = new Kernel();
        await using var mcp = await kernel.AddThreeWsStudioMcpAsync(baseUrl: Base);
        var names = kernel.Plugins["threews_studio"].Select(f => f.Name).ToHashSet();
        Assert.Superset(new HashSet<string> { "forge_free", "search_catalog", "check_job", "rig_mesh" }, names);
        var result = await kernel.InvokeAsync("threews_studio", "search_catalog", new() { ["q"] = "chair", ["kind"] = "object", ["limit"] = 2 });
        var text = result.ToString();
        Assert.Contains("chair", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(".glb", text);
    }
}
