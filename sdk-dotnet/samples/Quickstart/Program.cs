using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk;
using ThreeWs.Sdk.Agents;
using ThreeWs.Sdk.Catalog;
using ThreeWs.Sdk.Forge;

// Usage: dotnet run --project samples/Quickstart -- "a brass desk lamp" [out.glb]
// Generates a model on the free lane, saves the GLB, then shows the catalog, MCP and agent chat surfaces.
// Set THREE_WS_API_KEY to also list the agents your key owns.
internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        var prompt = args.Length > 0 ? args[0] : "a brass desk lamp";
        var output = args.Length > 1 ? args[1] : "model.glb";
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

        using var client = new ThreeWsClient(new ThreeWsClientOptions
        {
            ApiKey = Environment.GetEnvironmentVariable("THREE_WS_API_KEY"),
            UserAgentSuffix = "quickstart",
        });

        try
        {
            Console.WriteLine($"Generating \"{prompt}\" on the free Studio lane...");
            var model = await client.Forge.StudioGenerateAndWaitAsync(
                prompt,
                ForgeTiers.Draft,
                new Progress<StudioResult>(r => { if (r.IsPending) Console.WriteLine($"  pending, about {r.EtaSeconds ?? 0}s left. Watch: {r.WatchUrl}"); }),
                cts.Token);

            using (var file = File.Create(output))
            {
                var bytes = await client.Forge.DownloadAsync(model.GlbUrl!, file, cts.Token);
                Console.WriteLine($"Saved {bytes:N0} bytes to {Path.GetFullPath(output)}");
            }
            Console.WriteLine($"View it: {model.ViewerUrl}");

            var assets = await client.Catalog.SearchAsync(new CatalogQuery { Query = prompt, Limit = 3 }, cts.Token);
            Console.WriteLine($"Ready-made catalog matches ({assets.Matched}):");
            foreach (var item in assets.Items) Console.WriteLine($"  {item.Title} [{item.License}] {item.Url}");

            var tools = await client.Mcp.ListToolsAsync(cancellationToken: cts.Token);
            Console.WriteLine($"Free MCP tools: {string.Join(", ", tools.Select(t => t.Name))}");

            Console.Write("Agent: ");
            await foreach (var evt in client.Agents.MessageStreamAsync(null, $"In one sentence, how would you use a 3D model of {prompt} in a game?", cts.Token))
                if (evt.Type == AgentChatEventType.Chunk) Console.Write(evt.Text);
            Console.WriteLine();

            if (client.Auth.HasCredentials)
            {
                var mine = await client.Agents.ListMineAsync(limit: 10, cancellationToken: cts.Token);
                Console.WriteLine($"Your agents: {string.Join(", ", mine.Agents.Select(a => a.Name))}");
            }
            return 0;
        }
        catch (ThreeWsApiException ex)
        {
            Console.Error.WriteLine($"three.ws error {(int)ex.StatusCode} {ex.ErrorCode}: {ex.Message}" + (ex.RequestId != null ? $" (request {ex.RequestId})" : ""));
            return 1;
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Cancelled.");
            return 2;
        }
    }
}
