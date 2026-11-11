using System;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeWs.Sdk
{
    /// <summary>Configuration for <see cref="ThreeWsClient"/>.</summary>
    public sealed class ThreeWsClientOptions
    {
        /// <summary>Origin of the three.ws deployment. Defaults to <c>https://three.ws</c>.</summary>
        public Uri BaseUrl { get; set; } = new Uri("https://three.ws");

        /// <summary>
        /// A three.ws API key (<c>sk_live_…</c>), created at https://three.ws/dashboard/api.
        /// Sent as <c>Authorization: Bearer</c>. Keep it server-side; never ship it in a game or app build.
        /// </summary>
        public string? ApiKey { get; set; }

        /// <summary>A static OAuth access token. Prefer <see cref="AccessTokenProvider"/> when the token refreshes.</summary>
        public string? AccessToken { get; set; }

        /// <summary>
        /// Called before each request to obtain a current OAuth access token. Takes precedence over
        /// <see cref="AccessToken"/> and <see cref="ApiKey"/>. Return null to send the request unauthenticated.
        /// </summary>
        public Func<CancellationToken, ValueTask<string?>>? AccessTokenProvider { get; set; }

        /// <summary>How many times a retryable failure (429, 5xx, network error) is retried. Defaults to 3.</summary>
        public int MaxRetries { get; set; } = 3;

        /// <summary>First backoff step; each retry doubles it, with full jitter. Defaults to 500 ms.</summary>
        public TimeSpan RetryBaseDelay { get; set; } = TimeSpan.FromMilliseconds(500);

        /// <summary>Upper bound for one backoff wait, including a server <c>Retry-After</c>. Defaults to 30 s.</summary>
        public TimeSpan RetryMaxDelay { get; set; } = TimeSpan.FromSeconds(30);

        /// <summary>Appended to the SDK's User-Agent, e.g. <c>"my-app/2.1"</c>.</summary>
        public string? UserAgentSuffix { get; set; }
    }
}
