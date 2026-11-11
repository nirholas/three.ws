using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk.Internal;

namespace ThreeWs.Sdk.Mcp
{
    /// <summary>
    /// Minimal MCP (streamable HTTP) client for the hosted three.ws servers: list tools and call one.
    /// Reach it through <see cref="ThreeWsClient.Mcp"/>.
    /// </summary>
    public sealed class McpClient
    {
        private readonly ApiTransport _transport;
        private long _nextId;

        internal McpClient(ApiTransport transport) => _transport = transport;

        /// <summary>
        /// Lists every tool on an MCP endpoint, following <c>nextCursor</c>. Defaults to the free studio server.
        /// The account server (<see cref="McpEndpoints.Account"/>) answers 401 without a key or token.
        /// </summary>
        public async Task<IReadOnlyList<McpTool>> ListToolsAsync(string endpoint = McpEndpoints.Studio, CancellationToken cancellationToken = default)
        {
            var tools = new List<McpTool>();
            string? cursor = null;
            do
            {
                JsonElement? param = cursor == null ? (JsonElement?)null
                    : JsonSerializer.SerializeToElement(new ToolsListParams { Cursor = cursor }, ThreeWsJsonContext.Default.ToolsListParams);
                var result = await RpcAsync(endpoint, "tools/list", param, cancellationToken).ConfigureAwait(false);
                var page = result.Deserialize(ThreeWsJsonContext.Default.ToolsListResult) ?? new ToolsListResult();
                tools.AddRange(page.Tools);
                cursor = string.IsNullOrEmpty(page.NextCursor) ? null : page.NextCursor;
            } while (cursor != null);
            return tools;
        }

        /// <summary>
        /// Calls a tool. <paramref name="arguments"/> must be a JSON object matching the tool's input schema
        /// (build one with <c>JsonDocument.Parse</c> or <c>JsonSerializer.SerializeToElement</c>).
        /// </summary>
        public async Task<McpToolResult> CallToolAsync(string name, JsonElement? arguments = null, string endpoint = McpEndpoints.Studio, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("A tool name is required.", nameof(name));
            var param = JsonSerializer.SerializeToElement(new ToolsCallParams { Name = name, Arguments = arguments }, ThreeWsJsonContext.Default.ToolsCallParams);
            var result = await RpcAsync(endpoint, "tools/call", param, cancellationToken).ConfigureAwait(false);
            return result.Deserialize(ThreeWsJsonContext.Default.McpToolResult) ?? new McpToolResult();
        }

        private async Task<JsonElement> RpcAsync(string endpoint, string method, JsonElement? param, CancellationToken cancellationToken)
        {
            var id = Interlocked.Increment(ref _nextId);
            var body = ApiTransport.Serialize(new JsonRpcRequest { Id = id, Method = method, Params = param }, ThreeWsJsonContext.Default.JsonRpcRequest);
            var uri = _transport.ResolveUrl(endpoint);
            var spec = new RequestSpec
            {
                Method = HttpMethod.Post,
                AbsoluteUri = uri,
                JsonBody = body,
                Accept = "application/json, text/event-stream",
                Headers = new Dictionary<string, string> { ["MCP-Protocol-Version"] = "2025-06-18" },
                SendCredentials = _transport.IsSameOrigin(uri),
            };

            using var response = await _transport.SendAsync(spec, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            using var stream = await ApiTransport.ReadStreamAsync(response.Content, cancellationToken).ConfigureAwait(false);

            JsonRpcResponse? rpc = null;
            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (string.Equals(mediaType, "text/event-stream", StringComparison.OrdinalIgnoreCase))
            {
                await foreach (var data in SseReader.ReadDataAsync(stream, cancellationToken).ConfigureAwait(false))
                {
                    var candidate = JsonSerializer.Deserialize(data, ThreeWsJsonContext.Default.JsonRpcResponse);
                    if (candidate?.Id is JsonElement got && got.ValueKind == JsonValueKind.Number && got.GetInt64() == id)
                    {
                        rpc = candidate;
                        break;
                    }
                }
            }
            else
            {
                rpc = await JsonSerializer.DeserializeAsync(stream, ThreeWsJsonContext.Default.JsonRpcResponse, cancellationToken).ConfigureAwait(false);
            }

            if (rpc == null)
                throw new ThreeWsApiException(response.StatusCode, "mcp_no_response", "The MCP server closed the stream without answering " + method + ".");
            if (rpc.Error != null)
                throw new ThreeWsApiException(response.StatusCode, "mcp_" + rpc.Error.Code, rpc.Error.Message ?? "MCP error " + rpc.Error.Code + ".");
            if (rpc.Result is JsonElement result) return result;
            throw new ThreeWsApiException(response.StatusCode, "mcp_no_result", "The MCP server answered " + method + " with no result.");
        }
    }
}
