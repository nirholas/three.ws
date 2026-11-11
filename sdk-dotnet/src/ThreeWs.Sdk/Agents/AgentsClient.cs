using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk.Internal;

namespace ThreeWs.Sdk.Agents
{
    /// <summary>
    /// three.ws agents: browse the public directory, manage your own agents, and talk to any agent with a
    /// streamed reply. Reach it through <see cref="ThreeWsClient.Agents"/>.
    /// </summary>
    public sealed class AgentsClient
    {
        private readonly ApiTransport _transport;

        internal AgentsClient(ApiTransport transport) => _transport = transport;

        /// <summary>Lists public agents. <c>GET /api/agents/public</c>. No key needed.</summary>
        public Task<PublicAgentPage> ListPublicAsync(PublicAgentQuery? query = null, CancellationToken cancellationToken = default)
        {
            query ??= new PublicAgentQuery();
            var path = new QueryString("/api/agents/public")
                .Add("q", string.IsNullOrWhiteSpace(query.Query) ? null : query.Query)
                .Add("skill", query.Skill)
                .Add("sort", query.Sort)
                .Add("limit", query.Limit)
                .Add("before", query.Before)
                .ToString();
            return _transport.SendJsonAsync(new RequestSpec { PathAndQuery = path, SendCredentials = false }, ThreeWsJsonContext.Default.PublicAgentPage, cancellationToken);
        }

        /// <summary>Gets one agent by id. <c>GET /api/agents/:id</c>. Throws <see cref="ThreeWsNotFoundException"/> for an unknown id.</summary>
        public async Task<PublicAgent> GetAsync(string agentId, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(agentId)) throw new ArgumentException("An agent id is required.", nameof(agentId));
            var envelope = await _transport.SendJsonAsync(
                new RequestSpec { PathAndQuery = "/api/agents/" + Uri.EscapeDataString(agentId) },
                ThreeWsJsonContext.Default.AgentEnvelope,
                cancellationToken).ConfigureAwait(false);
            return envelope.Agent ?? throw new ThreeWsNotFoundException("not_found", "agent not found", null, null);
        }

        /// <summary>Lists the agents your key or token owns. <c>GET /api/v1/agents</c>. Needs auth.</summary>
        public async Task<AgentPage> ListMineAsync(int? limit = null, string? cursor = null, CancellationToken cancellationToken = default)
        {
            var path = new QueryString("/api/v1/agents").Add("limit", limit).Add("cursor", cursor).ToString();
            var list = await _transport.SendJsonAsync(new RequestSpec { PathAndQuery = path }, ThreeWsJsonContext.Default.V1AgentList, cancellationToken).ConfigureAwait(false);
            return new AgentPage(list.Data, list.Meta?.HasMore ?? false, list.Meta?.NextCursor);
        }

        /// <summary>
        /// Creates an agent with a custodial wallet and a public page. <c>POST /api/v1/agents</c>. Needs auth.
        /// Sends an <c>Idempotency-Key</c> so a retried create returns the same agent.
        /// </summary>
        public async Task<Agent> CreateAsync(CreateAgentRequest request, CancellationToken cancellationToken = default)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Name)) throw new ArgumentException("Name is required.", nameof(request));
            var envelope = await _transport.SendJsonAsync(
                new RequestSpec
                {
                    Method = HttpMethod.Post,
                    PathAndQuery = "/api/v1/agents",
                    JsonBody = ApiTransport.Serialize(request, ThreeWsJsonContext.Default.CreateAgentRequest),
                    IdempotencyKey = request.IdempotencyKey ?? IdempotencyKeys.New(),
                },
                ThreeWsJsonContext.Default.V1CreateEnvelope,
                cancellationToken).ConfigureAwait(false);
            return envelope.Data?.Agent ?? throw new ThreeWsApiException(System.Net.HttpStatusCode.Created, "empty_response", "The server created the agent but returned no agent record.");
        }

        /// <summary>
        /// Sends a message and streams the reply as it is generated. <c>POST /api/chat</c>. Works without a key on
        /// the free lane. Yields chunk events, then one done event. An error event mid-stream ends enumeration with
        /// a <see cref="ThreeWsApiException"/> carrying its code.
        /// </summary>
        public async IAsyncEnumerable<AgentChatEvent> MessageStreamAsync(AgentMessageRequest request, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Message)) throw new ArgumentException("Message is required.", nameof(request));

            using var response = await _transport.SendAsync(
                new RequestSpec
                {
                    Method = HttpMethod.Post,
                    PathAndQuery = "/api/chat",
                    JsonBody = ApiTransport.Serialize(request, ThreeWsJsonContext.Default.AgentMessageRequest),
                    Accept = "text/event-stream",
                },
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);
            using var stream = await ApiTransport.ReadStreamAsync(response.Content, cancellationToken).ConfigureAwait(false);

            await foreach (var data in SseReader.ReadDataAsync(stream, cancellationToken).ConfigureAwait(false))
            {
                if (data == "[DONE]") yield break;
                AgentChatEvent? evt;
                try
                {
                    evt = JsonSerializer.Deserialize(data, ThreeWsJsonContext.Default.AgentChatEvent);
                }
                catch (JsonException)
                {
                    continue;
                }
                if (evt == null) continue;
                if (evt.Type == AgentChatEventType.Error)
                    throw new ThreeWsApiException(response.StatusCode, evt.ErrorCode ?? "stream_error", evt.Message ?? "The agent reply stream failed.");
                yield return evt;
                if (evt.Type == AgentChatEventType.Done) yield break;
            }
        }

        /// <summary>Streams a message to an agent. Shorthand for <see cref="MessageStreamAsync(AgentMessageRequest, CancellationToken)"/>.</summary>
        public IAsyncEnumerable<AgentChatEvent> MessageStreamAsync(string? agentId, string message, CancellationToken cancellationToken = default)
            => MessageStreamAsync(new AgentMessageRequest { AgentId = agentId, Message = message }, cancellationToken);

        /// <summary>Sends a message and returns the complete reply once streaming ends.</summary>
        public async Task<AgentChatEvent> MessageAsync(AgentMessageRequest request, CancellationToken cancellationToken = default)
        {
            var text = new StringBuilder();
            AgentChatEvent? done = null;
            await foreach (var evt in MessageStreamAsync(request, cancellationToken).ConfigureAwait(false))
            {
                if (evt.Type == AgentChatEventType.Chunk) text.Append(evt.Text);
                else if (evt.Type == AgentChatEventType.Done) done = evt;
            }
            done ??= new AgentChatEvent { RawType = "done" };
            if (string.IsNullOrEmpty(done.Reply)) done.Reply = text.ToString();
            return done;
        }
    }
}
