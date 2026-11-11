using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk.Agents;
using ThreeWs.Sdk.Catalog;
using ThreeWs.Sdk.Forge;
using ThreeWs.Sdk.Mcp;
using Xunit;
using Xunit.Abstractions;

namespace ThreeWs.Sdk.Tests
{
    /// <summary>Runs against the live three.ws API (https://three.ws, or THREE_WS_BASE_URL). No key needed.</summary>
    [Trait("Category", "Live")]
    public class LiveCatalogTests
    {
        [Fact]
        public async Task SearchesTheCatalog()
        {
            using var client = TestEnv.Anonymous();
            var result = await client.Catalog.SearchAsync(new CatalogQuery { Query = "chair", Kind = CatalogKinds.Object, Limit = 5 });

            Assert.NotEmpty(result.Items);
            Assert.True(result.Items.Count <= 5);
            Assert.True(result.Matched >= result.Items.Count);
            Assert.All(result.Items, i =>
            {
                Assert.Equal(CatalogKinds.Object, i.Kind);
                Assert.StartsWith("https://", i.Url);
            });
            Assert.NotNull(result.Facets);
        }

        [Fact]
        public async Task GetsOneItemWithSnippets()
        {
            using var client = TestEnv.Anonymous();
            var first = (await client.Catalog.SearchAsync("lamp", limit: 1)).Items.Single();
            var detail = await client.Catalog.GetAsync(first.Id);

            Assert.Equal(first.Id, detail.Item.Id);
            Assert.NotEmpty(detail.Snippets);
            Assert.Contains("download", detail.Links.Keys);
        }

        [Fact]
        public async Task PagesThroughResults()
        {
            using var client = TestEnv.Anonymous();
            var ids = await client.Catalog.SearchAllAsync(new CatalogQuery { Query = "chair", Limit = 3 }).Take(7).Select(i => i.Id).ToListAsync();

            Assert.Equal(7, ids.Count);
            Assert.Equal(ids.Count, ids.Distinct().Count());
        }

        [Fact]
        public async Task UnknownItemIsATypedNotFound()
        {
            using var client = TestEnv.Anonymous();
            var ex = await Assert.ThrowsAsync<ThreeWsNotFoundException>(() => client.Catalog.GetAsync("object:does-not-exist-" + Guid.NewGuid().ToString("N")));
            Assert.Equal("not_found", ex.ErrorCode);
        }
    }

    [Trait("Category", "Live")]
    public class LiveForgeTests
    {
        private readonly ITestOutputHelper _out;
        public LiveForgeTests(ITestOutputHelper output) => _out = output;

        [Fact]
        public async Task ReadsTheLaneCatalog()
        {
            using var client = TestEnv.Anonymous();
            var catalog = await client.Forge.GetCatalogAsync();

            Assert.Contains(ForgePaths.Image, catalog.Paths);
            Assert.Contains(catalog.Tiers, t => t.Id == ForgeTiers.Draft);
            Assert.Contains(catalog.Backends, b => b.Free && b.Configured);
        }

        [Fact]
        public async Task StudioLaneGeneratesAndDownloadsARealGlb()
        {
            using var client = TestEnv.Anonymous();
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
            var prompt = "a small ceramic coffee mug, " + DateTime.UtcNow.ToString("yyyyMMddHHmm");

            var result = await client.Forge.StudioGenerateAndWaitAsync(prompt, ForgeTiers.Draft, cancellationToken: cts.Token);
            Assert.True(result.IsDone);
            Assert.False(string.IsNullOrEmpty(result.GlbUrl));

            var bytes = await DownloadAndCheck(client, result.GlbUrl!, cts.Token);
            _out.WriteLine($"studio lane: {bytes} bytes from {result.GlbUrl} (viewer {result.ViewerUrl})");
            Record("studio", result.GlbUrl!, bytes);
        }

        [Fact]
        public async Task ForgeLaneCreatesPollsAndDownloadsARealGlb()
        {
            using var client = TestEnv.Anonymous();
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(20));
            var catalog = await client.Forge.GetCatalogAsync(cts.Token);
            var lane = DefaultFreeLane(catalog, ForgeTiers.Draft);
            _out.WriteLine("lane: " + lane);

            var statuses = new System.Collections.Concurrent.ConcurrentQueue<string>();
            var job = await client.Forge.GenerateAsync(
                new ForgeRequest { Prompt = "a small wooden three-legged stool", Tier = ForgeTiers.Draft, Backend = lane },
                new SyncProgress<ForgeJob>(j => statuses.Enqueue(j.RawStatus ?? "?")),
                cts.Token);

