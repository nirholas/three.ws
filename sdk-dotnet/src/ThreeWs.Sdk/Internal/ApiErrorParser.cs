using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace ThreeWs.Sdk.Internal
{
    /// <summary>
    /// Turns an error response into a typed exception. three.ws answers errors in three shapes:
    /// <c>{ "error": "code", "error_description" | "message": "…" }</c> on most routes,
    /// <c>{ "error": { "code", "message" }, "meta": { "requestId" } }</c> on <c>/api/v1</c>, and an
    /// x402 payment challenge <c>{ "x402Version", "error": "…" }</c> on paid MCP endpoints.
    /// </summary>
    internal static class ApiErrorParser
    {
        public static ThreeWsApiException Create(HttpResponseMessage response, string body)
        {
            var status = response.StatusCode;
            var code = "http_" + (int)status;
            var message = string.IsNullOrWhiteSpace(response.ReasonPhrase) ? "Request failed with HTTP " + (int)status + "." : response.ReasonPhrase!;
            string? requestId = response.Headers.TryGetValues("x-request-id", out var ids) ? ids.FirstOrDefault() : null;
            TimeSpan? retryAfter = RetryPolicy.ParseRetryAfter(response);

            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object)
                {
                    if (root.TryGetProperty("error", out var err))
                    {
                        if (err.ValueKind == JsonValueKind.String)
                        {
                            code = err.GetString() ?? code;
                            message = FirstString(root, "error_description", "message") ?? code;
                        }
                        else if (err.ValueKind == JsonValueKind.Object)
                        {
                            code = FirstString(err, "code") ?? code;
                            message = FirstString(err, "message") ?? code;
                        }
                    }
                    if (root.TryGetProperty("x402Version", out _))
                    {
                        code = "payment_required";
                        message = "This endpoint needs authentication or an x402 payment: " + message;
                    }
                    if (root.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.Object)
                        requestId ??= FirstString(meta, "requestId");
                    if (!retryAfter.HasValue && root.TryGetProperty("retry_after", out var ra) && ra.ValueKind == JsonValueKind.Number && ra.TryGetDouble(out var seconds))
                        retryAfter = TimeSpan.FromSeconds(seconds);
                }
            }
            catch (JsonException)
            {
                // A non-JSON error body (a proxy page): keep the status-derived code and message.
            }

            var statusCode = (int)status;
            if (statusCode == 401 || statusCode == 403)
                return new ThreeWsAuthenticationException(status, code, message, requestId, body);
            if (statusCode == 404)
                return new ThreeWsNotFoundException(code, message, requestId, body);
            if (statusCode == 429)
                return new ThreeWsRateLimitException(code, message, requestId, retryAfter, body);
            return new ThreeWsApiException(status, code, message, requestId, retryAfter, body);
        }

        private static string? FirstString(JsonElement obj, params string[] names)
        {
            foreach (var name in names)
                if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
                    return v.GetString();
            return null;
        }
    }
}
