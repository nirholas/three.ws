using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThreeWs.Sdk.Forge
{
    /// <summary>Generation path: how a mesh is produced.</summary>
    public static class ForgePaths
    {
        /// <summary>Text or photo to a reference image, then reconstruction (TRELLIS / Hunyuan3D). The default.</summary>
        public const string Image = "image";
        /// <summary>Native text or image to mesh on a geometry-first engine (Meshy, Tripo; bring your own key).</summary>
        public const string Geometry = "geometry";
        /// <summary>A drawing plus a prompt naming it (TripoSG scribble). Untextured geometry.</summary>
        public const string Sketch = "sketch";
    }

    /// <summary>Quality tier: polygon budget and texture richness.</summary>
    public static class ForgeTiers
    {
        /// <summary>Fast, low-poly. Good for blockout.</summary>
        public const string Draft = "draft";
        /// <summary>Balanced detail, 2K textures. The default.</summary>
        public const string Standard = "standard";
        /// <summary>Maximum detail and PBR textures. Takes minutes.</summary>
        public const string High = "high";
    }

    /// <summary>Output encodings for the delivered GLB.</summary>
    public static class ForgeOutputFormats
    {
        /// <summary>Plain binary glTF (default).</summary>
        public const string Glb = "glb";
        /// <summary>Draco-compressed geometry.</summary>
        public const string GlbDraco = "glb-draco";
        /// <summary>Meshopt-compressed geometry.</summary>
        public const string GlbMeshopt = "glb-meshopt";
    }

    /// <summary>A text, image or sketch to 3D request for <c>POST /api/forge</c>.</summary>
    public sealed class ForgeRequest
    {
        /// <summary>Describe one object, character or creature (3 to 1000 characters). Optional when <see cref="ImageUrls"/> is set.</summary>
        [JsonPropertyName("prompt")] public string? Prompt { get; set; }
        /// <summary>Public reference image URLs for image to 3D (several views fuse on multi-view lanes).</summary>
        [JsonPropertyName("image_urls")] public IList<string>? ImageUrls { get; set; }
        /// <summary>One of <see cref="ForgePaths"/>. Defaults to <c>image</c>.</summary>
        [JsonPropertyName("path")] public string? Path { get; set; }
        /// <summary>One of <see cref="ForgeTiers"/>. Defaults to <c>standard</c>.</summary>
        [JsonPropertyName("tier")] public string? Tier { get; set; }
        /// <summary>A lane id from <see cref="ForgeClient.GetCatalogAsync"/> (for example <c>nvidia</c> or <c>huggingface</c>). Omit to let the router pick.</summary>
        [JsonPropertyName("backend")] public string? Backend { get; set; }
        /// <summary>Reproducible generation on lanes that expose a seed.</summary>
        [JsonPropertyName("seed")] public long? Seed { get; set; }
        /// <summary>One of <see cref="ForgeOutputFormats"/>.</summary>
        [JsonPropertyName("output_format")] public string? OutputFormat { get; set; }
        /// <summary>Texture resolution on poly-aware lanes.</summary>
        [JsonPropertyName("texture_size")] public int? TextureSize { get; set; }
        /// <summary>Target polygon count on poly-aware lanes.</summary>
        [JsonPropertyName("target_polycount")] public int? TargetPolycount { get; set; }
        /// <summary>Set false to skip the art-director prompt rewrite.</summary>
        [JsonPropertyName("director")] public bool? Director { get; set; }
        /// <summary>Skip the short-lived result cache for this call.</summary>
        [JsonPropertyName("force_regenerate")] public bool? ForceRegenerate { get; set; }

        /// <summary>Your own Meshy, Tripo or Replicate key for a bring-your-own-key lane. Sent as a header, never in the body.</summary>
        [JsonIgnore] public string? ProviderKey { get; set; }

        /// <summary>Idempotency key for this create. A fresh one is generated when left null; reuse one to collect a lost response.</summary>
        [JsonIgnore] public string? IdempotencyKey { get; set; }
    }

    /// <summary>Lifecycle of a forge job.</summary>
    public enum ForgeJobStatus
    {
        /// <summary>A status this SDK version does not know; see <see cref="ForgeJob.RawStatus"/>.</summary>
        Unknown,
        /// <summary>Accepted and waiting for a GPU.</summary>
        Queued,
        /// <summary>Generating.</summary>
        Running,
        /// <summary>Finished; <see cref="ForgeJob.GlbUrl"/> is set.</summary>
        Done,
        /// <summary>Failed on every automatic lane.</summary>
        Failed,
        /// <summary>The chosen bring-your-own-key lane needs a provider key.</summary>
        NeedsKey,
    }

    /// <summary>A forge job as returned by create and poll.</summary>
    public sealed class ForgeJob
    {
        /// <summary>Job handle for polling; null when the job finished inline.</summary>
        [JsonPropertyName("job_id")] public string? JobId { get; set; }
        /// <summary>The durable creation id (model page at <c>/m/&lt;id&gt;</c>).</summary>
        [JsonPropertyName("creation_id")] public string? CreationId { get; set; }
        /// <summary>The status string exactly as the server sent it.</summary>
        [JsonPropertyName("status")] public string? RawStatus { get; set; }
        /// <summary>Generation mode, for example <c>text_to_3d</c>.</summary>
        [JsonPropertyName("mode")] public string? Mode { get; set; }
        /// <summary>The path that produced the model.</summary>
        [JsonPropertyName("path")] public string? Path { get; set; }
        /// <summary>The tier that produced the model.</summary>
        [JsonPropertyName("tier")] public string? Tier { get; set; }
        /// <summary>The lane (backend id) running or that ran the job.</summary>
        [JsonPropertyName("backend")] public string? Backend { get; set; }
        /// <summary>The prompt as received.</summary>
        [JsonPropertyName("prompt")] public string? Prompt { get; set; }
        /// <summary>Download URL of the finished GLB.</summary>
        [JsonPropertyName("glb_url")] public string? GlbUrl { get; set; }
        /// <summary>The concept image painted before sculpting; show it while the job runs.</summary>
        [JsonPropertyName("preview_image_url")] public string? PreviewImageUrl { get; set; }
        /// <summary>Failure message when <see cref="Status"/> is <see cref="ForgeJobStatus.Failed"/>.</summary>
        [JsonPropertyName("error")] public string? Error { get; set; }
        /// <summary>Estimated total generation time in seconds.</summary>
        [JsonPropertyName("eta_seconds")] public double? EtaSeconds { get; set; }
        /// <summary>Estimated seconds left.</summary>
        [JsonPropertyName("eta_remaining_seconds")] public double? EtaRemainingSeconds { get; set; }
        /// <summary>Seconds since submit.</summary>
        [JsonPropertyName("elapsed_seconds")] public double? ElapsedSeconds { get; set; }
        /// <summary>True when served from the result cache.</summary>
        [JsonPropertyName("cached")] public bool? Cached { get; set; }
        /// <summary>True when a fresh retry on another lane could succeed.</summary>
        [JsonPropertyName("retryable")] public bool? Retryable { get; set; }
        /// <summary>Lanes that could take a retry of a failed job.</summary>
        [JsonPropertyName("retry_backends")] public IList<string>? RetryBackends { get; set; }
        /// <summary>The lane this job failed over from, when it moved.</summary>
        [JsonPropertyName("failover_from")] public string? FailoverFrom { get; set; }
        /// <summary>True when a self-hosted lane is spinning up.</summary>
        [JsonPropertyName("cold_start")] public bool? ColdStart { get; set; }

        /// <summary>Every other field the server sent (quality report, compression, provenance).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }

        /// <summary>Parsed <see cref="RawStatus"/>.</summary>
        [JsonIgnore]
        public ForgeJobStatus Status => RawStatus switch
        {
            "queued" => ForgeJobStatus.Queued,
            "pending" => ForgeJobStatus.Queued,
            "running" => ForgeJobStatus.Running,
            "processing" => ForgeJobStatus.Running,
            "done" => ForgeJobStatus.Done,
            "failed" => ForgeJobStatus.Failed,
            "error" => ForgeJobStatus.Failed,
            "needs_key" => ForgeJobStatus.NeedsKey,
            _ => ForgeJobStatus.Unknown,
        };

        /// <summary>True when the job will not change again.</summary>
        [JsonIgnore]
        public bool IsTerminal => Status == ForgeJobStatus.Done || Status == ForgeJobStatus.Failed || Status == ForgeJobStatus.NeedsKey;
    }

    /// <summary>The tier, lane and cost matrix from <c>GET /api/forge?catalog</c>.</summary>
    public sealed class ForgeCatalog
    {
        /// <summary>Available generation paths.</summary>
        [JsonPropertyName("paths")] public IList<string> Paths { get; set; } = new List<string>();
        /// <summary>Path used when none is given.</summary>
        [JsonPropertyName("default_path")] public string? DefaultPath { get; set; }
        /// <summary>Tier used when none is given.</summary>
        [JsonPropertyName("default_tier")] public string? DefaultTier { get; set; }
        /// <summary>Quality tiers.</summary>
        [JsonPropertyName("tiers")] public IList<ForgeTierInfo> Tiers { get; set; } = new List<ForgeTierInfo>();
        /// <summary>Generation lanes.</summary>
        [JsonPropertyName("backends")] public IList<ForgeBackendInfo> Backends { get; set; } = new List<ForgeBackendInfo>();
        /// <summary>Every other field.</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    /// <summary>One quality tier.</summary>
    public sealed class ForgeTierInfo
    {
        /// <summary>Tier id.</summary>
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        /// <summary>Display label.</summary>
        [JsonPropertyName("label")] public string? Label { get; set; }
        /// <summary>One-line description.</summary>
        [JsonPropertyName("blurb")] public string? Blurb { get; set; }
        /// <summary>Target polygon budget.</summary>
        [JsonPropertyName("polycount")] public int? Polycount { get; set; }
        /// <summary>PBR textures.</summary>
        [JsonPropertyName("pbr")] public bool? Pbr { get; set; }
        /// <summary>Paid x402 price in USDC for this tier.</summary>
        [JsonPropertyName("price_usdc")] public string? PriceUsdc { get; set; }
    }

    /// <summary>One generation lane.</summary>
    public sealed class ForgeBackendInfo
    {
        /// <summary>Lane id; pass as <see cref="ForgeRequest.Backend"/>.</summary>
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        /// <summary>Display label.</summary>
        [JsonPropertyName("label")] public string? Label { get; set; }
        /// <summary>Model and host.</summary>
        [JsonPropertyName("vendor")] public string? Vendor { get; set; }
        /// <summary>Paths this lane serves.</summary>
        [JsonPropertyName("paths")] public IList<string> Paths { get; set; } = new List<string>();
        /// <summary>Free to use.</summary>
        [JsonPropertyName("free")] public bool Free { get; set; }
        /// <summary>Live on this deployment.</summary>
        [JsonPropertyName("configured")] public bool Configured { get; set; }
        /// <summary>Provider whose key a bring-your-own-key lane needs, or null.</summary>
        [JsonPropertyName("byok")] public string? Byok { get; set; }
        /// <summary>Accepts user reference images.</summary>
        [JsonPropertyName("user_images")] public bool? UserImages { get; set; }
        /// <summary>Produces a rigged mesh.</summary>
        [JsonPropertyName("rigged")] public bool? Rigged { get; set; }
        /// <summary>One-line description.</summary>
        [JsonPropertyName("blurb")] public string? Blurb { get; set; }
        /// <summary>Every other field (estimates, limits).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    /// <summary>Body for <c>POST /api/forge?action=rig</c>.</summary>
    internal sealed class RigBody
    {
        [JsonPropertyName("glb_url")] public string GlbUrl { get; set; } = "";
    }

    /// <summary>Body for <c>POST /api/3d/studio</c>.</summary>
    internal sealed class StudioBody
    {
        [JsonPropertyName("prompt")] public string Prompt { get; set; } = "";
        [JsonPropertyName("tier")] public string? Tier { get; set; }
    }

    /// <summary>
    /// The free 3D Studio lane (<c>/api/3d/studio</c>): keyless text to 3D with viewer and AR links.
    /// </summary>
    public sealed class StudioResult
    {
        /// <summary><c>done</c>, <c>pending</c> or <c>error</c>.</summary>
        [JsonPropertyName("status")] public string Status { get; set; } = "";
        /// <summary>Job handle while pending.</summary>
        [JsonPropertyName("job")] public string? Job { get; set; }
        /// <summary>Relative poll path while pending; it carries the job and title.</summary>
        [JsonPropertyName("poll")] public string? Poll { get; set; }
        /// <summary>Live progress page to hand a person while pending.</summary>
        [JsonPropertyName("watchUrl")] public string? WatchUrl { get; set; }
        /// <summary>Download URL when done.</summary>
        [JsonPropertyName("glbUrl")] public string? GlbUrl { get; set; }
        /// <summary>Interactive viewer when done.</summary>
        [JsonPropertyName("viewerUrl")] public string? ViewerUrl { get; set; }
        /// <summary>Place-in-your-room AR link when done.</summary>
        [JsonPropertyName("arUrl")] public string? ArUrl { get; set; }
        /// <summary>Concept image painted before sculpting.</summary>
        [JsonPropertyName("previewImageUrl")] public string? PreviewImageUrl { get; set; }
        /// <summary>Tier this generation runs at.</summary>
        [JsonPropertyName("tier")] public string? Tier { get; set; }
        /// <summary>Estimated seconds left while pending.</summary>
        [JsonPropertyName("etaSeconds")] public int? EtaSeconds { get; set; }
        /// <summary>Failure message when status is <c>error</c>.</summary>
        [JsonPropertyName("error")] public string? Error { get; set; }
        /// <summary>True when the model is ready.</summary>
        [JsonIgnore] public bool IsDone => Status == "done";
        /// <summary>True while the model is generating.</summary>
        [JsonIgnore] public bool IsPending => Status == "pending";
    }
}
