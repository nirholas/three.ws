using System.Text.Json.Serialization;
using ThreeWs.Sdk.Agents;
using ThreeWs.Sdk.Auth;
using ThreeWs.Sdk.Catalog;
using ThreeWs.Sdk.Forge;
using ThreeWs.Sdk.Mcp;

namespace ThreeWs.Sdk.Internal
{
    /// <summary>Source-generated serializers for every wire type: no reflection, trim and AOT safe.</summary>
    [JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonSerializable(typeof(ForgeRequest))]
    [JsonSerializable(typeof(ForgeJob))]
    [JsonSerializable(typeof(ForgeCatalog))]
    [JsonSerializable(typeof(RigBody))]
    [JsonSerializable(typeof(StudioBody))]
    [JsonSerializable(typeof(StudioResult))]
    [JsonSerializable(typeof(CatalogSearchResult))]
    [JsonSerializable(typeof(CatalogItemDetail))]
    [JsonSerializable(typeof(PublicAgentPage))]
    [JsonSerializable(typeof(AgentEnvelope))]
    [JsonSerializable(typeof(V1AgentList))]
    [JsonSerializable(typeof(V1CreateEnvelope))]
    [JsonSerializable(typeof(CreateAgentRequest))]
    [JsonSerializable(typeof(AgentMessageRequest))]
    [JsonSerializable(typeof(AgentChatEvent))]
    [JsonSerializable(typeof(JsonRpcRequest))]
    [JsonSerializable(typeof(JsonRpcResponse))]
    [JsonSerializable(typeof(ToolsListParams))]
    [JsonSerializable(typeof(ToolsListResult))]
    [JsonSerializable(typeof(ToolsCallParams))]
    [JsonSerializable(typeof(McpToolResult))]
    [JsonSerializable(typeof(WhoAmIEnvelope))]
    internal sealed partial class ThreeWsJsonContext : JsonSerializerContext
    {
    }
}
