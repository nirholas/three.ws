using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeWs.Sdk.Tests
{
    /// <summary>
    /// A real HTTP server on 127.0.0.1 that answers a scripted sequence of responses, so retry and error
    /// behaviour runs through the SDK's actual HttpClient stack over a socket.
    /// </summary>
    internal sealed class LoopbackServer : IDisposable
    {
        public sealed class Reply
        {
            public int Status { get; set; } = 200;
            public string Body { get; set; } = "{}";
            public string ContentType { get; set; } = "application/json";
            public string? RetryAfter { get; set; }
        }

        public sealed class Seen
        {
            public string Method { get; set; } = "";
            public string Path { get; set; } = "";
            public string? IdempotencyKey { get; set; }
            public string? Authorization { get; set; }
            public string? UserAgent { get; set; }
            public string Body { get; set; } = "";
            public DateTimeOffset At { get; set; }
        }

        private readonly HttpListener _listener = new HttpListener();
        private readonly Func<int, Reply> _script;
        private readonly CancellationTokenSource _stop = new CancellationTokenSource();
        private int _count;

        public ConcurrentQueue<Seen> Requests { get; } = new ConcurrentQueue<Seen>();
        public Uri BaseUrl { get; }

        public LoopbackServer(Func<int, Reply> script)
        {
            _script = script;
            var port = FreePort();
            BaseUrl = new Uri($"http://127.0.0.1:{port}/");
            _listener.Prefixes.Add(BaseUrl.ToString());
            _listener.Start();
            _ = Task.Run(LoopAsync);
        }

        private async Task LoopAsync()
        {
            while (!_stop.IsCancellationRequested)
            {
                HttpListenerContext ctx;
                try { ctx = await _listener.GetContextAsync().ConfigureAwait(false); }
                catch (Exception) when (_stop.IsCancellationRequested) { return; }
                catch (HttpListenerException) { return; }

                string body;
                using (var reader = new System.IO.StreamReader(ctx.Request.InputStream, Encoding.UTF8)) body = await reader.ReadToEndAsync().ConfigureAwait(false);
                Requests.Enqueue(new Seen
                {
                    Method = ctx.Request.HttpMethod,
                    Path = ctx.Request.Url!.PathAndQuery,
                    IdempotencyKey = ctx.Request.Headers["Idempotency-Key"],
                    Authorization = ctx.Request.Headers["Authorization"],
                    UserAgent = ctx.Request.Headers["User-Agent"],
                    Body = body,
                    At = DateTimeOffset.UtcNow,
                });

                var reply = _script(Interlocked.Increment(ref _count) - 1);
                ctx.Response.StatusCode = reply.Status;
                ctx.Response.ContentType = reply.ContentType;
                if (reply.RetryAfter != null) ctx.Response.Headers["Retry-After"] = reply.RetryAfter;
                var bytes = Encoding.UTF8.GetBytes(reply.Body);
                ctx.Response.ContentLength64 = bytes.Length;
                await ctx.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                ctx.Response.Close();
            }
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            var port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }

        public void Dispose()
        {
            _stop.Cancel();
            _listener.Close();
        }
    }
}
