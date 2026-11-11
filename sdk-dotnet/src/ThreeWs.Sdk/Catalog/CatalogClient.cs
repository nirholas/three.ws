using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using ThreeWs.Sdk.Internal;

namespace ThreeWs.Sdk.Catalog
{
    /// <summary>
    /// The free 3D asset catalog: CC0 objects, rigged characters and motion clips. No key needed.
    /// Reach it through <see cref="ThreeWsClient.Catalog"/>.
    /// </summary>
    public sealed class CatalogClient
    {
        private readonly ApiTransport _transport;

        internal CatalogClient(ApiTransport transport) => _transport = transport;

        /// <summary>Searches the catalog. <c>GET /api/catalog</c>.</summary>
        public Task<CatalogSearchResult> SearchAsync(CatalogQuery? query = null, CancellationToken cancellationToken = default)
        {
            query ??= new CatalogQuery();
            var path = new QueryString("/api/catalog")
                .Add("q", string.IsNullOrWhiteSpace(query.Query) ? null : query.Query)
                .Add("kind", query.Kind)
                .Add("category", query.Category)
                .Add("tag", query.Tag)
                .Add("limit", query.Limit)
                .Add("offset", query.Offset)
                .ToString();
            return _transport.SendJsonAsync(new RequestSpec { PathAndQuery = path, SendCredentials = false }, ThreeWsJsonContext.Default.CatalogSearchResult, cancellationToken);
        }

        /// <summary>Searches with a free-text query.</summary>
        public Task<CatalogSearchResult> SearchAsync(string text, string? kind = null, int? limit = null, CancellationToken cancellationToken = default)
            => SearchAsync(new CatalogQuery { Query = text, Kind = kind, Limit = limit }, cancellationToken);

        /// <summary>Walks every page of a search, yielding each item. Stop enumerating to stop fetching.</summary>
        public async IAsyncEnumerable<CatalogItem> SearchAllAsync(CatalogQuery? query = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            query ??= new CatalogQuery();
            var page = new CatalogQuery { Query = query.Query, Kind = query.Kind, Category = query.Category, Tag = query.Tag, Limit = query.Limit ?? 50, Offset = query.Offset };
            while (true)
            {
                var result = await SearchAsync(page, cancellationToken).ConfigureAwait(false);
                foreach (var item in result.Items) yield return item;
                if (!result.NextOffset.HasValue || result.Items.Count == 0) yield break;
                page.Offset = result.NextOffset;
            }
        }

        /// <summary>Gets one asset with links, related assets and embed snippets. <c>GET /api/catalog?id=</c>. Throws <see cref="ThreeWsNotFoundException"/> for an unknown id.</summary>
        public Task<CatalogItemDetail> GetAsync(string id, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("An asset id is required.", nameof(id));
            return _transport.SendJsonAsync(
                new RequestSpec { PathAndQuery = new QueryString("/api/catalog").Add("id", id).ToString(), SendCredentials = false },
                ThreeWsJsonContext.Default.CatalogItemDetail,
                cancellationToken);
        }
    }
}
