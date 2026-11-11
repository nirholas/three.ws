using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ThreeWs.Sdk.Catalog
{
    /// <summary>Kinds of asset in the catalog.</summary>
    public static class CatalogKinds
    {
        /// <summary>Props and objects (CC0).</summary>
        public const string Object = "object";
        /// <summary>Rigged humanoid characters.</summary>
        public const string Character = "character";
        /// <summary>Motion clips that retarget onto any humanoid.</summary>
        public const string Animation = "animation";
    }

    /// <summary>Filters for <see cref="CatalogClient.SearchAsync(CatalogQuery, System.Threading.CancellationToken)"/>.</summary>
    public sealed class CatalogQuery
    {
        /// <summary>Free-text search over names, titles, categories and tags.</summary>
        public string? Query { get; set; }
        /// <summary>One of <see cref="CatalogKinds"/>.</summary>
        public string? Kind { get; set; }
        /// <summary>Exact category, for example <c>furniture</c>.</summary>
        public string? Category { get; set; }
        /// <summary>Exact tag, for example <c>wood</c>.</summary>
        public string? Tag { get; set; }
        /// <summary>Page size, 1 to 50. The server default applies when null.</summary>
        public int? Limit { get; set; }
        /// <summary>Items to skip. Use <see cref="CatalogSearchResult.NextOffset"/> to page.</summary>
        public int? Offset { get; set; }
    }

    /// <summary>One catalog asset.</summary>
    public sealed class CatalogItem
    {
        /// <summary>Stable id, for example <c>object:ArmChair_01</c>.</summary>
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        /// <summary>One of <see cref="CatalogKinds"/>.</summary>
        [JsonPropertyName("kind")] public string Kind { get; set; } = "";
        /// <summary>Machine name.</summary>
        [JsonPropertyName("name")] public string? Name { get; set; }
        /// <summary>Display title.</summary>
        [JsonPropertyName("title")] public string? Title { get; set; }
        /// <summary>Categories.</summary>
        [JsonPropertyName("categories")] public IList<string> Categories { get; set; } = new List<string>();
        /// <summary>Tags.</summary>
        [JsonPropertyName("tags")] public IList<string> Tags { get; set; } = new List<string>();
        /// <summary>License, for example <c>CC0</c>.</summary>
        [JsonPropertyName("license")] public string? License { get; set; }
        /// <summary>Direct download URL of the asset file.</summary>
        [JsonPropertyName("url")] public string? Url { get; set; }
        /// <summary>Thumbnail image URL.</summary>
        [JsonPropertyName("thumb")] public string? Thumb { get; set; }
        /// <summary>File size in bytes.</summary>
        [JsonPropertyName("bytes")] public long? Bytes { get; set; }
        /// <summary>File format, for example <c>glb</c>.</summary>
        [JsonPropertyName("format")] public string? Format { get; set; }
        /// <summary>Kind-specific fields (rig, clip duration, source).</summary>
        [JsonExtensionData] public IDictionary<string, JsonElement>? AdditionalData { get; set; }
    }

    /// <summary>A value and how many matches carry it.</summary>
    public sealed class CatalogFacetValue
    {
        /// <summary>The category or tag.</summary>
        [JsonPropertyName("value")] public string Value { get; set; } = "";
        /// <summary>Matches carrying it.</summary>
        [JsonPropertyName("count")] public int Count { get; set; }
    }

    /// <summary>Facet counts over the whole match set.</summary>
    public sealed class CatalogFacets
    {
        /// <summary>Matches per kind.</summary>
        [JsonPropertyName("kinds")] public IDictionary<string, int> Kinds { get; set; } = new Dictionary<string, int>();
        /// <summary>Top categories.</summary>
        [JsonPropertyName("categories")] public IList<CatalogFacetValue> Categories { get; set; } = new List<CatalogFacetValue>();
        /// <summary>Top tags.</summary>
        [JsonPropertyName("tags")] public IList<CatalogFacetValue> Tags { get; set; } = new List<CatalogFacetValue>();
    }

    /// <summary>One page of search results. <c>GET /api/catalog</c>.</summary>
    public sealed class CatalogSearchResult
    {
        /// <summary>This page.</summary>
        [JsonPropertyName("items")] public IList<CatalogItem> Items { get; set; } = new List<CatalogItem>();
        /// <summary>Total matches for the query.</summary>
        [JsonPropertyName("matched")] public int Matched { get; set; }
        /// <summary>True when no exact match existed and the query was loosened.</summary>
        [JsonPropertyName("relaxed")] public bool Relaxed { get; set; }
        /// <summary>Size of the whole catalog.</summary>
        [JsonPropertyName("total")] public int Total { get; set; }
        /// <summary>Offset of this page.</summary>
        [JsonPropertyName("offset")] public int Offset { get; set; }
        /// <summary>Offset of the next page, or null on the last page.</summary>
        [JsonPropertyName("next_offset")] public int? NextOffset { get; set; }
        /// <summary>Facet counts.</summary>
        [JsonPropertyName("facets")] public CatalogFacets? Facets { get; set; }
        /// <summary>True when part of the catalog could not be read and results may be incomplete.</summary>
        [JsonPropertyName("degraded")] public bool Degraded { get; set; }
    }

    /// <summary>A ready-to-paste embed snippet for one framework.</summary>
    public sealed class CatalogSnippet
    {
        /// <summary>Snippet language, for example <c>html</c> or <c>jsx</c>.</summary>
        [JsonPropertyName("language")] public string? Language { get; set; }
        /// <summary>The code.</summary>
        [JsonPropertyName("code")] public string Code { get; set; } = "";
        /// <summary>Usage notes, one per line item.</summary>
        [JsonPropertyName("notes")] public IList<string>? Notes { get; set; }
    }

    /// <summary>One asset with links, related assets and snippets. <c>GET /api/catalog?id=</c>.</summary>
    public sealed class CatalogItemDetail
    {
        /// <summary>The asset.</summary>
        [JsonPropertyName("item")] public CatalogItem Item { get; set; } = new CatalogItem();
        /// <summary>Named links: browse, preview, ar, download and more.</summary>
        [JsonPropertyName("links")] public IDictionary<string, string> Links { get; set; } = new Dictionary<string, string>();
        /// <summary>Similar assets.</summary>
        [JsonPropertyName("related")] public IList<CatalogItem> Related { get; set; } = new List<CatalogItem>();
        /// <summary>Frameworks that have a snippet.</summary>
        [JsonPropertyName("frameworks")] public IList<string> Frameworks { get; set; } = new List<string>();
        /// <summary>Snippets keyed by framework.</summary>
        [JsonPropertyName("snippets")] public IDictionary<string, CatalogSnippet> Snippets { get; set; } = new Dictionary<string, CatalogSnippet>();
    }
}
