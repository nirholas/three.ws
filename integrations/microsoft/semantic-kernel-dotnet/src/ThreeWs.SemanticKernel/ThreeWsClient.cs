using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ThreeWs.SemanticKernel;

/// <summary>
/// Every failure the three.ws client can report, with a user-safe message, a
/// machine code (<c>rate_limited</c>, <c>needs_key</c>, <c>failed</c>,
/// <c>network</c>, <c>validation_error</c>, or the server's own code) and the
/// HTTP status when the failure came from a response.
/// </summary>
public sealed class ThreeWsException : Exception
{
    /// <summary>Creates the exception.</summary>
    public ThreeWsException(string message, string code = "error", int? status = null, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        Status = status;
    }

    /// <summary>Machine-readable failure code.</summary>
    public string Code { get; }

    /// <summary>HTTP status, when the failure came from a response.</summary>
    public int? Status { get; }
}

/// <summary>State of one Forge generation job.</summary>
/// <param name="JobId">Job id to poll; null when Forge answered from its cache.</param>
/// <param name="Status">queued, running, done or failed.</param>
/// <param name="GlbUrl">The textured GLB, once done.</param>
/// <param name="ViewerUrl">A three.ws browser viewer link for the GLB, once done.</param>
/// <param name="Error">The failure reason, when failed.</param>
public sealed record ForgeJob(string? JobId, string Status, string? GlbUrl, string? ViewerUrl, string? Error)
{
    /// <summary>True once the model is ready.</summary>
    public bool IsDone => Status == "done" && GlbUrl is not null;
}

/// <summary>One ready-made asset from the three.ws catalog.</summary>
public sealed record CatalogItem(string Id, string? Title, string Kind, string? License, string? GlbUrl, string? ThumbnailUrl, IReadOnlyList<string> Tags);

/// <summary>A three.ws agent.</summary>
public sealed record AgentSummary(string Id, string? Name, string? Description, string PageUrl);

/// <summary>An agent's reply to one message.</summary>
public sealed record AgentReply(string Reply, string? Model, string? Provider);

/// <summary>
/// Async client for the public three.ws API. This class is the one place in the
/// package that knows the wire format; the Semantic Kernel plugin and the Agent
/// Framework samples call it.
/// </summary>
/// <remarks>
/// Contracts (documented at https://three.ws/docs/api-reference):
/// <c>POST /api/forge</c> and <c>GET /api/forge?job=</c> (free text to 3D),
/// <c>GET /api/catalog</c> (free asset catalog), <c>GET /api/agents</c> (your
/// agents, needs an API key), <c>GET /api/agents/public</c> (public directory),
/// and <c>POST /api/chat</c> (message an agent over SSE).
/// </remarks>
public sealed class ThreeWsClient : IDisposable
{
    /// <summary>The production origin.</summary>
    public const string DefaultBaseUrl = "https://three.ws";

    /// <summary>Path of the free 3D Studio MCP server (Streamable HTTP).</summary>
    public const string StudioMcpPath = "/api/mcp-studio";

    private static readonly string[] Tiers = ["draft", "standard", "high"];
    private static readonly string[] Kinds = ["object", "character", "animation"];
    private static readonly HashSet<HttpStatusCode> Transient = [HttpStatusCode.BadGateway, HttpStatusCode.ServiceUnavailable, HttpStatusCode.GatewayTimeout];
    private static readonly HashSet<string> TerminalOk = ["done", "succeeded", "completed"];
    private static readonly HashSet<string> TerminalFail = ["failed", "error", "cancelled", "canceled"];
    private static readonly TimeSpan[] SubmitBackoff = [TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(15)];

    // Forge masks raw provider errors into stable phrases (api/_lib/provider-job-error.js).
    // These name a capacity or timing failure a fresh attempt can clear; content
    // safety and bad-input failures are never retried.
    private static readonly string[] RetryableJobErrors = ["resources", "too long", "busy", "temporarily unavailable", "hit a snag"];

