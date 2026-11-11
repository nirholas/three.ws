using System.ComponentModel;
using System.Text.Json;
using Microsoft.SemanticKernel;

namespace ThreeWs.SemanticKernel;

/// <summary>
/// three.ws 3D generation, asset search and agent messaging as Semantic Kernel
/// functions. Add it with <c>kernel.Plugins.AddFromObject(new ThreeWsPlugin(), "threews")</c>.
/// </summary>
/// <remarks>
/// Every function returns compact JSON, which is what a chat model reads back.
/// Failures come back as <c>{"ok":false,"error":...,"code":...}</c> instead of
/// throwing, so the model can explain or retry instead of the turn failing.
/// </remarks>
public sealed class ThreeWsPlugin
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private readonly ThreeWsClient _client;
    private readonly TimeSpan _generationWait;

    /// <summary>Creates the plugin.</summary>
    /// <param name="client">The client to call; defaults to <see cref="ThreeWsClient.FromEnvironment"/>.</param>
    /// <param name="generationWait">How long <c>generate_3d_model</c> waits before handing back a job id (default 4 minutes).</param>
    public ThreeWsPlugin(ThreeWsClient? client = null, TimeSpan? generationWait = null)
    {
        _client = client ?? ThreeWsClient.FromEnvironment();
        _generationWait = generationWait ?? TimeSpan.FromMinutes(4);
    }

    /// <summary>
    /// The plugin's functions as tools for a Microsoft Agent Framework agent or any
    /// <see cref="Microsoft.Extensions.AI.IChatClient"/> with function invocation.
    /// </summary>
    /// <remarks>
    /// Each function is bound to its own <see cref="Kernel"/>. An unbound
    /// <see cref="KernelFunction"/> builds a kernel from the caller's service
    /// provider when it runs, and Agent Framework's provider does not resolve
    /// Semantic Kernel types, so the call fails. Use these instead of passing
    /// plugin functions to an agent directly.
    /// </remarks>
    /// <param name="client">The client to call; defaults to <see cref="ThreeWsClient.FromEnvironment"/>.</param>
    /// <param name="generationWait">How long <c>generate_3d_model</c> waits before handing back a job id (default 4 minutes).</param>
    /// <param name="pluginName">The plugin name the functions are grouped under.</param>
    public static IReadOnlyList<KernelFunction> CreateAITools(ThreeWsClient? client = null, TimeSpan? generationWait = null, string pluginName = "threews")
    {
        var kernel = new Kernel();
        var plugin = kernel.Plugins.AddFromObject(new ThreeWsPlugin(client, generationWait), pluginName);
        return plugin.Select(f => f.WithKernel(kernel, pluginName)).ToList();
    }

    /// <summary>Generates a GLB from text and returns its URLs, or a job id when it is still running.</summary>
    [KernelFunction("generate_3d_model")]
    [Description("Generate a textured, downloadable 3D model (GLB) from a text description of one object, character or creature. Free. Waits for the model and returns glb_url and viewer_url; if it is still running, returns a job_id to pass to get_3d_job_status.")]
    public async Task<string> GenerateModelAsync(
        [Description("Description of the single object to model, e.g. 'a weathered bronze lantern'.")] string prompt,
        [Description("Detail level: draft (fastest), standard (default) or high (slowest, best).")] string tier = "standard",
        CancellationToken ct = default)
    {
        try
        {
            return Ok(JobView(await _client.GenerateModelAsync(prompt, tier, _generationWait, ct: ct).ConfigureAwait(false)));
        }
        catch (ThreeWsException err)
        {
            return Fail(err);
        }
    }

    /// <summary>Reads the state of one generation job.</summary>
    [KernelFunction("get_3d_job_status")]
    [Description("Check a 3D generation job started by generate_3d_model. Returns status (queued, running, done, failed) and, once done, glb_url and viewer_url.")]
    public async Task<string> GetJobStatusAsync(
        [Description("The job_id returned by generate_3d_model.")] string job_id,
        CancellationToken ct = default)
    {
        try
        {
            return Ok(JobView(await _client.GetJobAsync(job_id, ct).ConfigureAwait(false)));
        }
        catch (ThreeWsException err)
        {
            return Fail(err);
        }
    }

    /// <summary>Searches the free asset catalog.</summary>
    [KernelFunction("find_3d_asset")]
    [Description("Search thousands of free, ready-made 3D assets on three.ws (CC0 props and objects, rigged characters, motion clips). Check here before generating a model from scratch.")]
    public async Task<string> FindAssetAsync(
        [Description("What to look for, e.g. 'wooden chair' or 'brass lantern'.")] string query,
        [Description("object, character or animation; empty for all kinds.")] string kind = "",
        [Description("How many results to return, 1 to 20.")] int limit = 5,
        CancellationToken ct = default)
    {
        try
        {
            var items = await _client.SearchAssetsAsync(query, string.IsNullOrEmpty(kind) ? null : kind, Math.Clamp(limit, 1, 20), ct).ConfigureAwait(false);
            return Ok(new { matched = items.Count, items });
        }
        catch (ThreeWsException err)
        {
            return Fail(err);
        }
    }

    /// <summary>Lists the configured account's agents.</summary>
    [KernelFunction("list_my_agents")]
    [Description("List the three.ws AI agents owned by the configured account (needs a three.ws API key). Without a key, search_public_agents finds public ones instead.")]
    public async Task<string> ListMyAgentsAsync(CancellationToken ct = default)
    {
        try
        {
            var agents = await _client.ListMyAgentsAsync(ct).ConfigureAwait(false);
            return Ok(new { count = agents.Count, agents });
        }
        catch (ThreeWsException err)
        {
            return Fail(err);
        }
    }

    /// <summary>Searches public agents.</summary>
    [KernelFunction("search_public_agents")]
    [Description("Search the public three.ws agent directory by name or description. Free, no key.")]
    public async Task<string> SearchPublicAgentsAsync(
        [Description("Words to match against agent names and descriptions; empty for popular agents.")] string query = "",
        [Description("How many agents to return, 1 to 20.")] int limit = 5,
        CancellationToken ct = default)
    {
        try
        {
            var agents = await _client.ListPublicAgentsAsync(query, Math.Clamp(limit, 1, 20), ct).ConfigureAwait(false);
            return Ok(new { count = agents.Count, agents });
        }
        catch (ThreeWsException err)
        {
            return Fail(err);
        }
    }

    /// <summary>Messages an agent and returns its reply.</summary>
    [KernelFunction("message_agent")]
    [Description("Send a message to a three.ws AI agent and return its reply. Omit agent_id to ask the default three.ws guide.")]
    public async Task<string> MessageAgentAsync(
        [Description("The message to send.")] string message,
        [Description("The agent's id from list_my_agents or search_public_agents; empty for the guide.")] string agent_id = "",
        CancellationToken ct = default)
    {
        try
        {
            var reply = await _client.MessageAgentAsync(message, string.IsNullOrEmpty(agent_id) ? null : agent_id, ct).ConfigureAwait(false);
            return Ok(new { reply = reply.Reply, model = reply.Model });
        }
        catch (ThreeWsException err)
        {
            return Fail(err);
        }
    }

    private static object JobView(ForgeJob job) => new
    {
        status = job.Status,
        job_id = job.JobId,
        glb_url = job.GlbUrl,
        viewer_url = job.ViewerUrl,
        error = job.Error,
        next_step = job.Status is "queued" or "running" ? "call get_3d_job_status with this job_id in about 30 seconds" : null,
    };

    private static string Ok(object data)
    {
        var node = JsonSerializer.SerializeToNode(data, Json)!.AsObject();
        node.Insert(0, "ok", true);
        return node.ToJsonString(Json);
    }

    private static string Fail(ThreeWsException err) =>
        JsonSerializer.Serialize(new { ok = false, error = err.Message, code = err.Code }, Json);
}
