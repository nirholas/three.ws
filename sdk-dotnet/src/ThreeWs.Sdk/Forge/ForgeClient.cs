using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk.Internal;

namespace ThreeWs.Sdk.Forge
{
    /// <summary>
    /// Forge: text, image and sketch to 3D on every lane, auto-rigging, job polling and GLB download.
    /// Reach it through <see cref="ThreeWsClient.Forge"/>.
    /// </summary>
    public sealed class ForgeClient
    {
        private static readonly TimeSpan MinPoll = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan MaxPoll = TimeSpan.FromSeconds(15);

        private readonly ApiTransport _transport;

        internal ForgeClient(ApiTransport transport) => _transport = transport;

        /// <summary>Lists the paths, tiers and lanes (with free, configured and bring-your-own-key flags). <c>GET /api/forge?catalog</c>.</summary>
        public Task<ForgeCatalog> GetCatalogAsync(CancellationToken cancellationToken = default)
            => _transport.SendJsonAsync(
                new RequestSpec { PathAndQuery = "/api/forge?catalog" },
                ThreeWsJsonContext.Default.ForgeCatalog,
                cancellationToken);

        /// <summary>
        /// Starts a generation. <c>POST /api/forge</c>. Returns at once with a queued job (or a done job when the
        /// result was cached or the lane answered inline). Sends an <c>Idempotency-Key</c>: a fresh one unless
        /// <see cref="ForgeRequest.IdempotencyKey"/> is set, so an automatic retry never starts a second GPU run.
        /// </summary>
        public Task<ForgeJob> CreateAsync(ForgeRequest request, CancellationToken cancellationToken = default)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (string.IsNullOrWhiteSpace(request.Prompt) && (request.ImageUrls == null || request.ImageUrls.Count == 0))
                throw new ArgumentException("Set Prompt, ImageUrls, or both.", nameof(request));

            Dictionary<string, string>? headers = null;
            if (!string.IsNullOrEmpty(request.ProviderKey))
                headers = new Dictionary<string, string> { ["x-forge-provider-key"] = request.ProviderKey! };

            return _transport.SendJsonAsync(
                new RequestSpec
                {
                    Method = HttpMethod.Post,
                    PathAndQuery = "/api/forge",
                    JsonBody = ApiTransport.Serialize(request, ThreeWsJsonContext.Default.ForgeRequest),
                    IdempotencyKey = request.IdempotencyKey ?? IdempotencyKeys.New(),
                    Headers = headers,
                },
                ThreeWsJsonContext.Default.ForgeJob,
                cancellationToken);
        }

