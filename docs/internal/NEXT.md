# /loop blockers / decisions for the user

Items the autonomous loop deferred because they need your call.

## Server-side GLB → PNG render (true OG-card path)

**Status:** deferred — shipped the client-side capture + upload alternative instead (see `src/voice/avatar-snapshot.js` and PROGRESS.md item 4).

**Why deferred:** a real headless GLB renderer needs one of:
- `puppeteer-core` + `@sparticuz/chromium-min` — adds ~60 MB to every Vercel function bundle and ~1–2s of cold-start. Best ergonomics, worst footprint.
- `gl` + `@napi-rs/canvas` + custom three.js bootstrap — leaner but needs native build (libGL, libX11) that Vercel's runtime doesn't ship.
- Render via Cloudflare Workers using their `Browser Rendering` beta — needs a Workers plan + a separate deployment.

Picking one is a deployment-cost decision (function size, latency, $$) that I shouldn't make autonomously. The current client-side path makes thumbnails work on the customizer save — once you decide on a server-renderer, the new endpoint can replace `presign-thumbnail` + `auto-tag` for crawl-time OG generation without changing any of the client wiring.

**Recommendation:** `puppeteer-core` + `@sparticuz/chromium-min` is the lowest-friction path if the function-size hit is acceptable. The chromium binary is downloaded once at deploy time, not on every cold start.

## meshoptimizer / draco3d peer deps

The compression pass in `bake.js` uses `weld + quantize + textureCompress`. Adding `meshoptimizer` and `draco3d` (`npm i meshoptimizer draco3d`) would unlock the more aggressive `meshopt()` and `draco()` transforms — typically 2–3× further reduction on top of what we already get. ~5 MB combined dep cost.
