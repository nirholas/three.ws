using System;
using System.Net;

namespace ThreeWs.Sdk
{
    /// <summary>
    /// The three.ws API answered with an error. <see cref="ErrorCode"/> is the machine-readable code
    /// from the response body (for example <c>validation_error</c>, <c>rate_limited</c>, <c>not_found</c>).
    /// </summary>
    public class ThreeWsApiException : Exception
    {
        /// <summary>Creates the exception.</summary>
        public ThreeWsApiException(HttpStatusCode statusCode, string errorCode, string message, string? requestId = null, TimeSpan? retryAfter = null, string? responseBody = null)
            : base(message)
        {
            StatusCode = statusCode;
            ErrorCode = errorCode;
            RequestId = requestId;
            RetryAfter = retryAfter;
            ResponseBody = responseBody;
        }

        /// <summary>HTTP status of the response.</summary>
        public HttpStatusCode StatusCode { get; }

        /// <summary>Machine-readable error code from the body, or <c>http_&lt;status&gt;</c> when the body carried none.</summary>
        public string ErrorCode { get; }

        /// <summary>The <c>x-request-id</c> header or envelope request id, when the server sent one. Quote it to support.</summary>
        public string? RequestId { get; }

        /// <summary>How long the server asked the caller to wait, from <c>Retry-After</c> or <c>retry_after</c>.</summary>
        public TimeSpan? RetryAfter { get; }

        /// <summary>The raw response body, for diagnostics.</summary>
        public string? ResponseBody { get; }
    }

    /// <summary>401 or 403: the call needs a valid API key or OAuth token, or the credential lacks the scope.</summary>
    public sealed class ThreeWsAuthenticationException : ThreeWsApiException
    {
        /// <summary>Creates the exception.</summary>
        public ThreeWsAuthenticationException(HttpStatusCode statusCode, string errorCode, string message, string? requestId = null, string? responseBody = null)
            : base(statusCode, errorCode, message, requestId, null, responseBody) { }
    }

    /// <summary>429 after every retry was spent. <see cref="ThreeWsApiException.RetryAfter"/> says when to try again.</summary>
    public sealed class ThreeWsRateLimitException : ThreeWsApiException
    {
        /// <summary>Creates the exception.</summary>
        public ThreeWsRateLimitException(string errorCode, string message, string? requestId, TimeSpan? retryAfter, string? responseBody)
            : base((HttpStatusCode)429, errorCode, message, requestId, retryAfter, responseBody) { }
    }

    /// <summary>404: the agent, catalog item or job does not exist.</summary>
    public sealed class ThreeWsNotFoundException : ThreeWsApiException
    {
        /// <summary>Creates the exception.</summary>
        public ThreeWsNotFoundException(string errorCode, string message, string? requestId, string? responseBody)
            : base(HttpStatusCode.NotFound, errorCode, message, requestId, null, responseBody) { }
    }

    /// <summary>A generation or rig job reached a terminal failed state.</summary>
    public sealed class ThreeWsJobFailedException : Exception
    {
        /// <summary>Creates the exception.</summary>
        public ThreeWsJobFailedException(Forge.ForgeJob job)
            : base(string.IsNullOrEmpty(job.Error) ? "The generation job failed." : job.Error)
        {
            Job = job;
        }

        /// <summary>The final job state, including <see cref="Forge.ForgeJob.RetryBackends"/> when another lane could take a retry.</summary>
        public Forge.ForgeJob Job { get; }
    }
}