        /// <summary>Reads a job's current state once. <c>GET /api/forge?job=</c>. Works for generation and rig jobs.</summary>
        public Task<ForgeJob> GetJobAsync(string jobId, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(jobId)) throw new ArgumentException("A job id is required.", nameof(jobId));
            return _transport.SendJsonAsync(
                new RequestSpec { PathAndQuery = new QueryString("/api/forge").Add("job", jobId).ToString() },
                ThreeWsJsonContext.Default.ForgeJob,
                cancellationToken);
        }

        /// <summary>
        /// Polls until the job is done and returns it. The interval follows the server's remaining-time estimate,
        /// clamped to 2 to 15 seconds. Throws <see cref="ThreeWsJobFailedException"/> when the job fails and
        /// <see cref="OperationCanceledException"/> when <paramref name="cancellationToken"/> fires (use
        /// <see cref="CancellationTokenSource.CancelAfter(TimeSpan)"/> for a timeout).
        /// </summary>
        public async Task<ForgeJob> WaitAsync(string jobId, IProgress<ForgeJob>? progress = null, CancellationToken cancellationToken = default)
        {
            while (true)
            {
                var job = await GetJobAsync(jobId, cancellationToken).ConfigureAwait(false);
                progress?.Report(job);
                if (job.Status == ForgeJobStatus.Done) return job;
                if (job.IsTerminal) throw new ThreeWsJobFailedException(job);
                await Task.Delay(NextPoll(job), cancellationToken).ConfigureAwait(false);
            }
        }

        /// <summary>Starts a generation and waits for the finished model. <see cref="CreateAsync"/> then <see cref="WaitAsync"/>.</summary>
        public async Task<ForgeJob> GenerateAsync(ForgeRequest request, IProgress<ForgeJob>? progress = null, CancellationToken cancellationToken = default)
        {
            var job = await CreateAsync(request, cancellationToken).ConfigureAwait(false);
            progress?.Report(job);
            if (job.Status == ForgeJobStatus.Done) return job;
            if (job.IsTerminal) throw new ThreeWsJobFailedException(job);
            if (string.IsNullOrEmpty(job.JobId))
                throw new ThreeWsApiException(System.Net.HttpStatusCode.OK, "missing_job_id", "The server accepted the generation but returned no job id to poll.");
            return await WaitAsync(job.JobId!, progress, cancellationToken).ConfigureAwait(false);
        }

        /// <summary>
        /// Adds a humanoid skeleton and skin weights to an existing GLB. <c>POST /api/forge?action=rig</c>.
        /// Returns a queued job: pass its <see cref="ForgeJob.JobId"/> to <see cref="WaitAsync"/>. A deployment with no
        /// rig lane answers 501 <c>rig_unconfigured</c>.
        /// </summary>
        public Task<ForgeJob> RigAsync(string glbUrl, string? idempotencyKey = null, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(glbUrl)) throw new ArgumentException("A public GLB URL is required.", nameof(glbUrl));
            return _transport.SendJsonAsync(
                new RequestSpec
                {
                    Method = HttpMethod.Post,
                    PathAndQuery = "/api/forge?action=rig",
                    JsonBody = ApiTransport.Serialize(new RigBody { GlbUrl = glbUrl }, ThreeWsJsonContext.Default.RigBody),
                    IdempotencyKey = idempotencyKey ?? IdempotencyKeys.New(),
                },
                ThreeWsJsonContext.Default.ForgeJob,
                cancellationToken);
        }

        /// <summary>
        /// Streams a finished GLB into <paramref name="destination"/> and returns the byte count. Verifies the
        /// binary glTF magic so an HTML error page is never saved as a model. Relative URLs resolve against the base URL.
        /// </summary>
        public async Task<long> DownloadAsync(string glbUrl, Stream destination, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(glbUrl)) throw new ArgumentException("A GLB URL is required.", nameof(glbUrl));
            if (destination == null) throw new ArgumentNullException(nameof(destination));

            var uri = _transport.ResolveUrl(glbUrl);
            var sameOrigin = _transport.IsSameOrigin(uri);

            using var response = await _transport.SendAsync(
                new RequestSpec { AbsoluteUri = uri, Accept = "model/gltf-binary, application/octet-stream, */*", SendCredentials = sameOrigin },
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);
            using var source = await ApiTransport.ReadStreamAsync(response.Content, cancellationToken).ConfigureAwait(false);

            var buffer = new byte[81920];
            var header = 0;
            while (header < 4)
            {
                var n = await source.ReadAsync(buffer, header, 4 - header, cancellationToken).ConfigureAwait(false);
                if (n == 0) break;
                header += n;
            }
            if (header < 4 || buffer[0] != (byte)'g' || buffer[1] != (byte)'l' || buffer[2] != (byte)'T' || buffer[3] != (byte)'F')
                throw new InvalidDataException("The download at " + uri + " is not a binary glTF (GLB) file.");

            await destination.WriteAsync(buffer, 0, header, cancellationToken).ConfigureAwait(false);
            long total = header;
            int read;
            while ((read = await source.ReadAsync(buffer, 0, buffer.Length, cancellationToken).ConfigureAwait(false)) > 0)
            {
                await destination.WriteAsync(buffer, 0, read, cancellationToken).ConfigureAwait(false);
                total += read;
            }
            return total;
        }

        /// <summary>
        /// Starts a keyless generation on the free 3D Studio lane. <c>POST /api/3d/studio</c>. Answers <c>done</c>
        /// with viewer and AR links, or <c>pending</c> with a job to pass to <see cref="StudioGetJobAsync"/>.
        /// </summary>
        public Task<StudioResult> StudioGenerateAsync(string prompt, string? tier = null, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(prompt)) throw new ArgumentException("A prompt is required.", nameof(prompt));
            return _transport.SendJsonAsync(
                new RequestSpec
                {
                    Method = HttpMethod.Post,
                    PathAndQuery = "/api/3d/studio",
                    JsonBody = ApiTransport.Serialize(new StudioBody { Prompt = prompt, Tier = tier }, ThreeWsJsonContext.Default.StudioBody),
                },
                ThreeWsJsonContext.Default.StudioResult,
                cancellationToken);
        }

        /// <summary>Polls a pending 3D Studio job once. Pass the <see cref="StudioResult.Poll"/> path or the bare job id.</summary>
        public Task<StudioResult> StudioGetJobAsync(string jobOrPollPath, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(jobOrPollPath)) throw new ArgumentException("A job id or poll path is required.", nameof(jobOrPollPath));
            var path = jobOrPollPath.StartsWith("/", StringComparison.Ordinal)
                ? jobOrPollPath
                : new QueryString("/api/3d/studio").Add("job", jobOrPollPath).ToString();
            return _transport.SendJsonAsync(new RequestSpec { PathAndQuery = path }, ThreeWsJsonContext.Default.StudioResult, cancellationToken);
        }

        /// <summary>Starts a 3D Studio generation and polls until it is done. Throws <see cref="ThreeWsApiException"/> with code <c>studio_error</c> on failure.</summary>
        public async Task<StudioResult> StudioGenerateAndWaitAsync(string prompt, string? tier = null, IProgress<StudioResult>? progress = null, CancellationToken cancellationToken = default)
        {
            var result = await StudioGenerateAsync(prompt, tier, cancellationToken).ConfigureAwait(false);
            while (true)
            {
                progress?.Report(result);
                if (result.IsDone) return result;
                if (!result.IsPending || string.IsNullOrEmpty(result.Poll ?? result.Job))
                    throw new ThreeWsApiException(System.Net.HttpStatusCode.OK, "studio_error", result.Error ?? "The 3D Studio generation failed.");
                var wait = TimeSpan.FromSeconds(result.EtaSeconds ?? 5);
                await Task.Delay(wait < MinPoll ? MinPoll : wait > MaxPoll ? MaxPoll : wait, cancellationToken).ConfigureAwait(false);
                result = await StudioGetJobAsync(result.Poll ?? result.Job!, cancellationToken).ConfigureAwait(false);
            }
        }

        /// <summary>The public model page for a finished creation: <c>https://three.ws/m/&lt;creationId&gt;</c>.</summary>
        public Uri ModelPageUrl(string creationId) => _transport.Resolve("/m/" + Uri.EscapeDataString(creationId));

        /// <summary>A shareable in-browser viewer for any public GLB URL.</summary>
        public Uri ViewerUrl(string glbUrl) => _transport.Resolve(new QueryString("/viewer").Add("src", glbUrl).ToString());

        internal static TimeSpan NextPoll(ForgeJob job)
        {
            var seconds = job.EtaRemainingSeconds ?? job.EtaSeconds ?? 5;
            var wait = TimeSpan.FromSeconds(seconds / 2);
            if (wait < MinPoll) return MinPoll;
            return wait > MaxPoll ? MaxPoll : wait;
        }
    }
}