            Assert.Equal(ForgeJobStatus.Done, job.Status);
            Assert.False(string.IsNullOrEmpty(job.GlbUrl));
            var bytes = await DownloadAndCheck(client, job.GlbUrl!, cts.Token);
            _out.WriteLine($"forge lane {job.Backend}: {bytes} bytes from {job.GlbUrl}; statuses {string.Join(",", statuses.Distinct())}");
            Record("forge-" + job.Backend, job.GlbUrl!, bytes);
        }

        [Fact]
        public async Task RigRejectsANonHttpUrlWithItsErrorCode()
        {
            using var client = TestEnv.Anonymous();
            var ex = await Assert.ThrowsAsync<ThreeWsApiException>(() => client.Forge.RigAsync("ftp://three.ws/model.glb"));
            Assert.Equal(HttpStatusCode.BadRequest, ex.StatusCode);
            Assert.Equal("invalid_glb_url", ex.ErrorCode);
        }

        [Fact]
        public async Task UnknownJobIsATypedError()
        {
            using var client = TestEnv.Anonymous();
            var ex = await Assert.ThrowsAnyAsync<ThreeWsApiException>(() => client.Forge.GetJobAsync("not-a-real-job"));
            Assert.InRange((int)ex.StatusCode, 400, 499);
            Assert.False(string.IsNullOrEmpty(ex.ErrorCode));
        }

        /// <summary>The lane the server itself names as the tier default, if free and live; else the first free live image lane.</summary>
        internal static string? DefaultFreeLane(ForgeCatalog catalog, string tier)
        {
            string? named = null;
            if (catalog.AdditionalData != null && catalog.AdditionalData.TryGetValue("default_backend_for_tier", out var map)
                && map.TryGetProperty(tier, out var byPath) && byPath.TryGetProperty(ForgePaths.Image, out var id))
                named = id.GetString();
            var live = catalog.Backends.Where(b => b.Free && b.Configured && b.Paths.Contains(ForgePaths.Image)).ToList();
            return live.Any(b => b.Id == named) ? named : live.FirstOrDefault()?.Id;
        }

        private static async Task<long> DownloadAndCheck(ThreeWsClient client, string url, CancellationToken ct)
        {
            var path = Path.Combine(Path.GetTempPath(), "threews-sdk-" + Guid.NewGuid().ToString("N") + ".glb");
            try
            {
                long bytes;
                using (var file = File.Create(path)) bytes = await client.Forge.DownloadAsync(url, file, ct);
                Assert.True(bytes > 1024, "a real model is larger than 1 KB");
                Assert.Equal(bytes, new FileInfo(path).Length);
                var head = new byte[12];
                using (var file = File.OpenRead(path)) _ = await file.ReadAsync(head, 0, 12, ct);
                Assert.Equal("glTF", System.Text.Encoding.ASCII.GetString(head, 0, 4));
                Assert.Equal(2u, BitConverter.ToUInt32(head, 4));
                Assert.Equal((uint)bytes, BitConverter.ToUInt32(head, 8));
                return bytes;
            }
            finally
            {
                File.Delete(path);
            }
        }

