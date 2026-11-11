using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using ThreeWs.Sdk.Forge;
using ThreeWs.Sdk.Internal;
using Xunit;

namespace ThreeWs.Sdk.Tests
{
    public class TransportTests
    {
        private static ThreeWsClient ClientFor(LoopbackServer server, string? apiKey = null, int maxRetries = 3) =>
            new ThreeWsClient(new ThreeWsClientOptions
            {
                BaseUrl = server.BaseUrl,
                ApiKey = apiKey,
                MaxRetries = maxRetries,
                RetryBaseDelay = TimeSpan.FromMilliseconds(20),
                RetryMaxDelay = TimeSpan.FromSeconds(5),
            });

        [Fact]
        public async Task Retries429HonouringRetryAfterThenSucceeds()
        {
            using var server = new LoopbackServer(i => i == 0
                ? new LoopbackServer.Reply { Status = 429, RetryAfter = "1", Body = "{\"error\":\"rate_limited\",\"message\":\"slow down\"}" }
                : new LoopbackServer.Reply { Body = "{\"paths\":[\"image\"],\"tiers\":[],\"backends\":[]}" });
            using var client = ClientFor(server);

            var catalog = await client.Forge.GetCatalogAsync();

            Assert.Equal(new[] { "image" }, catalog.Paths);
            var seen = server.Requests.ToArray();
            Assert.Equal(2, seen.Length);
            Assert.True(seen[1].At - seen[0].At >= TimeSpan.FromMilliseconds(900), "second attempt must wait for Retry-After: 1");
        }

        [Fact]
        public async Task CreateRetries500WithTheSameIdempotencyKey()
        {
            using var server = new LoopbackServer(i => i < 2
                ? new LoopbackServer.Reply { Status = 500, Body = "{\"error\":\"internal\"}" }
                : new LoopbackServer.Reply { Body = "{\"job_id\":\"j1\",\"status\":\"queued\"}" });
            using var client = ClientFor(server);

            var job = await client.Forge.CreateAsync(new ForgeRequest { Prompt = "a teapot", Tier = ForgeTiers.Draft });

            Assert.Equal("j1", job.JobId);
            Assert.Equal(ForgeJobStatus.Queued, job.Status);
            var keys = server.Requests.Select(r => r.IdempotencyKey).ToArray();
            Assert.Equal(3, keys.Length);
            Assert.False(string.IsNullOrEmpty(keys[0]));
            Assert.All(keys, k => Assert.Equal(keys[0], k));
            Assert.Contains("\"prompt\":\"a teapot\"", server.Requests.First().Body);
            Assert.DoesNotContain("provider", server.Requests.First().Body, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public async Task StopsAfterMaxRetriesAndThrowsTypedRateLimit()
        {
            using var server = new LoopbackServer(_ => new LoopbackServer.Reply { Status = 429, Body = "{\"error\":\"rate_limited\",\"message\":\"slow down\",\"retry_after\":7}" });
            using var client = ClientFor(server, maxRetries: 2);

            var ex = await Assert.ThrowsAsync<ThreeWsRateLimitException>(() => client.Catalog.SearchAsync("chair"));

            Assert.Equal("rate_limited", ex.ErrorCode);
            Assert.Equal(TimeSpan.FromSeconds(7), ex.RetryAfter);
            Assert.Equal(3, server.Requests.Count);
        }

        [Fact]
        public async Task NonRetryable4xxFailsFastWithErrorCode()
        {
            using var server = new LoopbackServer(_ => new LoopbackServer.Reply { Status = 400, Body = "{\"error\":\"invalid_glb_url\",\"message\":\"glb_url must be a public https URL\"}" });
            using var client = ClientFor(server);

            var ex = await Assert.ThrowsAsync<ThreeWsApiException>(() => client.Forge.RigAsync("https://example.invalid/a.glb"));

            Assert.Equal(HttpStatusCode.BadRequest, ex.StatusCode);
            Assert.Equal("invalid_glb_url", ex.ErrorCode);
            Assert.Single(server.Requests);
        }

        [Fact]
        public async Task SendsApiKeyAsBearerAndIdentifiesTheSdk()
        {
            using var server = new LoopbackServer(_ => new LoopbackServer.Reply { Body = "{\"agents\":[],\"count\":0,\"has_more\":false}" });
            using var client = ClientFor(server, apiKey: "sk_live_example");

            await client.Agents.ListMineAsync().ContinueWith(_ => { });
            await client.Agents.ListPublicAsync();

            var seen = server.Requests.ToArray();
            Assert.Equal("Bearer sk_live_example", seen[0].Authorization);
            Assert.Null(seen[1].Authorization);
            Assert.StartsWith("ThreeWs.Sdk/", seen[0].UserAgent);
        }

        [Fact]
        public async Task TokenProviderIsCalledPerRequestAndWins()
        {
            var calls = 0;
            using var server = new LoopbackServer(_ => new LoopbackServer.Reply { Body = "{\"data\":{\"userId\":\"u1\"}}" });
            using var client = new ThreeWsClient(new ThreeWsClientOptions
            {
                BaseUrl = server.BaseUrl,
                ApiKey = "sk_live_ignored",
                AccessTokenProvider = _ => new ValueTask<string?>("oauth-" + (++calls)),
            });

            await client.Auth.WhoAmIAsync();
            var me = await client.Auth.WhoAmIAsync();

            Assert.Equal("u1", me.UserId);
            Assert.Equal(new[] { "Bearer oauth-1", "Bearer oauth-2" }, server.Requests.Select(r => r.Authorization).ToArray());
        }

        [Fact]
        public async Task DownloadRejectsANonGlbBody()
        {
            using var server = new LoopbackServer(_ => new LoopbackServer.Reply { ContentType = "text/html", Body = "<!doctype html><p>not a model</p>" });
            using var client = ClientFor(server);
            using var sink = new System.IO.MemoryStream();

            await Assert.ThrowsAsync<System.IO.InvalidDataException>(() => client.Forge.DownloadAsync(new Uri(server.BaseUrl, "/x.glb").ToString(), sink));
            Assert.Equal(0, sink.Length);
        }

        [Fact]
        public async Task CancellationStopsARetryWait()
        {
            using var server = new LoopbackServer(_ => new LoopbackServer.Reply { Status = 503, RetryAfter = "30", Body = "{\"error\":\"unavailable\"}" });
            using var client = new ThreeWsClient(new ThreeWsClientOptions { BaseUrl = server.BaseUrl, RetryMaxDelay = TimeSpan.FromSeconds(30) });
            using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromMilliseconds(500));

            var started = DateTimeOffset.UtcNow;
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.Catalog.SearchAsync("chair", cancellationToken: cts.Token));
            Assert.True(DateTimeOffset.UtcNow - started < TimeSpan.FromSeconds(5));
        }
    }

