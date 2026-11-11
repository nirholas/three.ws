using Microsoft.SemanticKernel;
using ModelContextProtocol.Client;

namespace ThreeWs.SemanticKernel;

/// <summary>
/// Connects the hosted three.ws 3D Studio MCP server (<c>https://three.ws/api/mcp-studio</c>,
/// Streamable HTTP, free, no key) so its tools can join a Semantic Kernel kernel
/// or a Microsoft Agent Framework agent.
/// </summary>
public static class ThreeWsMcp
{
    /// <summary>Opens an MCP client session to the three.ws studio server.</summary>
    /// <param name="baseUrl">The three.ws origin; defaults to <c>THREE_WS_BASE_URL</c> or production.</param>
    /// <param name="ct">Cancellation.</param>
    /// <returns>A connected client. Dispose it when done; its tools stop working after that.</returns>
    public static Task<McpClient> ConnectAsync(string? baseUrl = null, CancellationToken ct = default)
    {
        var origin = (baseUrl ?? Environment.GetEnvironmentVariable("THREE_WS_BASE_URL") ?? ThreeWsClient.DefaultBaseUrl).TrimEnd('/');
        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Name = "three.ws studio",
            Endpoint = new Uri($"{origin}{ThreeWsClient.StudioMcpPath}"),
            TransportMode = HttpTransportMode.StreamableHttp,
        });
        return McpClient.CreateAsync(transport, cancellationToken: ct);
    }

    /// <summary>
    /// Lists the studio server's tools and adds them to the kernel as one plugin.
    /// The returned client owns the session: keep it alive while the kernel uses
    /// the tools, then dispose it.
    /// </summary>
    /// <param name="kernel">The kernel to extend.</param>
    /// <param name="pluginName">The plugin name the tools are grouped under.</param>
    /// <param name="baseUrl">The three.ws origin.</param>
    /// <param name="ct">Cancellation.</param>
    public static async Task<McpClient> AddThreeWsStudioMcpAsync(this Kernel kernel, string pluginName = "threews_studio", string? baseUrl = null, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(kernel);
        var client = await ConnectAsync(baseUrl, ct).ConfigureAwait(false);
        try
        {
            var tools = await client.ListToolsAsync(cancellationToken: ct).ConfigureAwait(false);
#pragma warning disable SKEXP0001 // AIFunction to KernelFunction bridge is the documented SK path for MCP tools.
            kernel.Plugins.AddFromFunctions(pluginName, tools.Select(t => t.AsKernelFunction()));
#pragma warning restore SKEXP0001
            return client;
        }
        catch
        {
            await client.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }
}
