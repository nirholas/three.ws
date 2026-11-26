# NVIDIA Accelerated Apps Catalog: full pull

A local copy of every entry in NVIDIA's public Accelerated Apps Catalog. Use it to check
whether three.ws is listed yet and to see how other Inception startups name and describe
their entries.

Related: [nvidia-apps-catalog-listing.md](../nvidia-apps-catalog-listing.md) (our listing kit)
and [nvidia-apps-catalog-request.md](../nvidia-apps-catalog-request.md) (the email thread).

## Refresh

```bash
node scripts/nvidia-apps-catalog-pull.mjs                  # all apps -> catalog.json / catalog.csv
node scripts/nvidia-apps-catalog-pull.mjs --inception      # Inception startup view -> catalog-inception.*
node scripts/nvidia-apps-catalog-pull.mjs --inception --find three.ws   # is three.ws listed?
```

The source is the JSON API that the catalog widget on nvidia.com calls:
`GET https://api-prod.nvidia.com/services/apps-catalog/v1/catalog?locale=en-us&groupID=appscatalog&start=N&total=100`,
sent with a `Content-Type: application/json` header. It needs no key. The Inception view
adds `filter=<base64 of {"Collections":["Inception"]}>`. The `marketplace.nvidia.com` front
end blocks automated clients, but this API does not.

The data files (`*.json`, `*.csv`) are gitignored. They are third-party data that can be
regenerated, and some entries name other blockchain projects, which the commit gate in
CLAUDE.md covers. Run the script to recreate them.

## Pull of 2026-11-26

- **Full catalog:** 1,843 apps. **Inception view:** 932 apps.
- **three.ws:** not listed yet. A search for `three` matches only `ThreeParticle/CAE`
  (BECKER 3D GmbH) and `Unlimited3D` (Threedium Ltd).

### How Inception startups name their entries

Each entry has a product `title` and a separate `company` field, and the catalog shows both.
Of the 932 Inception entries:

- **147 use the company name as the title**, for example `Alpha3D`, `Convai` and `Kuona`.
- **184 use the company name plus a product word or description**, for example
  `Plask API`, `Shakudo Platform`, `Timedomain ACE Studio`,
  `Soul Machines Digital People` and `Avaturn Realistic 3D Avatar Creator`.
- **601 use a product name that does not include the company**, for example `Aidoc`,
  `Real Time Video Denoiser` (Visionary.ai) and `Motionverse` (Beijing DeepScience).

The catalog accepts any of these styles. What NVIDIA checks is that the title matches the
name used on the linked page. That is why App Publishing asked about "three.ws 3D AI
Studio" on 2026-11-25.

The catalog card prints the company on its own line directly above the product title, so a
title that repeats the company reads twice. That is why our entry is **Forge: AI 3D Model
Generator** with no "three.ws" in it; the card supplies the company line. Decision record in
[nvidia-apps-catalog-request.md](../nvidia-apps-catalog-request.md#app-publishing-reply-2026-11-25).

### Nearby entries (3D generation, avatars, digital humans)

Alpha3D, Kaedim3D, echo3D, Avaturn Realistic 3D Avatar Creator, Convai, Soul Machines
Digital People, Move AI, Lumirithmic, Synty, Timedomain ACE Studio, Motionverse, DeepReel,
and Emotech's AI Digital Avatar. Most are a short brand name, or the brand plus a product
word.
