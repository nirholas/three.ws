using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThreeWs.Sdk.Auth
{
    /// <summary>How the current request authenticated.</summary>
    public sealed class AuthInfo
    {
        /// <summary><c>apikey</c>, <c>oauth</c> or <c>session</c>.</summary>
        [JsonPropertyName("source")] public string? Source { get; set; }
        /// <summary>Granted scopes.</summary>
        [JsonPropertyName("scopes")] public IList<string>? Scopes { get; set; }
        /// <summary>API key id, when authenticated with a key.</summary>
        [JsonPropertyName("apiKeyId")] public string? ApiKeyId { get; set; }
        /// <summary>OAuth client id, when authenticated with a token.</summary>
        [JsonPropertyName("clientId")] public string? ClientId { get; set; }
    }

    /// <summary>The caller's identity. <c>GET /api/v1/me</c>.</summary>
    public sealed class WhoAmI
    {
        /// <summary>The account's user id.</summary>
        [JsonPropertyName("userId")] public string UserId { get; set; } = "";
        /// <summary>How this request authenticated.</summary>
        [JsonPropertyName("auth")] public AuthInfo? Auth { get; set; }
        /// <summary>Free-tier usage and limits.</summary>
        [JsonPropertyName("freeTier")] public JsonElement? FreeTier { get; set; }
    }

    internal sealed class WhoAmIEnvelope
    {
        [JsonPropertyName("data")] public WhoAmI? Data { get; set; }
    }
}
