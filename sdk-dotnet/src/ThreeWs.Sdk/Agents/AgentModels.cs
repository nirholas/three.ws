using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThreeWs.Sdk.Agents
{
    /// <summary>A public agent from the directory or <c>GET /api/agents/:id</c>.</summary>
    public sealed class PublicAgent
    {
        /// <summary>Agent id (UUID).</summary>
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        /// <summary>Display name.</summary>
        [JsonPropertyName("name")] public string? Name { get; set; }
        /// <summary>Short description.</summary>
        [JsonPropertyName("description")] public string? Description { get; set; }
        /// <summary>Installed skills.</summary>
        [JsonPropertyName("skills")] public IList<string>? Skills { get; set; }
        /// <summary>Avatar thumbnail URL.</summary>
        [JsonPropertyName("avatar_thumbnail")] public string? AvatarThumbnail { get; set; }
        /// <summary>The agent's 3D body (GLB).</summary>
        [JsonPropertyName("avatar_model_url")] public string? AvatarModelUrl { get; set; }
        /// <summary>The agent's public page.</summary>
        [JsonPropertyName("home_url")] public string? HomeUrl { get; set; }
        /// <summary>Conversations held.</summary>
        [JsonPropertyName("chat_count")] public long? ChatCount { get; set; }
        /// <summary>Registered on chain.</summary>
        [JsonPropertyName("is_registered")] public bool? IsRegistered { get; set; }
        /// <summary>Creation time (ISO 8601).</summary>
        [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
        /// <summary>Last activity (ISO 8601).</summary>
        [JsonPropertyName("last_action_at")] public string? LastActionAt { get; set; }
        /// <summary>Every other field (on-chain identity, wallet, persona, embed policy).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    /// <summary>Filters for <see cref="AgentsClient.ListPublicAsync"/>.</summary>
    public sealed class PublicAgentQuery
    {
        /// <summary>Free-text search.</summary>
        public string? Query { get; set; }
        /// <summary>Only agents with this skill.</summary>
        public string? Skill { get; set; }
        /// <summary>Sort order accepted by the directory, for example <c>recent</c> or <c>popular</c>.</summary>
        public string? Sort { get; set; }
        /// <summary>Page size, up to 48.</summary>
        public int? Limit { get; set; }
        /// <summary>Cursor from <see cref="PublicAgentPage.NextCursor"/>.</summary>
        public string? Before { get; set; }
    }

    /// <summary>One page of the public agent directory.</summary>
    public sealed class PublicAgentPage
    {
        /// <summary>This page.</summary>
        [JsonPropertyName("agents")] public IList<PublicAgent> Agents { get; set; } = new List<PublicAgent>();
        /// <summary>Agents on this page.</summary>
        [JsonPropertyName("count")] public int Count { get; set; }
        /// <summary>True when another page exists.</summary>
        [JsonPropertyName("has_more")] public bool HasMore { get; set; }
        /// <summary>Pass as <see cref="PublicAgentQuery.Before"/> for the next page.</summary>
        [JsonPropertyName("next_cursor")] public string? NextCursor { get; set; }
    }

    internal sealed class AgentEnvelope
    {
        [JsonPropertyName("agent")] public PublicAgent? Agent { get; set; }
    }

    /// <summary>The agent's wallets.</summary>
    public sealed class AgentWallet
    {
        /// <summary>Solana address.</summary>
        [JsonPropertyName("solana")] public string? Solana { get; set; }
        /// <summary>EVM address.</summary>
        [JsonPropertyName("evm")] public string? Evm { get; set; }
    }

    /// <summary>An agent you own, as the v1 API returns it.</summary>
    public sealed class Agent
    {
        /// <summary>Agent id (UUID).</summary>
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        /// <summary>Display name.</summary>
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        /// <summary>Persona.</summary>
        [JsonPropertyName("persona")] public string? Persona { get; set; }
        /// <summary>System prompt.</summary>
        [JsonPropertyName("systemPrompt")] public string? SystemPrompt { get; set; }
        /// <summary>Model id.</summary>
        [JsonPropertyName("model")] public string? Model { get; set; }
        /// <summary>Sampling temperature.</summary>
        [JsonPropertyName("temperature")] public double? Temperature { get; set; }
        /// <summary>Installed skills.</summary>
        [JsonPropertyName("skills")] public IList<string>? Skills { get; set; }
        /// <summary>Lifecycle status.</summary>
        [JsonPropertyName("status")] public string? Status { get; set; }
        /// <summary>Custodial wallets.</summary>
        [JsonPropertyName("wallet")] public AgentWallet? Wallet { get; set; }
        /// <summary>Avatar id.</summary>
        [JsonPropertyName("avatarId")] public string? AvatarId { get; set; }
        /// <summary>Listed in the public directory.</summary>
        [JsonPropertyName("isPublic")] public bool? IsPublic { get; set; }
        /// <summary>Public page.</summary>
        [JsonPropertyName("url")] public string? Url { get; set; }
        /// <summary>Creation time (ISO 8601).</summary>
        [JsonPropertyName("createdAt")] public string? CreatedAt { get; set; }
        /// <summary>Last update (ISO 8601).</summary>
        [JsonPropertyName("updatedAt")] public string? UpdatedAt { get; set; }
        /// <summary>Every other field (strategy, inference budget).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    /// <summary>Body for <see cref="AgentsClient.CreateAsync"/>. <c>POST /api/v1/agents</c>.</summary>
    public sealed class CreateAgentRequest
    {
        /// <summary>Display name, up to 80 characters. Required.</summary>
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        /// <summary>Persona, up to 500 characters.</summary>
        [JsonPropertyName("persona")] public string? Persona { get; set; }
        /// <summary>System prompt.</summary>
        [JsonPropertyName("systemPrompt")] public string? SystemPrompt { get; set; }
        /// <summary>Model id.</summary>
        [JsonPropertyName("model")] public string? Model { get; set; }
        /// <summary>Sampling temperature, 0 to 2.</summary>
        [JsonPropertyName("temperature")] public double? Temperature { get; set; }
        /// <summary>Skills to install.</summary>
        [JsonPropertyName("skills")] public IList<string>? Skills { get; set; }
        /// <summary>Idempotency key; a fresh one is generated when null.</summary>
        [JsonIgnore] public string? IdempotencyKey { get; set; }
    }

    internal sealed class V1Meta
    {
        [JsonPropertyName("hasMore")] public bool HasMore { get; set; }
        [JsonPropertyName("nextCursor")] public string? NextCursor { get; set; }
        [JsonPropertyName("requestId")] public string? RequestId { get; set; }
    }

    internal sealed class V1AgentList
    {
        [JsonPropertyName("data")] public IList<Agent> Data { get; set; } = new List<Agent>();
        [JsonPropertyName("meta")] public V1Meta? Meta { get; set; }
    }

    internal sealed class V1CreatedAgent
    {
        [JsonPropertyName("agent")] public Agent? Agent { get; set; }
    }

    internal sealed class V1CreateEnvelope
    {
        [JsonPropertyName("data")] public V1CreatedAgent? Data { get; set; }
    }

    /// <summary>One page of your agents.</summary>
    public sealed class AgentPage
    {
        /// <summary>Creates a page.</summary>
        public AgentPage(IList<Agent> agents, bool hasMore, string? nextCursor)
        {
            Agents = agents;
            HasMore = hasMore;
            NextCursor = nextCursor;
        }

        /// <summary>This page.</summary>
        public IList<Agent> Agents { get; }
        /// <summary>True when another page exists.</summary>
        public bool HasMore { get; }
        /// <summary>Pass back to fetch the next page.</summary>
        public string? NextCursor { get; }
    }

    /// <summary>A prior turn in a conversation.</summary>
    public sealed class ChatTurn
    {
        /// <summary>Creates a turn.</summary>
        public ChatTurn(string role, string content)
        {
            Role = role;
            Content = content;
        }

        /// <summary><c>user</c> or <c>assistant</c>.</summary>
        [JsonPropertyName("role")] public string Role { get; set; }
        /// <summary>The text.</summary>
        [JsonPropertyName("content")] public string Content { get; set; }
    }

    /// <summary>A message to an agent. <c>POST /api/chat</c>.</summary>
    public sealed class AgentMessageRequest
    {
        /// <summary>The message, 1 to 4000 characters.</summary>
        [JsonPropertyName("message")] public string Message { get; set; } = "";
        /// <summary>The agent to talk to (UUID). Null talks to the platform assistant.</summary>
        [JsonPropertyName("agentId")] public string? AgentId { get; set; }
        /// <summary>Up to 20 prior turns.</summary>
        [JsonPropertyName("history")] public IList<ChatTurn>? History { get; set; }
        /// <summary>Free-form page or app context the agent should know.</summary>
        [JsonPropertyName("context")] public string? Context { get; set; }
        /// <summary>Inference provider override.</summary>
        [JsonPropertyName("provider")] public string? Provider { get; set; }
        /// <summary>Model override.</summary>
        [JsonPropertyName("model")] public string? Model { get; set; }
    }

    /// <summary>Kinds of streamed chat event.</summary>
    public enum AgentChatEventType
    {
        /// <summary>An event type this SDK version does not know; inspect <see cref="AgentChatEvent.Raw"/>.</summary>
        Other,
        /// <summary>A piece of the reply; append <see cref="AgentChatEvent.Text"/>.</summary>
        Chunk,
        /// <summary>The final event; <see cref="AgentChatEvent.Reply"/> holds the whole reply.</summary>
        Done,
        /// <summary>The stream failed; see <see cref="AgentChatEvent.ErrorCode"/>.</summary>
        Error,
    }

    /// <summary>One server-sent event from an agent reply.</summary>
    public sealed class AgentChatEvent
    {
        /// <summary>The event type string as sent.</summary>
        [JsonPropertyName("type")] public string? RawType { get; set; }
        /// <summary>Reply text in a chunk event.</summary>
        [JsonPropertyName("text")] public string? Text { get; set; }
        /// <summary>The full reply in the done event.</summary>
        [JsonPropertyName("reply")] public string? Reply { get; set; }
        /// <summary>Model that answered (done event).</summary>
        [JsonPropertyName("model")] public string? Model { get; set; }
        /// <summary>Provider that answered (done event).</summary>
        [JsonPropertyName("provider")] public string? Provider { get; set; }
        /// <summary>Error code (error event).</summary>
        [JsonPropertyName("code")] public string? ErrorCode { get; set; }
        /// <summary>Error message (error event).</summary>
        [JsonPropertyName("message")] public string? Message { get; set; }
        /// <summary>Every other field (actions, recalled memories, skills applied).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? Raw { get; set; }

        /// <summary>Parsed <see cref="RawType"/>.</summary>
        [JsonIgnore]
        public AgentChatEventType Type => RawType switch
        {
            "chunk" => AgentChatEventType.Chunk,
            "done" => AgentChatEventType.Done,
            "error" => AgentChatEventType.Error,
            _ => AgentChatEventType.Other,
        };
    }
}