    public class RetryPolicyTests
    {
        [Theory]
        [InlineData("GET", 429, false, true)]
        [InlineData("POST", 429, false, true)]
        [InlineData("POST", 503, false, true)]
        [InlineData("GET", 500, false, true)]
        [InlineData("POST", 500, false, false)]
        [InlineData("POST", 500, true, true)]
        [InlineData("POST", 502, true, true)]
        [InlineData("GET", 501, false, false)]
        [InlineData("GET", 404, false, false)]
        [InlineData("POST", 400, true, false)]
        public void ClassifiesStatuses(string method, int status, bool hasKey, bool expected)
            => Assert.Equal(expected, RetryPolicy.IsRetryable(new HttpMethod(method), (HttpStatusCode)status, hasKey));

        [Fact]
        public void DelayIsJitteredWithinTheExponentialCap()
        {
            for (var attempt = 0; attempt < 6; attempt++)
            {
                var d = RetryPolicy.Delay(attempt, TimeSpan.FromMilliseconds(100), TimeSpan.FromSeconds(2), null);
                Assert.InRange(d.TotalMilliseconds, 0, Math.Min(100 * Math.Pow(2, attempt), 2000));
            }
        }

        [Fact]
        public void RetryAfterRaisesTheDelayButNeverPastTheMax()
        {
            Assert.Equal(TimeSpan.FromSeconds(3), RetryPolicy.Delay(0, TimeSpan.FromMilliseconds(10), TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(3)));
            Assert.Equal(TimeSpan.FromSeconds(30), RetryPolicy.Delay(0, TimeSpan.FromMilliseconds(10), TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(120)));
        }
    }

    public class ErrorParserTests
    {
        private static ThreeWsApiException Parse(int status, string body)
        {
            using var response = new HttpResponseMessage((HttpStatusCode)status);
            return ApiErrorParser.Create(response, body);
        }

        [Fact]
        public void ParsesTheFlatShape()
        {
            var ex = Parse(401, "{\"error\":\"unauthorized\",\"error_description\":\"sign in or provide a bearer token\"}");
            Assert.IsType<ThreeWsAuthenticationException>(ex);
            Assert.Equal("unauthorized", ex.ErrorCode);
            Assert.Equal("sign in or provide a bearer token", ex.Message);
        }

