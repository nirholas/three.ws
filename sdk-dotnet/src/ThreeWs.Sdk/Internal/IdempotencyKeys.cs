using System;

namespace ThreeWs.Sdk.Internal
{
    internal static class IdempotencyKeys
    {
        /// <summary>A random key, unique per logical create, that the SDK reuses across its own retries.</summary>
        public static string New() => "tws-" + Guid.NewGuid().ToString("N");
    }
}
