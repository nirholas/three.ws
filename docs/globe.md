# Global Intel Globe

**Live surface: [three.ws/globe](https://three.ws/globe)**

A 3D globe of what is happening on Earth right now. Eleven layers of open data
sit on one sphere: armed conflict, force posture and sanctions classified out of
the world news stream, natural events, severe weather, national internet
outages, economic stress, and the reference geography (military bases, nuclear
sites, maritime chokepoints) that makes the live layers mean something.

Everything on it is public data, no credential is needed to read any of it, and
the whole view (camera, zoom, projection, time range, layer selection) lives in
the URL, so any state of the page is a link you can hand to someone else.

---

## The link is the state

```
https://three.ws/globe?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts,hotspots,natural
```

| Parameter | Meaning | Values |
|---|---|---|
| `lat`, `lon` | Where the camera is pointed | `lat` clamped to ±85, `lon` wrapped to ±180 |
| `zoom` | Camera distance, reciprocal (2 is twice as close as 1) | 0.6 to 6 |
| `view` | Projection | `global` (sphere) or `flat` (equirectangular) |
| `timeRange` | Window for the live layers | `24h`, `7d`, `30d` |
| `layers` | Which layers are drawn | comma-separated ids from the table below |

Unknown values are ignored rather than fatal: a layer name that no longer exists
is skipped, a hostile `zoom=-4` is clamped, and a layer list that ends up empty
falls back to the default set instead of rendering a bare sphere.

Keyboard: `1`-`9` and `0` toggle the first ten layers, `F` switches projection,
`Space` pauses the idle spin, `Escape` closes the detail card.

## The layers

| Layer id | What it draws | Where it comes from |
|---|---|---|
| `conflicts` | Armed clashes, assaults, mass violence | GDELT 2.0, CAMEO roots 18, 19, 20 |
| `military` | Mobilizations and alert-status changes | GDELT 2.0, CAMEO root 15 |
| `sanctions` | Embargoes, boycotts, administrative sanctions | GDELT 2.0, CAMEO 163 and 172x |
| `hotspots` | Cells where that coverage concentrates | Computed from the three layers above |
| `natural` | Earthquakes, volcanoes, wildfires, landslides | USGS feed, NASA EONET, GDACS |
| `weather` | Cyclones, floods, drought, severe storms | GDACS, NASA EONET |
| `outages` | Countries whose network fell below baseline | IODA (Georgia Tech) |
| `economic` | Annual real GDP growth per country | World Bank open data |
| `bases` | Overseas basing and access agreements | Reference set, `data/globe-reference.json` |
| `nuclear` | Power stations, fuel-cycle sites, weapons complexes | Reference set |
| `waterways` | Maritime chokepoints, scored against the live feed | Reference set plus computed pressure |

Marker size, brightness and pulse all encode one number, `severity`, on 0 to 1.
Each source computes it from what it actually publishes: magnitude for a quake,
alert colour for a GDACS event, how far a country fell below its own baseline for
an outage, and the Goldstein score combined with press mentions for a GDELT
event. Nothing is scaled by a shared guess.

## The API

One call returns every layer:

```
GET /api/globe/intel                                  # all layers, 7d
GET /api/globe/intel?range=24h                        # a shorter window
GET /api/globe/intel?layers=conflicts,outages         # only what you need
```

```json
{
  "generated": "2026-09-08T22:15:03.412Z",
  "range": "7d",
  "rangeLabel": "Last 7 days",
  "maxPointsPerLayer": 1500,
  "totalEvents": 3971,
  "layers": {
    "outages": {
      "status": "ok",
      "count": 17,
      "total": 17,
      "truncated": false,
      "window": { "from": "2026-09-01T22:15:03.412Z", "to": "2026-09-08T22:15:03.412Z" },
      "coverage": "upstream",
      "source": "IODA, Georgia Tech Internet Outage Detection and Analysis",
      "note": "Countries whose reachable address space fell below its own recent baseline…",
      "events": [
        {
          "id": "ioda:IQ",
          "layer": "outages",
          "lat": 33.04,
          "lon": 43.76,
          "title": "Iraq connectivity drop",
          "detail": "Reachability below 25% of its own recent baseline, measured in bgp",
          "severity": 0.931,
          "at": "2026-09-08T03:30:00.000Z",
          "source": "IODA (Georgia Tech)",
          "url": "https://ioda.inetintel.cc.gatech.edu/country/IQ"
        }
      ]
    }
  }
}
```

Every event, from every source, has the same shape, so a client never has to
learn which service a point came from.

### Reading a layer's status honestly

`status` is `ok`, `stale` (the upstream failed and a cached copy is being
served) or `unavailable` (nothing to serve, with a `reason`). A failed layer
returns as a layer, not as a 500: on a situational map, "the outage feed is
down" is itself information, and one dead third party must never blank the other
ten.

`coverage` says where the layer's window came from:

- `upstream` - the source served the whole range that was asked for.
- `ingested` - read from the rolling window this deployment keeps (see below).
- `live` - the cold-start path: read straight from the newest GDELT files,
  covering about the last hour rather than the selected range.
- `static` - reference geography, no time dimension.

`window` is always the span the events actually cover, which for a young
deployment can be shorter than `range`. The page prints that as "Covers 15h so
far" on the layer rather than implying a week of data it does not have.

`truncated` and `total` say when a layer had more points than the per-layer cap
(`maxPointsPerLayer`). The cap keeps the payload and the frame budget sane;
hotspots are computed from the **full** set before the cap is applied, so density
on the globe is never distorted by what the point layer had room for.

## Why there is an ingest cron

GDELT publishes the world's geolocated event stream as one file every fifteen
minutes and offers no way to query history. Its GEO 2.0 API, which used to serve
that role, now 404s for every query including its own documented examples, so
building on it is not an option.

That leaves two choices: offer a time control that quietly means "the last
hour", or keep the window ourselves. [`/api/cron/globe-ingest`](../api/cron/globe-ingest.js)
does the second. Every fifteen minutes it reads the newest export files, keeps
only the three CAMEO families the globe renders (roughly a tenth of each file),
and upserts them into `globe_events` keyed on GDELT's own `GlobalEventID`, so a
re-read of an overlapping file is free.

A cold table fills quickly because backfill is cheaper than it looks: each run
reads twelve files while only one new one has appeared, so history accumulates
about eleven times faster than real time and a month of window is complete in
about three days. Until then, the API reports what it actually covers.

Retention is 32 days, two more than the longest window the UI offers, and the
tail is thinned: past seven days only multi-source events are kept. That reads
the same way from either side. Editorially, a 30-day overview should be the shape
of the month, and single-source reports are noise at that zoom; practically, this
table takes about 120 rows every fifteen minutes and thinning roughly halves what
a full month costs on a database that is already near its retention high-water
mark. Nothing inside the seven-day detail window is thinned, so no view of the
last week loses a point.

The cron also carries `requireWriteCapacity`, so when the database is at its
storage mark it stands down and lets `db-retention` reclaim space first. A globe
window that stops growing for an hour is a smaller problem than a write path that
cannot take a payment.

The cron is authenticated like every other scheduled handler on the platform
(`CRON_SECRET`, see [`api/_lib/cron-auth.js`](../api/_lib/cron-auth.js)) and runs
on Cloud Scheduler from the `crons` array in `vercel.json`.

## Geometry

Two files are baked from Natural Earth (public domain, via the `world-atlas`
package) by [`scripts/build-globe-geometry.mjs`](../scripts/build-globe-geometry.mjs)
and committed, so the browser pulls one small static file and the API resolves a
country code with no network call:

- `public/data/globe-land.json` - coastline polylines, already split at the
  antimeridian so no line is drawn straight across the map.
- `data/country-centroids.json` - ISO alpha-2, alpha-3 and numeric codes to a
  point, used by the two layers that report by country (IODA and the World Bank).

Country points are area-weighted centroids of each country's **largest** landmass,
not bounding-box middles and not an average over every island. The difference is
not cosmetic: an average puts France in the Atlantic, and a bounding box puts
Norway in Sweden.

Regenerate after bumping `world-atlas`:

```bash
npm run build:globe-geometry
```

## Rendering

The page is [`pages/globe.html`](../pages/globe.html) plus two modules:

- [`src/globe-intel-core.js`](../src/globe-intel-core.js) - the arithmetic, with
  no DOM and no three.js: the layer registry, URL state, both projections, marker
  scaling, feed ranking. Covered by `tests/globe-intel-core.test.js`.
- [`src/globe-intel.js`](../src/globe-intel.js) - the scene, the pointer and the
  panels.

Everything drawable is stored twice, once as a point on the sphere and once as a
point on the equirectangular plane, and the view control lerps between them.
That is why switching to the flat map is a morph rather than a rebuild. The blend
is written back into the geometry's `position` attribute rather than applied in a
vertex shader, deliberately: the raycaster reads `position`, and a shader-side
morph would leave every marker unpickable in the flat view.

Markers are drawn with a custom `ShaderMaterial` because severity has to drive
per-point size, which `PointsMaterial` cannot express. Area layers (hotspots,
outages, chokepoints) render as annuli instead of filled dots so a region never
reads as a single incident.

## Sources and their terms

| Source | Access | Notes |
|---|---|---|
| [GDELT 2.0](https://www.gdeltproject.org/) | Open, no key | 15-minute export files; the GEO 2.0 API is dead |
| [USGS earthquakes](https://earthquake.usgs.gov/earthquakes/feed/) | Open, no key | Public-domain feed |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Open, no key | Open natural-event tracker |
| [GDACS](https://www.gdacs.org/) | Open, no key | UN and European Commission joint system |
| [IODA](https://ioda.inetintel.cc.gatech.edu/) | Open, no key | Georgia Tech; data is theirs, attribution in the payload |
| [World Bank](https://data.worldbank.org/) | Open, no key | Annual indicators |
| Natural Earth | Public domain | Via `world-atlas` |

If a source starts requiring a key, the layer degrades to `unavailable` with the
reason attached; it does not take the page with it.

## Related

- [`STRUCTURE.md`](../STRUCTURE.md) maps every surface on the platform.
- [Crypto Market Heatmap](https://three.ws/heatmap) is the same idea applied to
  markets rather than geography.