        [Fact]
        public void ParsesTheV1Envelope()
        {
            var ex = Parse(422, "{\"error\":{\"code\":\"validation_error\",\"message\":\"name is required\",\"details\":null},\"meta\":{\"requestId\":\"req_1\"}}");
            Assert.Equal("validation_error", ex.ErrorCode);
            Assert.Equal("name is required", ex.Message);
            Assert.Equal("req_1", ex.RequestId);
        }

        [Fact]
        public void ParsesTheX402Challenge()
        {
            var ex = Parse(401, "{\"x402Version\":2,\"error\":\"X-PAYMENT header is required\",\"accepts\":[]}");
            Assert.IsType<ThreeWsAuthenticationException>(ex);
            Assert.Equal("payment_required", ex.ErrorCode);
        }

        [Fact]
        public void KeepsAStatusCodeForANonJsonBody()
        {
            var ex = Parse(502, "<html>Bad gateway</html>");
            Assert.Equal("http_502", ex.ErrorCode);
            Assert.IsType<ThreeWsApiException>(ex);
        }

        [Fact]
        public void MapsNotFound()
            => Assert.IsType<ThreeWsNotFoundException>(Parse(404, "{\"error\":\"not_found\",\"error_description\":\"agent not found\"}"));
    }

    public class ParsingTests
    {
        [Fact]
        public async Task SseReaderJoinsMultilineDataAndSkipsComments()
        {
            var text = ": keepalive\n\ndata: {\"type\":\"chunk\",\n data: \"text\":\"hi\"}\n\ndata: {\"type\":\"done\"}\n\n";
            using var stream = new System.IO.MemoryStream(System.Text.Encoding.UTF8.GetBytes(text.Replace("\n data:", "\ndata:")));
            var events = new System.Collections.Generic.List<string>();
            await foreach (var e in SseReader.ReadDataAsync(stream, default)) events.Add(e);
            Assert.Equal(new[] { "{\"type\":\"chunk\",\n\"text\":\"hi\"}", "{\"type\":\"done\"}" }, events);
        }

        [Theory]
        [InlineData("queued", ForgeJobStatus.Queued, false)]
        [InlineData("running", ForgeJobStatus.Running, false)]
        [InlineData("done", ForgeJobStatus.Done, true)]
        [InlineData("failed", ForgeJobStatus.Failed, true)]
        [InlineData("needs_key", ForgeJobStatus.NeedsKey, true)]
        [InlineData("something_new", ForgeJobStatus.Unknown, false)]
        public void MapsJobStatus(string raw, ForgeJobStatus expected, bool terminal)
        {
            var job = new ForgeJob { RawStatus = raw };
            Assert.Equal(expected, job.Status);
            Assert.Equal(terminal, job.IsTerminal);
        }

        [Fact]
        public void PollIntervalFollowsTheEtaWithinBounds()
        {
            Assert.Equal(TimeSpan.FromSeconds(2), ForgeClient.NextPoll(new ForgeJob { EtaRemainingSeconds = 1 }));
            Assert.Equal(TimeSpan.FromSeconds(10), ForgeClient.NextPoll(new ForgeJob { EtaRemainingSeconds = 20 }));
            Assert.Equal(TimeSpan.FromSeconds(15), ForgeClient.NextPoll(new ForgeJob { EtaRemainingSeconds = 600 }));
        }

        [Fact]
        public void ResolvesPathsAgainstTheBaseAndKeepsFullHttpUrls()
        {
            using var http = new HttpClient();
            var transport = new ApiTransport(http, new ThreeWsClientOptions { BaseUrl = new Uri("https://three.ws") });
            Assert.Equal("https://three.ws/api/mcp-studio", transport.ResolveUrl("/api/mcp-studio").AbsoluteUri);
            Assert.Equal("https://three.ws/cdn/forge/a.glb", transport.ResolveUrl("/cdn/forge/a.glb").AbsoluteUri);
            Assert.Equal("https://cdn.example.org/a.glb", transport.ResolveUrl("https://cdn.example.org/a.glb").AbsoluteUri);
            Assert.True(transport.IsSameOrigin(transport.ResolveUrl("/mcp")));
            Assert.False(transport.IsSameOrigin(new Uri("https://cdn.example.org/a.glb")));
            Assert.False(transport.IsSameOrigin(new Uri("http://three.ws/mcp")));
        }

        [Fact]
        public void QueryStringEscapesAndSkipsNulls()
            => Assert.Equal("/api/catalog?q=red%20chair&limit=5", new QueryString("/api/catalog").Add("q", "red chair").Add("kind", (string?)null).Add("limit", 5).ToString());
    }
}
