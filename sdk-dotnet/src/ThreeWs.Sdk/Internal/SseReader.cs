using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeWs.Sdk.Internal
{
    /// <summary>Reads a text/event-stream body and yields the joined <c>data:</c> payload of each event.</summary>
    internal static class SseReader
    {
        public static async IAsyncEnumerable<string> ReadDataAsync(Stream stream, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            using var reader = new StreamReader(stream, Encoding.UTF8);
            var data = new StringBuilder();
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
#if NET7_0_OR_GREATER
                var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
#else
                var line = await reader.ReadLineAsync().ConfigureAwait(false);
#endif
                if (line == null)
                {
                    if (data.Length > 0) yield return data.ToString();
                    yield break;
                }
                if (line.Length == 0)
                {
                    if (data.Length > 0)
                    {
                        yield return data.ToString();
                        data.Clear();
                    }
                    continue;
                }
                if (line[0] == ':') continue;
                if (line.StartsWith("data:", System.StringComparison.Ordinal))
                {
                    if (data.Length > 0) data.Append('\n');
                    var value = line.Substring(5);
                    data.Append(value.Length > 0 && value[0] == ' ' ? value.Substring(1) : value);
                }
            }
        }
    }
}
