using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeWs.Sdk.Internal
{
    /// <summary>Per-call settings for <see cref="ApiTransport"/>.</summary>
    internal sealed class RequestSpec
    {
        public HttpMethod Method { get; set; } = HttpMethod.Get;
        public string PathAndQuery { get; set; } = "/";
        public Uri? AbsoluteUri { get; set; }
        public byte[]? JsonBody { get; set; }
        public string? IdempotencyKey { get; set; }
        public string Accept { get; set; } = "application/json";
        public bool SendCredentials { get; set; } = true;
        public IDictionary<string, string>? Headers { get; set; }
    }

    /// <summary>
    /// The one place requests are built, authenticated, sent and retried. Each attempt gets a fresh
    /// <see cref="HttpRequestMessage"/>, so a body can be resent safely.
    /// </summary>
    internal sealed class ApiTransport
    {
        private static readonly string SdkVersion = typeof(ApiTransport).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";

        private readonly HttpClient _http;
        private readonly ThreeWsClientOptions _options;
        private readonly string _userAgent;

        public ApiTransport(HttpClient http, ThreeWsClientOptions options)
        {
            _http = http;
            _options = options;
            _userAgent = "ThreeWs.Sdk/" + SdkVersion + " (.NET)" + (string.IsNullOrWhiteSpace(options.UserAgentSuffix) ? "" : " " + options.UserAgentSuffix);
        }

        public ThreeWsClientOptions Options => _options;

        public Uri Resolve(string pathAndQuery) => new Uri(_options.BaseUrl, pathAndQuery);

        /// <summary>
        /// Resolves a full http(s) URL as is and anything else (a path such as <c>/cdn/x.glb</c>) against the base URL.
        /// A bare <see cref="Uri.TryCreate(string, UriKind, out Uri)"/> would read <c>/path</c> as a <c>file:</c> URI on Linux and macOS.
        /// </summary>
        public Uri ResolveUrl(string urlOrPath)
        {
            if (Uri.TryCreate(urlOrPath, UriKind.Absolute, out var abs)
                && (abs.Scheme == Uri.UriSchemeHttp || abs.Scheme == Uri.UriSchemeHttps))
                return abs;
            return Resolve(urlOrPath);
        }

        /// <summary>True when <paramref name="uri"/> has the base URL's scheme, host and port, so it may carry credentials.</summary>
        public bool IsSameOrigin(Uri uri)
            => Uri.Compare(uri, _options.BaseUrl, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

        /// <summary>Sends the request and deserializes a 2xx JSON body.</summary>
        public async Task<T> SendJsonAsync<T>(RequestSpec spec, JsonTypeInfo<T> responseType, CancellationToken cancellationToken)
        {
            using var response = await SendAsync(spec, HttpCompletionOption.ResponseContentRead, cancellationToken).ConfigureAwait(false);
            using var stream = await ReadStreamAsync(response.Content, cancellationToken).ConfigureAwait(false);
            var value = await JsonSerializer.DeserializeAsync(stream, responseType, cancellationToken).ConfigureAwait(false);
            if (value == null)
                throw new ThreeWsApiException(response.StatusCode, "empty_response", "The server answered with an empty body.");
            return value;
        }

        /// <summary>
        /// Sends with retries and returns a successful response. The caller owns and disposes it.
        /// Non-2xx answers become typed exceptions once retries are spent.
        /// </summary>
        public async Task<HttpResponseMessage> SendAsync(RequestSpec spec, HttpCompletionOption completion, CancellationToken cancellationToken)
        {
            var hasKey = !string.IsNullOrEmpty(spec.IdempotencyKey);
            for (var attempt = 0; ; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                HttpResponseMessage response;
                using (var request = await BuildRequestAsync(spec, cancellationToken).ConfigureAwait(false))
                {
                    try
                    {
                        response = await _http.SendAsync(request, completion, cancellationToken).ConfigureAwait(false);
                    }
                    catch (HttpRequestException) when (attempt < _options.MaxRetries && RetryPolicy.IsRetryableNetworkFailure(spec.Method, hasKey))
                    {
                        await Task.Delay(RetryPolicy.Delay(attempt, _options.RetryBaseDelay, _options.RetryMaxDelay, null), cancellationToken).ConfigureAwait(false);
                        continue;
                    }
                }

                if (response.IsSuccessStatusCode) return response;

                var retryable = attempt < _options.MaxRetries && RetryPolicy.IsRetryable(spec.Method, response.StatusCode, hasKey);
                if (retryable)
                {
                    var retryAfter = RetryPolicy.ParseRetryAfter(response);
                    response.Dispose();
                    await Task.Delay(RetryPolicy.Delay(attempt, _options.RetryBaseDelay, _options.RetryMaxDelay, retryAfter), cancellationToken).ConfigureAwait(false);
                    continue;
                }

                string body;
                using (response)
                {
                    body = await ReadStringAsync(response.Content, cancellationToken).ConfigureAwait(false);
                    throw ApiErrorParser.Create(response, body);
                }
            }
        }

        private async Task<HttpRequestMessage> BuildRequestAsync(RequestSpec spec, CancellationToken cancellationToken)
        {
            var request = new HttpRequestMessage(spec.Method, spec.AbsoluteUri ?? Resolve(spec.PathAndQuery));
            request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
            request.Headers.Accept.ParseAdd(spec.Accept);
            if (spec.JsonBody != null)
            {
                request.Content = new ByteArrayContent(spec.JsonBody);
                request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
            }
            if (!string.IsNullOrEmpty(spec.IdempotencyKey))
                request.Headers.TryAddWithoutValidation("Idempotency-Key", spec.IdempotencyKey);
            if (spec.Headers != null)
                foreach (var pair in spec.Headers)
                    request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
            if (spec.SendCredentials)
            {
                var token = await ResolveTokenAsync(cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(token))
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            }
            return request;
        }

        private async ValueTask<string?> ResolveTokenAsync(CancellationToken cancellationToken)
        {
            if (_options.AccessTokenProvider != null)
                return await _options.AccessTokenProvider(cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(_options.AccessToken)) return _options.AccessToken;
            return string.IsNullOrEmpty(_options.ApiKey) ? null : _options.ApiKey;
        }

        public bool HasCredentials =>
            _options.AccessTokenProvider != null || !string.IsNullOrEmpty(_options.AccessToken) || !string.IsNullOrEmpty(_options.ApiKey);

        public static byte[] Serialize<T>(T value, JsonTypeInfo<T> typeInfo) => JsonSerializer.SerializeToUtf8Bytes(value, typeInfo);

        public static Task<Stream> ReadStreamAsync(HttpContent content, CancellationToken cancellationToken)
        {
#if NET5_0_OR_GREATER
            return content.ReadAsStreamAsync(cancellationToken);
#else
            cancellationToken.ThrowIfCancellationRequested();
            return content.ReadAsStreamAsync();
#endif
        }

        public static Task<string> ReadStringAsync(HttpContent content, CancellationToken cancellationToken)
        {
#if NET5_0_OR_GREATER
            return content.ReadAsStringAsync(cancellationToken);
#else
            cancellationToken.ThrowIfCancellationRequested();
            return content.ReadAsStringAsync();
#endif
        }
    }
}
