using System;
using System.Net;
using System.Net.Http;

namespace ThreeWs.Sdk.Internal
{
    /// <summary>Decides whether and how long to wait before retrying a failed request.</summary>
    internal static class RetryPolicy
    {
        private static readonly object RandomLock = new object();
        private static readonly Random Jitter = new Random();

        /// <summary>
        /// GET is always safe to repeat. A POST is repeated on 429 and 503, which mean the server refused it
        /// before doing any work, and on the other 5xx answers only when it carries an Idempotency-Key,
        /// because then the server replays the first outcome instead of running it twice.
        /// </summary>
        public static bool IsRetryable(HttpMethod method, HttpStatusCode status, bool hasIdempotencyKey)
        {
            var code = (int)status;
            if (code == 429 || code == 503) return true;
            if (code < 500 || code == 501) return false;
            return method == HttpMethod.Get || hasIdempotencyKey;
        }

        /// <summary>A network failure is retried when the request could not have been processed twice.</summary>
        public static bool IsRetryableNetworkFailure(HttpMethod method, bool hasIdempotencyKey)
            => method == HttpMethod.Get || hasIdempotencyKey;

        /// <summary>
        /// Exponential backoff with full jitter, raised to the server's Retry-After when it asked for longer,
        /// and capped at <paramref name="max"/>.
        /// </summary>
        public static TimeSpan Delay(int attempt, TimeSpan baseDelay, TimeSpan max, TimeSpan? retryAfter)
        {
            var exp = baseDelay.TotalMilliseconds * Math.Pow(2, attempt);
            double sample;
            lock (RandomLock) sample = Jitter.NextDouble();
            var jittered = TimeSpan.FromMilliseconds(Math.Min(exp, max.TotalMilliseconds) * sample);
            var wait = retryAfter.HasValue && retryAfter.Value > jittered ? retryAfter.Value : jittered;
            return wait > max ? max : wait;
        }

        /// <summary>Reads a Retry-After header in either delta-seconds or HTTP-date form.</summary>
        public static TimeSpan? ParseRetryAfter(HttpResponseMessage response)
        {
            var header = response.Headers.RetryAfter;
            if (header == null) return null;
            if (header.Delta.HasValue) return header.Delta.Value;
            if (header.Date.HasValue)
            {
                var delta = header.Date.Value - DateTimeOffset.UtcNow;
                return delta > TimeSpan.Zero ? delta : TimeSpan.Zero;
            }
            return null;
        }
    }
}
