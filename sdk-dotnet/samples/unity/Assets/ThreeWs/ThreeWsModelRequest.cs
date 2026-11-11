using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk;
using ThreeWs.Sdk.Forge;

namespace ThreeWs.Samples.Unity
{
    /// <summary>A generated model ready to hand to a glTF loader.</summary>
    public sealed class GeneratedModel
    {
        public GeneratedModel(byte[] glb, Uri sourceUrl, string? viewerUrl)
        {
            Glb = glb;
            SourceUrl = sourceUrl;
            ViewerUrl = viewerUrl;
        }

        /// <summary>The binary glTF bytes.</summary>
        public byte[] Glb { get; }

        /// <summary>Where the GLB was downloaded from; relative URIs inside the file resolve against it.</summary>
        public Uri SourceUrl { get; }

        /// <summary>A shareable browser viewer for the model.</summary>
        public string? ViewerUrl { get; }
    }

    /// <summary>
    /// Engine-free half of the Unity sample: generates on the free Studio lane and downloads the GLB into memory.
    /// Kept free of UnityEngine so it compiles and runs under plain netstandard2.1 as well as inside Unity.
    /// </summary>
    public static class ThreeWsModelRequest
    {
        public static async Task<GeneratedModel> GenerateAsync(ThreeWsClient client, string prompt, string tier, IProgress<string>? status, CancellationToken cancellationToken)
        {
            if (client == null) throw new ArgumentNullException(nameof(client));
            if (string.IsNullOrWhiteSpace(prompt)) throw new ArgumentException("Describe one object to generate.", nameof(prompt));

            status?.Report("Generating \"" + prompt + "\"");
            var result = await client.Forge.StudioGenerateAndWaitAsync(
                prompt,
                tier,
                new InlineProgress(r => { if (r.IsPending) status?.Report("Sculpting, about " + (r.EtaSeconds ?? 0) + "s left"); }),
                cancellationToken).ConfigureAwait(false);

            status?.Report("Downloading");
            using var buffer = new MemoryStream();
            await client.Forge.DownloadAsync(result.GlbUrl!, buffer, cancellationToken).ConfigureAwait(false);
            return new GeneratedModel(buffer.ToArray(), new Uri(result.GlbUrl!), result.ViewerUrl);
        }

        private sealed class InlineProgress : IProgress<StudioResult>
        {
            private readonly Action<StudioResult> _report;
            public InlineProgress(Action<StudioResult> report) => _report = report;
            public void Report(StudioResult value) => _report(value);
        }
    }
}
