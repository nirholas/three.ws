using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThreeWs.Sdk.Mcp
{
    /// <summary>Hosted three.ws MCP endpoints.</summary>
    public static class McpEndpoints
    {
        /// <summary>The free 3D studio server: no key, no payment. The default.</summary>
        public const string Studio = "/api/mcp-studio";
        /// <summary>The full account server: needs an API key or OAuth token (or an x402 payment per call).</summary>
        public const string Account = "/mcp";
    }

    /// <summary>An MCP tool definition.</summary>
    public sealed class McpTool
    {
        /// <summary>Tool name to pass to <see cref="McpClient.CallToolAsync"/>.</summary>
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        /// <summary>Human title.</summary>
        [JsonPropertyName("title")] public string? Title { get; set; }
        /// <summary>What the tool does and when to use it.</summary>
        [JsonPropertyName("description")] public string? Description { get; set; }
        /// <summary>JSON Schema of the arguments.</summary>
        [JsonPropertyName("inputSchema")] public JsonElement InputSchema { get; set; }
        /// <summary>JSON Schema of the structured result, when declared.</summary>
        [JsonPropertyName("outputSchema")] public JsonElement? OutputSchema { get; set; }
        /// <summary>Every other field (annotations, _meta).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    internal sealed class JsonRpcRequest
    {
        [JsonPropertyName("jsonrpc")] public string JsonRpc { get; set; } = "2.0";
        [JsonPropertyName("id")] public long Id { get; set; }
        [JsonPropertyName("method")] public string Method { get; set; } = "";
        [JsonPropertyName("params")] public JsonElement? Params { get; set; }
    }

    internal sealed class JsonRpcError
    {
        [JsonPropertyName("code")] public int Code { get; set; }
        [JsonPropertyName("message")] public string? Message { get; set; }
    }

    internal sealed class JsonRpcResponse
    {
        [JsonPropertyName("id")] public JsonElement? Id { get; set; }
        [JsonPropertyName("result")] public JsonElement? Result { get; set; }
        [JsonPropertyName("error")] public JsonRpcError? Error { get; set; }
    }

    internal sealed class ToolsListResult
    {
        [JsonPropertyName("tools")] public IList<McpTool> Tools { get; set; } = new List<McpTool>();
        [JsonPropertyName("nextCursor")] public string? NextCursor { get; set; }
    }

    internal sealed class ToolsListParams
    {
        [JsonPropertyName("cursor")] public string? Cursor { get; set; }
    }

    internal sealed class ToolsCallParams
    {
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("arguments")] public JsonElement? Arguments { get; set; }
    }

    /// <summary>One content block in a tool result.</summary>
    public sealed class McpContent
    {
        /// <summary><c>text</c>, <c>image</c>, <c>resource</c> or another MCP content type.</summary>
        [JsonPropertyName("type")] public string Type { get; set; } = "";
        /// <summary>Text, for a text block.</summary>
        [JsonPropertyName("text")] public string? Text { get; set; }
        /// <summary>Every other field.</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    /// <summary>The result of <c>tools/call</c>.</summary>
    public sealed class McpToolResult
    {
        /// <summary>Content blocks.</summary>
        [JsonPropertyName("content")] public IList<McpContent> Content { get; set; } = new List<McpContent>();
        /// <summary>Structured result, when the tool declares an output schema.</summary>
        [JsonPropertyName("structuredContent")] public JsonElement? StructuredContent { get; set; }
        /// <summary>True when the tool reported a failure.</summary>
        [JsonPropertyName("isError")] public bool IsError { get; set; }
    }
}
