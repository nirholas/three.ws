using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk.Internal;

namespace ThreeWs.Sdk.Auth
{
    /// <summary>
    /// Credential checks. Credentials themselves are set on <see cref="ThreeWsClientOptions"/>
    /// (<see cref="ThreeWsClientOptions.ApiKey"/>, <see cref="ThreeWsClientOptions.AccessToken"/> or
    /// <see cref="ThreeWsClientOptions.AccessTokenProvider"/>). Reach it through <see cref="ThreeWsClient.Auth"/>.
    /// </summary>
    public sealed class AuthClient
    {
        private readonly ApiTransport _transport;

        internal AuthClient(ApiTransport transport) => _transport = transport;

        /// <summary>True when the client has an API key, token or token provider configured.</summary>
        public bool HasCredentials => _transport.HasCredentials;

        /// <summary>
        /// Returns who the configured credential belongs to and its scopes. <c>GET /api/v1/me</c>.
        /// Throws <see cref="ThreeWsAuthenticationException"/> when the credential is missing, invalid or revoked.
        /// </summary>
        public async Task<WhoAmI> WhoAmIAsync(CancellationToken cancellationToken = default)
        {
            var envelope = await _transport.SendJsonAsync(new RequestSpec { PathAndQuery = "/api/v1/me" }, ThreeWsJsonContext.Default.WhoAmIEnvelope, cancellationToken).ConfigureAwait(false);
            return envelope.Data ?? throw new ThreeWsAuthenticationException(System.Net.HttpStatusCode.Unauthorized, "unauthorized", "The server returned no identity for this credential.");
        }
    }
}
