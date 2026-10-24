# Object Library: free CC0 3D props for any scene

The Object Library is a free, curated gallery of CC0 3D objects and props: furniture, lighting, electronics, containers, tools, decor. Every object is public domain, free to use commercially with no attribution required. Preview any object live in the browser, place it in your real room with AR, or download the GLB and use it in any engine or tool.

Page: [/objects](https://three.ws/objects) · API: `GET /api/objects/library`
Source: [`pages/objects.html`](../pages/objects.html) · [`src/objects-library.js`](../src/objects-library.js) · [`api/objects/library.js`](../api/objects/library.js)

> This page covers the object gallery and its API. For rigged, animation-ready characters, see the [Character Library](./character-library.md). For how AR placement works on phones and desktops, see [AR & WebXR](./ar.md).

---

## What is in the library

Several hundred CC0 props staged as web-ready GLBs on the R2 CDN, currently sourced from Poly Haven (each entry's `source` field says where it came from). Every entry carries its categories (for the filter chips), free-text tags (searched along with the name), and its file size. The API's `total` field is the authoritative count.

Objects are props, not agents: opening one in the viewer uses object mode, which shows view and modify affordances instead of the agent chat dock.

## Using the gallery

Each card shows the pre-rendered thumbnail and offers three actions. A card stays a still image until you dwell on it (or tab into it), at which point that one card upgrades to a live, auto-rotating `<model-viewer>`; at most six stay mounted at a time, and a card with no rendered thumbnail upgrades as soon as it scrolls into view. Sweeping the pointer across a row never starts a download, because the upgrade waits on hover intent rather than the first `pointerover`.

| Button | Destination | What you get |
|---|---|---|
| **Preview** | `/app#model=<glb-url>&kind=object&title=<name>` | The full three.js [3D viewer](./viewer.md) in object mode (no agent chat; Restyle, AR, and Download affordances instead) |
| **AR** | `/ar/studio?src=<glb-url>&title=<name>` | [AR Studio](./ar-studio.md): place the prop in your real space through the camera (see [AR & WebXR](./ar.md) for how the AR handoff works per device) |
| **Download** | The GLB URL directly | The raw GLB file, CC0, yours to use anywhere |

Gallery controls:

- **Category chips** above the grid filter by category (furniture, lighting, tools, and so on), derived live from the manifest. A source catalog's own `collection:` labels are not browsing categories, so they are excluded from the chips. "All" clears the filter.
- **Search** matches names, tags, and categories; press `/` anywhere on the page to focus the search box.
- **Sort** by name (A to Z, Z to A) or by file size (largest or smallest first).
- The whole manifest is fetched once and filtered client-side, so chips, search, and sort are instant.
- The grid renders 48 cards at a time behind a **Load more** button, which an `IntersectionObserver` also trips as you approach it. A live region above the grid announces the running tally ("48 of 511 shown") after every chunk. Mounting a viewer per entry is what made this page take 18 seconds to its first interactive card.
- Loading shows a skeleton grid; an empty library, an empty search result, and a fetch error each have their own designed state with a recovery action, and a failed load names the actual reason beside its retry button.

## API: `GET /api/objects/library`

Public, no authentication, `GET` and `OPTIONS` only (`HEAD` is answered like `GET`). CORS is open (`Access-Control-Allow-Origin: *`), so a browser `fetch` from any origin works: the manifest is a CC0 index with no caller data in it, and the GLBs it points at already load cross-origin through `/cdn/<key>`. That is what lets an embedded [AR Studio](./ar-studio.md) on someone else's site render the object tray, not just the models in it. The endpoint proxies a small manifest JSON from the R2 CDN (`objects/library/manifest.json`) with an edge cache (`Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`). The GLB and thumbnail bytes never pass through the API: every entry carries absolute CDN URLs the browser loads directly. It mirrors the [Character Library API](./character-library.md) exactly, with `objects` in place of `avatars`.

### Query parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `limit` | integer, 1 to 1000 | none | Opt-in pagination. Omit it to get the entire library in one response. A value above 1000 is clamped to 1000. |
| `offset` | integer, >= 0 | 0 | Requires `limit`; sent on its own it is an error, not a silent no-op. |

Both cursors are validated strictly. Anything that is not a whole decimal number in range (`?limit=abc`, `?limit=0`, `?limit=2.7`, `?offset=-3`, or `?offset=` with no `limit`) returns `400` with a JSON body of `{ "error": "invalid_limit" | "invalid_offset", "error_description": "..." }` and `Cache-Control: no-store`. A bad cursor never degrades into a page you did not ask for.

### Response shape

Without `limit`:

```json
{
  "objects": [ { "...": "entry, see below" } ],
  "total": 511,
  "generated_at": "2026-07-21T13:16:14.305Z"
}
```

With `limit` (and optional `offset`), the response adds `offset` and `next_offset`. `next_offset` is `null` on the last page, and `total` is always the full library size, not the page size.

Each entry in `objects`:

| Field | Type | Meaning |
|---|---|---|
| `name` | string | URL-safe slug, stable identifier |
| `label` | string | Display name |
| `url` | string | Absolute CDN URL of the GLB |
| `thumb` | string (optional) | Absolute CDN URL of the PNG thumbnail; only present when the thumbnail actually rendered, so it is never a broken image link |
| `bytes` | number | GLB file size |
| `categories` | string[] | Categories, used by the gallery's filter chips |
| `tags` | string[] | Free-text tags, searched by the gallery |
| `license` | string | `"CC0"` or `"CC-BY-4.0"` |
| `attribution` | string (optional) | Credit line to show wherever the model is used; present on every `CC-BY-4.0` entry |
| `source` | string | Origin catalog, e.g. `"polyhaven"` |

Before the manifest is first uploaded, the endpoint returns `{ "objects": [], "total": 0 }` rather than an error, so consumers feature-detect by emptiness. A storage outage degrades the same way, but that response carries `Cache-Control: no-store` instead of the 300s edge cache, so the library reappears the moment storage recovers rather than staying empty for the rest of the cache window.

The manifest read itself has a second path before it gets there. `getPublicObjectBuffer()` reads the key over the signed S3 connection first, and on any failure refetches the same key from the public CDN domain, because a CC0 manifest is public data either way. A rejected or rotated storage credential therefore cannot empty the catalog. Only both paths failing produces the empty response, and it rethrows the *signed* error, so a genuine `NoSuchKey` still means "not published yet" rather than a transport fault.

### Example

```bash
curl -s 'https://three.ws/api/objects/library?limit=2&offset=0'
```

Returns the first two objects plus `total`, `offset`, and `next_offset`, each entry with a directly loadable `url` (GLB) and, when rendered, a `thumb` (PNG).

## Licensing

Every manifest entry carries its own `license`, and there are two:

- **`CC0`** (the Poly Haven props): public domain. Free for any use, personal or commercial, no attribution required (crediting the original authors is appreciated, never required), and you may download, modify and redistribute the GLB anywhere.
- **`CC-BY-4.0`** (the [NVIDIA SimReady assets](./simready-assets.md)): free for any use, personal or commercial, as long as you credit the author. These entries also carry an `attribution` string (`NVIDIA SimReady Assets, CC BY 4.0, <source url>`), and the gallery prints it on the card. The GLBs are converted and decimated derivatives of NVIDIA's OpenUSD originals, which CC BY 4.0 permits with attribution.

Read `license` before redistributing; do not assume CC0 for the whole library.

## How the library is staged (maintainers)

The gallery and API are read-only consumers of a manifest built by a local pipeline. The GLB bytes live on the R2 CDN; only the manifest index is published:

1. `scripts/fetch-polyhaven-objects.mjs` downloads and converts the source models and writes `public/objects/polyhaven/catalog.json`.
2. `scripts/render-glb-thumbnails.mjs` renders the PNG thumbnails to R2.
   The NVIDIA SimReady set has its own ingest: see [SimReady assets](./simready-assets.md).
3. `scripts/build-object-library.mjs` reads the catalogs (Poly Haven and SimReady), keeps only completed models, includes a `thumb` only for thumbnails that actually rendered, and PUTs `objects/library/manifest.json` to R2 (`--dry-run` prints without uploading).

## Related

- [Character Library](./character-library.md): the rigged, animation-ready counterpart to this library.
- [AR & WebXR](./ar.md): the device-by-device AR methods behind the AR button.
- [AR Studio](./ar-studio.md): the `/ar/studio` surface the AR button opens, including multi-object rooms.
- [3D Viewer](./viewer.md): the `/app` engine the Preview button opens in object mode.
