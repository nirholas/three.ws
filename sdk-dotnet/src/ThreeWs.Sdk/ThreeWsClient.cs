using System;
using System.Net.Http;
using ThreeWs.Sdk.Agents;
using ThreeWs.Sdk.Auth;
using ThreeWs.Sdk.Catalog;
using ThreeWs.Sdk.Forge;
using ThreeWs.Sdk.Internal;
using ThreeWs.Sdk.Mcp;

namespace ThreeWs.Sdk
{
    /// <summary>
    /// Entry point to the three.ws API. Thread-safe; create one and reuse it.
    /// </summary>
    /// <example>
    /// <code>
    /// using var client = new ThreeWsClient();
    /// var job = await client.Forge.GenerateAsync(new ForgeRequest { Prompt = "a ceramic teapot", Tier = ForgeTiers.Draft });
    /// using var file = File.Create("teapot.glb");
    /// await client.Forge.DownloadAsync(job.GlbUrl!, file);
    /// </code>
    /// </example>
    public sealed class ThreeWsClient : IDisposable
    {
        private readonly HttpClient _http;
        private readonly bool _ownsHttp;

        /// <summary>Creates a client that owns its own <see cref="HttpClient"/>.</summary>
        public ThreeWsClient(ThreeWsClientOptions? options = null)
            : this(new HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan }, options, ownsHttp: true)
        {
        }

        /// <summary>
        /// Creates a client over a caller-supplied <see cref="HttpClient"/>, for example one from
        /// <c>IHttpClientFactory</c>. The client is not disposed with this instance. Its <c>BaseAddress</c>
        /// is ignored; set <see cref="ThreeWsClientOptions.BaseUrl"/> instead.
        /// </summary>
        public ThreeWsClient(HttpClient httpClient, ThreeWsClientOptions? options = null)
            : this(httpClient ?? throw new ArgumentNullException(nameof(httpClient)), options, ownsHttp: false)
        {
        }

        private ThreeWsClient(HttpClient http, ThreeWsClientOptions? options, bool ownsHttp)
        {
            _http = http;
            _ownsHttp = ownsHttp;
            Options = options ?? new ThreeWsClientOptions();
            if (Options.BaseUrl == null || !Options.BaseUrl.IsAbsoluteUri)
                throw new ArgumentException("BaseUrl must be an absolute URI.", nameof(options));
            if (Options.MaxRetries < 0)
                throw new ArgumentException("MaxRetries cannot be negative.", nameof(options));

            var transport = new ApiTransport(_http, Options);
            Forge = new ForgeClient(transport);
            Catalog = new CatalogClient(transport);
            Agents = new AgentsClient(transport);
            Mcp = new McpClient(transport);
            Auth = new AuthClient(transport);
        }

        /// <summary>The options this client was built with.</summary>
        public ThreeWsClientOptions Options { get; }

        /// <summary>Text, image and sketch to 3D, rigging, polling and GLB download.</summary>
        public ForgeClient Forge { get; }

        /// <summary>The free 3D asset catalog.</summary>
        public CatalogClient Catalog { get; }

        /// <summary>Agents: directory, your agents, streamed messaging.</summary>
        public AgentsClient Agents { get; }

        /// <summary>MCP tool listing and calls on the hosted servers.</summary>
        public McpClient Mcp { get; }

        /// <summary>Credential checks.</summary>
        public AuthClient Auth { get; }

        /// <summary>Disposes the owned <see cref="HttpClient"/>; a caller-supplied one is left alone.</summary>
        public void Dispose()
        {
            if (_ownsHttp) _http.Dispose();
        }
    }
}