        private static void Record(string lane, string url, long bytes)
        {
            var dir = Environment.GetEnvironmentVariable("THREE_WS_EVIDENCE_DIR");
            if (string.IsNullOrEmpty(dir)) return;
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "generations.txt"), $"{DateTime.UtcNow:O} {TestEnv.SdkFramework} {lane} {bytes} {url}\n");
        }
    }

    [Trait("Category", "Live")]
    public class LiveAgentTests
    {
        private readonly ITestOutputHelper _out;
        public LiveAgentTests(ITestOutputHelper output) => _out = output;

        [Fact]
        public async Task ListsAndGetsPublicAgents()
        {
            using var client = TestEnv.Anonymous();
            var page = await client.Agents.ListPublicAsync(new PublicAgentQuery { Limit = 5 });

            Assert.NotEmpty(page.Agents);
            var first = page.Agents[0];
            var agent = await client.Agents.GetAsync(first.Id);
            Assert.Equal(first.Id, agent.Id);
            Assert.Equal(first.Name, agent.Name);
        }

        [Fact]
        public async Task UnknownAgentIsATypedNotFound()
        {
            using var client = TestEnv.Anonymous();
            var ex = await Assert.ThrowsAsync<ThreeWsNotFoundException>(() => client.Agents.GetAsync(Guid.NewGuid().ToString()));
            Assert.Equal("not_found", ex.ErrorCode);
        }

        [Fact]
        public async Task StreamsAnAgentReply()
        {
            using var client = TestEnv.Anonymous();
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            var chunks = 0;
            AgentChatEvent? done = null;
            await foreach (var evt in client.Agents.MessageStreamAsync(null, "Reply with exactly the word: pong", cts.Token))
            {
                if (evt.Type == AgentChatEventType.Chunk) chunks++;
                if (evt.Type == AgentChatEventType.Done) done = evt;
            }

            Assert.NotNull(done);
            Assert.True(chunks > 0);
            Assert.Contains("pong", done!.Reply, StringComparison.OrdinalIgnoreCase);
            _out.WriteLine($"{chunks} chunks, model {done.Model} via {done.Provider}: {done.Reply}");
        }

        [Fact]
        public async Task ListMineAndCreateNeedAuth()
        {
            using var client = TestEnv.Authenticated();
            if (TestEnv.ApiKey != null)
            {
                var page = await client.Agents.ListMineAsync(limit: 5);
                Assert.NotNull(page.Agents);
                return;
            }

            var list = await Assert.ThrowsAsync<ThreeWsAuthenticationException>(() => client.Agents.ListMineAsync());
            Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);
            Assert.Equal("unauthorized", list.ErrorCode);

            var create = await Assert.ThrowsAsync<ThreeWsAuthenticationException>(() => client.Agents.CreateAsync(new CreateAgentRequest { Name = "sdk test" }));
            Assert.Equal("unauthorized", create.ErrorCode);
            Assert.False(string.IsNullOrEmpty(create.RequestId), "the v1 envelope carries a request id");
        }

        [Fact]
        public async Task WhoAmINeedsAuth()
        {
            using var client = TestEnv.Authenticated();
            if (TestEnv.ApiKey != null)
            {
                var me = await client.Auth.WhoAmIAsync();
                Assert.False(string.IsNullOrEmpty(me.UserId));
                return;
            }
            var ex = await Assert.ThrowsAsync<ThreeWsAuthenticationException>(() => client.Auth.WhoAmIAsync());
            Assert.Equal("unauthorized", ex.ErrorCode);
        }
    }

    [Trait("Category", "Live")]
    public class LiveMcpTests
    {
        [Fact]
        public async Task ListsStudioTools()
        {
            using var client = TestEnv.Anonymous();
            var tools = await client.Mcp.ListToolsAsync();

            Assert.Contains(tools, t => t.Name == "forge_free");
            Assert.All(tools, t => Assert.Equal(JsonValueKind.Object, t.InputSchema.ValueKind));
        }

        [Fact]
        public async Task AccountServerNeedsAuth()
        {
            using var client = TestEnv.Authenticated();
            if (TestEnv.ApiKey != null)
            {
                Assert.NotEmpty(await client.Mcp.ListToolsAsync(McpEndpoints.Account));
                return;
            }
            var ex = await Assert.ThrowsAsync<ThreeWsAuthenticationException>(() => client.Mcp.ListToolsAsync(McpEndpoints.Account));
            Assert.Equal(HttpStatusCode.Unauthorized, ex.StatusCode);
            Assert.Equal("payment_required", ex.ErrorCode);
        }
    }

    internal sealed class SyncProgress<T> : IProgress<T>
    {
        private readonly Action<T> _report;
        public SyncProgress(Action<T> report) => _report = report;
        public void Report(T value) => _report(value);
    }

    internal static class AsyncEnumerableExtensions
    {
        public static async System.Collections.Generic.IAsyncEnumerable<T> Take<T>(this System.Collections.Generic.IAsyncEnumerable<T> source, int count)
        {
            if (count <= 0) yield break;
            var n = 0;
            await foreach (var item in source)
            {
                yield return item;
                if (++n >= count) yield break;
            }
        }

        public static async System.Collections.Generic.IAsyncEnumerable<TOut> Select<T, TOut>(this System.Collections.Generic.IAsyncEnumerable<T> source, Func<T, TOut> map)
        {
            await foreach (var item in source) yield return map(item);
        }

        public static async Task<System.Collections.Generic.List<T>> ToListAsync<T>(this System.Collections.Generic.IAsyncEnumerable<T> source)
        {
            var list = new System.Collections.Generic.List<T>();
            await foreach (var item in source) list.Add(item);
            return list;
        }
    }
}
