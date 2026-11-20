using System.Net;
using System.Text;
using Xunit;

namespace ThreeWs.SemanticKernel.Tests;

// Making a model on three.ws needs an account: an anonymous POST /api/forge
// answers 401 sign_in_required, and the studio MCP server refuses forge_free and
// rig_mesh without a verified key. The client used to send no key on generation,
// so every run would fail once the gate is live. These tests capture what the
// client actually puts on the wire through an HttpMessageHandler, offline.
public sealed class AccountTests
{
    private const string Key = "sk_live_test_key";

    private sealed class Recorder(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task GenerationSendsTheApiKey()
    {
        var recorder = new Recorder(HttpStatusCode.OK, """{"job_id":"j1","status":"queued"}""");
        using var client = new ThreeWsClient("https://three.ws", Key, new HttpClient(recorder));
        await client.SubmitGenerationAsync("a small wooden chair", "draft");
        Assert.Equal($"Bearer {Key}", recorder.Requests[0].Headers.Authorization?.ToString());
    }

    [Fact]
    public async Task GenerationWithoutAKeyStopsBeforeTheNetwork()
    {
        var recorder = new Recorder(HttpStatusCode.OK, "{}");
        using var client = new ThreeWsClient("https://three.ws", null, new HttpClient(recorder));
        var err = await Assert.ThrowsAsync<ThreeWsException>(() => client.SubmitGenerationAsync("a small wooden chair"));
        Assert.Equal("needs_key", err.Code);
        Assert.Contains("https://three.ws/dashboard/api-keys", err.Message);
        Assert.Empty(recorder.Requests);
    }

    [Fact]
    public async Task ARefusedKeySaysHowToFixIt()
    {
        var recorder = new Recorder(
            HttpStatusCode.Unauthorized,
            """{"error":"sign_in_required","message":"Sign in to make a 3D model. A three.ws account is free.","sign_in_url":"/login","api_keys_url":"/dashboard/api-keys"}""");
        using var client = new ThreeWsClient("https://three.ws", "sk_live_revoked", new HttpClient(recorder));
        var err = await Assert.ThrowsAsync<ThreeWsException>(() => client.SubmitGenerationAsync("a small wooden chair"));
        Assert.Equal(401, err.Status);
        Assert.Equal("needs_key", err.Code);
        Assert.Contains("Sign in to make a 3D model", err.Message);
        Assert.Contains("https://three.ws/dashboard/api-keys", err.Message);
    }

    [Fact]
    public void McpTransportSendsTheApiKey()
    {
        var options = ThreeWsMcp.TransportOptions("https://three.ws/", Key);
        Assert.Equal(new Uri("https://three.ws/api/mcp-studio"), options.Endpoint);
        Assert.Equal($"Bearer {Key}", options.AdditionalHeaders?["Authorization"]);
    }

    [Fact]
    public void McpTransportWithoutAKeySendsNoAuthorization()
    {
        var options = ThreeWsMcp.TransportOptions("https://three.ws", apiKey: "");
        Assert.False(options.AdditionalHeaders?.ContainsKey("Authorization") ?? false);
    }
}