    /// <summary>True when a failed job's message names a capacity or timing failure worth one more attempt.</summary>
    public static bool IsRetryableJobError(string? message) =>
        message is not null && RetryableJobErrors.Any(t => message.Contains(t, StringComparison.OrdinalIgnoreCase));

    private readonly HttpClient _http;
    private readonly bool _ownsHttp;

    /// <summary>Creates a client.</summary>
    /// <param name="baseUrl">The three.ws origin; override for a self-hosted deployment.</param>
    /// <param name="apiKey">A three.ws API key (<c>sk_live_...</c>). Only <see cref="ListMyAgentsAsync"/> needs one.</param>
    /// <param name="httpClient">Bring your own HttpClient; it is not disposed by this client.</param>
    public ThreeWsClient(string? baseUrl = null, string? apiKey = null, HttpClient? httpClient = null)
    {
        BaseUrl = (baseUrl ?? DefaultBaseUrl).TrimEnd('/');
        ApiKey = string.IsNullOrWhiteSpace(apiKey) ? null : apiKey;
        ClientHandle = $"threews-sk-dotnet-{Guid.NewGuid():N}";
        _ownsHttp = httpClient is null;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(150) };
        if (_ownsHttp)
        {
            _http.DefaultRequestHeaders.UserAgent.ParseAdd("ThreeWs.SemanticKernel/0.1 (+https://three.ws)");
        }
    }

    /// <summary>Creates a client from <c>THREE_WS_BASE_URL</c> and <c>THREE_WS_API_KEY</c>.</summary>
    public static ThreeWsClient FromEnvironment() =>
        new(Environment.GetEnvironmentVariable("THREE_WS_BASE_URL"), Environment.GetEnvironmentVariable("THREE_WS_API_KEY"));

    /// <summary>The origin calls go to.</summary>
    public string BaseUrl { get; }

    /// <summary>The configured API key, if any.</summary>
    public string? ApiKey { get; }

    /// <summary>The anonymous handle Forge scopes this client's creations to.</summary>
    public string ClientHandle { get; }

    /// <summary>The free 3D Studio MCP endpoint.</summary>
    public Uri StudioMcpUri => new($"{BaseUrl}{StudioMcpPath}");

    /// <summary>The three.ws browser viewer link for a public GLB URL.</summary>
    public string ViewerUrl(string glbUrl) => $"{BaseUrl}/viewer?src={Uri.EscapeDataString(glbUrl)}";

    /// <summary>Starts a free text-to-3D job. A recently generated prompt can come back done at once.</summary>
    public async Task<ForgeJob> SubmitGenerationAsync(string prompt, string tier = "standard", CancellationToken ct = default)
    {
        prompt = (prompt ?? string.Empty).Trim();
        if (prompt.Length < 3) throw new ThreeWsException("describe the model in at least 3 characters", "validation_error");
        if (!Tiers.Contains(tier)) throw new ThreeWsException($"tier must be one of {string.Join(", ", Tiers)}", "validation_error");

        var waitedForRateLimit = false;
        for (var attempt = 0; ; attempt++)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/api/forge")
            {
                Content = JsonContent.Create(new { prompt, tier }),
            };
            req.Headers.Add("x-forge-client", ClientHandle);
            using var res = await SendAsync(req, "Forge", ct).ConfigureAwait(false);
            if (Transient.Contains(res.StatusCode) && attempt < 2)
            {
                // A 502 here usually means every GPU lane is busy; give one a moment to free up.
                await Task.Delay(SubmitBackoff[attempt], ct).ConfigureAwait(false);
                continue;
            }
            if (res.StatusCode == HttpStatusCode.TooManyRequests && !waitedForRateLimit
                && res.Headers.RetryAfter?.Delta is { } delta && delta <= TimeSpan.FromSeconds(30))
            {
                waitedForRateLimit = true;
                await Task.Delay(delta, ct).ConfigureAwait(false);
                continue;
            }
            var body = await ReadJsonAsync(res, "Forge generation", ct).ConfigureAwait(false);
            return ToJob(body, null);
        }
    }

    /// <summary>Reads one Forge job, retrying gateway errors a long GPU job can outlive.</summary>
    public async Task<ForgeJob> GetJobAsync(string jobId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(jobId)) throw new ThreeWsException("job_id is required", "validation_error");
        ThreeWsException? last = null;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, $"{BaseUrl}/api/forge?job={Uri.EscapeDataString(jobId)}");
                using var res = await SendAsync(req, "Forge", ct).ConfigureAwait(false);
                if (Transient.Contains(res.StatusCode))
                {
                    last = await ErrorFromAsync(res, "Forge job status", ct).ConfigureAwait(false);
                }
                else
                {
                    return ToJob(await ReadJsonAsync(res, "Forge job status", ct).ConfigureAwait(false), jobId);
                }
            }
            catch (ThreeWsException err) when (err.Code == "network")
            {
                last = err;
            }
            await Task.Delay(TimeSpan.FromSeconds(1.5 * (attempt + 1)), ct).ConfigureAwait(false);
        }
        throw last ?? new ThreeWsException("three.ws Forge job status is unavailable", "network");
    }

    /// <summary>
    /// Generates a textured GLB from text, waiting up to <paramref name="wait"/>.
    /// When the job is still running after the wait, the returned job's status is
    /// queued or running: call <see cref="GetJobAsync"/> with its id later.
    /// </summary>
    /// <remarks>
    /// A job that fails for a capacity or timing reason (the GPU ran out of memory,
    /// the engine was busy) is resubmitted up to <paramref name="retries"/> times
    /// while the wait lasts.
    /// </remarks>
    public async Task<ForgeJob> GenerateModelAsync(string prompt, string tier = "standard", TimeSpan? wait = null, TimeSpan? pollInterval = null, IProgress<ForgeJob>? progress = null, int retries = 1, CancellationToken ct = default)
    {
        var budget = wait ?? TimeSpan.FromMinutes(4);
        var interval = pollInterval ?? TimeSpan.FromSeconds(5);
        var started = DateTime.UtcNow;
        for (var attempt = 1; ; attempt++)
        {
            var remaining = budget - (DateTime.UtcNow - started);
            try
            {
                return await GenerateOnceAsync(prompt, tier, remaining < TimeSpan.Zero ? TimeSpan.Zero : remaining, interval, progress, ct).ConfigureAwait(false);
            }
            catch (ThreeWsException err) when (err.Code == "failed" && IsRetryableJobError(err.Message) && attempt <= retries && DateTime.UtcNow - started < budget)
            {
                // Fall through to the next loop pass, which submits a fresh job.
            }
        }
    }

    private async Task<ForgeJob> GenerateOnceAsync(string prompt, string tier, TimeSpan budget, TimeSpan interval, IProgress<ForgeJob>? progress, CancellationToken ct)
    {
        var job = await SubmitGenerationAsync(prompt, tier, ct).ConfigureAwait(false);
        if (job.IsDone) return job;
        var jobId = job.JobId ?? throw new ThreeWsException("Forge accepted the prompt but returned no job id", "failed");

        var started = DateTime.UtcNow;
        while (true)
        {
            progress?.Report(job);
            var elapsed = DateTime.UtcNow - started;
            if (elapsed >= budget) return job;
            var remaining = budget - elapsed;
            await Task.Delay(remaining < interval ? remaining : interval, ct).ConfigureAwait(false);
            job = await GetJobAsync(jobId, ct).ConfigureAwait(false);
            if (job.Status == "done")
            {
                if (job.GlbUrl is null) throw new ThreeWsException("Forge finished the job but returned no model URL", "failed");
                return job;
            }
            if (job.Status == "failed") throw new ThreeWsException($"generation failed: {job.Error ?? "unknown error"}", "failed");
        }
    }

    /// <summary>Searches the free catalog of ready-made 3D assets.</summary>
    public async Task<IReadOnlyList<CatalogItem>> SearchAssetsAsync(string query, string? kind = null, int limit = 5, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(kind) && !Kinds.Contains(kind)) throw new ThreeWsException($"kind must be one of {string.Join(", ", Kinds)}", "validation_error");
        var url = $"{BaseUrl}/api/catalog?q={Uri.EscapeDataString(query ?? string.Empty)}&limit={Math.Clamp(limit, 1, 50)}";
        if (!string.IsNullOrEmpty(kind)) url += $"&kind={kind}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        using var res = await SendAsync(req, "asset search", ct).ConfigureAwait(false);
        var body = await ReadJsonAsync(res, "asset search", ct).ConfigureAwait(false);
        return (body["items"] as JsonArray ?? [])
            .OfType<JsonObject>()
            .Select(i => new CatalogItem(
                Str(i, "id") ?? string.Empty,
                Str(i, "title"),
                Str(i, "kind") ?? string.Empty,
                Str(i, "license"),
                Str(i, "url"),
                Str(i, "thumb"),
                (i["tags"] as JsonArray ?? []).Select(t => t?.GetValue<string>() ?? string.Empty).Where(t => t.Length > 0).Take(8).ToList()))
            .ToList();
    }

    /// <summary>Lists the agents owned by the API key's account.</summary>
    public async Task<IReadOnlyList<AgentSummary>> ListMyAgentsAsync(CancellationToken ct = default)
    {
        if (ApiKey is null)
        {
            throw new ThreeWsException("listing your agents needs a three.ws API key: set THREE_WS_API_KEY (create one at https://three.ws/dashboard/api)", "needs_key");
        }
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{BaseUrl}/api/agents");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey);
        using var res = await SendAsync(req, "list agents", ct).ConfigureAwait(false);
        var body = await ReadJsonAsync(res, "list agents", ct).ConfigureAwait(false);
        return Agents(body["agents"] as JsonArray, a => $"{BaseUrl}/agents/{Str(a, "id")}");
    }

    /// <summary>Searches the public agent directory (no key).</summary>
    public async Task<IReadOnlyList<AgentSummary>> ListPublicAgentsAsync(string? query = null, int limit = 10, CancellationToken ct = default)
    {
        var url = $"{BaseUrl}/api/agents/public?limit={Math.Clamp(limit, 1, 48)}";
        if (!string.IsNullOrWhiteSpace(query)) url += $"&q={Uri.EscapeDataString(query)}";
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        using var res = await SendAsync(req, "agent directory", ct).ConfigureAwait(false);
        var body = await ReadJsonAsync(res, "agent directory", ct).ConfigureAwait(false);
        return Agents(body["agents"] as JsonArray, a => BaseUrl + (Str(a, "home_url") ?? $"/agents/{Str(a, "id")}"));
    }

    /// <summary>Sends one message to a three.ws agent and returns its full reply (streams the real SSE answer).</summary>
    /// <param name="message">The message.</param>
    /// <param name="agentId">The agent's id; null for the default three.ws guide.</param>
    /// <param name="ct">Cancellation.</param>
    public async Task<AgentReply> MessageAgentAsync(string message, string? agentId = null, CancellationToken ct = default)
    {
        message = (message ?? string.Empty).Trim();
        if (message.Length == 0) throw new ThreeWsException("message is empty", "validation_error");
        var payload = new JsonObject { ["message"] = message, ["history"] = new JsonArray() };
        if (!string.IsNullOrWhiteSpace(agentId)) payload["agentId"] = agentId;

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/api/chat")
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        req.Headers.Accept.ParseAdd("text/event-stream");
        if (ApiKey is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey);

        using var res = await SendAsync(req, "agent chat", ct, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw await ErrorFromAsync(res, "agent chat", ct).ConfigureAwait(false);

        var text = new StringBuilder();
        JsonObject? done = null;
        await using var stream = await res.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        while (await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var raw = line[5..].Trim();
            if (raw.Length == 0) continue;
            JsonObject? evt;
            try { evt = JsonNode.Parse(raw) as JsonObject; }
            catch (JsonException) { continue; }
            if (evt is null) continue;
            switch (Str(evt, "type"))
            {
                case "chunk" or "content" or "delta":
                    text.Append(Str(evt, "text"));
                    break;
                case "error":
                    throw new ThreeWsException($"agent chat failed: {Str(evt, "error") ?? "stream error"}", "failed");
                case "done":
                    done = evt;
                    break;
            }
        }
        if (done is null) throw new ThreeWsException("agent chat stream ended without a done event", "failed");
        var reply = text.ToString().Trim();
        if (reply.Length == 0) reply = (Str(done, "reply") ?? string.Empty).Trim();
        return new AgentReply(reply, Str(done, "model"), Str(done, "provider"));
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, string what, CancellationToken ct, HttpCompletionOption option = HttpCompletionOption.ResponseContentRead)
    {
        try
        {
            return await _http.SendAsync(req, option, ct).ConfigureAwait(false);
        }
        catch (Exception err) when (err is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            var detail = string.IsNullOrEmpty(err.Message) ? err.GetType().Name : err.Message;
            throw new ThreeWsException($"three.ws {what} is unreachable: {detail}", "network", null, err);
        }
    }

    private static async Task<JsonObject> ReadJsonAsync(HttpResponseMessage res, string what, CancellationToken ct)
    {
        if (!res.IsSuccessStatusCode) throw await ErrorFromAsync(res, what, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return JsonNode.Parse(text) as JsonObject ?? throw new ThreeWsException($"three.ws {what} returned a non-object response", "failed", (int)res.StatusCode);
    }

    private static async Task<ThreeWsException> ErrorFromAsync(HttpResponseMessage res, string what, CancellationToken ct)
    {
        var status = (int)res.StatusCode;
        var code = "error";
        var detail = string.Empty;
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        try
        {
            if (JsonNode.Parse(text) is JsonObject obj)
            {
                code = Str(obj, "error") ?? Str(obj, "code") ?? code;
                detail = Str(obj, "error_description") ?? Str(obj, "message") ?? Str(obj, "error") ?? string.Empty;
            }
        }
        catch (JsonException)
        {
            detail = text.Length > 300 ? text[..300] : text;
        }
        if (status == 401)
        {
            code = "needs_key";
            if (detail.Length == 0) detail = "this call needs a three.ws API key (create one at https://three.ws/dashboard/api)";
        }
        else if (status == 429)
        {
            code = "rate_limited";
            if (detail.Length == 0) detail = "rate limited";
            if (res.Headers.RetryAfter?.Delta is { } d) detail += $" (retry after {d.TotalSeconds:0}s)";
        }
        var message = detail.Length > 0 ? $"three.ws {what} failed ({status}): {detail}" : $"three.ws {what} failed ({status})";
        return new ThreeWsException(message, code, status);
    }

    private ForgeJob ToJob(JsonObject body, string? jobId)
    {
        var status = Str(body, "status") ?? "queued";
        if (TerminalOk.Contains(status)) status = "done";
        else if (TerminalFail.Contains(status)) status = "failed";
        var glb = Str(body, "glb_url");
        return new ForgeJob(Str(body, "job_id") ?? jobId, status, glb, glb is null ? null : ViewerUrl(glb), Str(body, "error"));
    }

    private static List<AgentSummary> Agents(JsonArray? items, Func<JsonObject, string> page) =>
        (items ?? [])
            .OfType<JsonObject>()
            .Select(a => new AgentSummary(Str(a, "id") ?? string.Empty, Str(a, "name"), Str(a, "description"), page(a)))
            .ToList();

    private static string? Str(JsonObject obj, string key) =>
        obj[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
