# Listing in the Supabase partner catalog

Supabase lists third-party integrations at <https://supabase.com/partners/integrations>. Each
listing gets a page at `supabase.com/partners/catalog/<slug>` with a tagline, a hero image, an
Overview, and a Details block (Developer, Category, Website, Documentation) that links back to
the partner's docs. The catalog is curated: Supabase reviews every application, says review
takes about a week, and says it goes faster when the integration is already live. Listing is
free. (Read from supabase.com/partners on 2026-11-28.)

Submitting the form is an owner action. Everything it needs is below.

## State

- Integration: two SQL migrations and one Edge Function, in `supabase/` here.
- `npm test`: 44 tests pass. The migrations run on Postgres 18 with Supabase's roles,
  `auth.uid()`, Storage and Realtime, and the sweep runs every failure path.
- `npm run test:live`: passes against production three.ws, both for a new generation
  (submit, poll, download, store; 83 s) and for a cached prompt.
- `deno check` passes on the Edge Function. Booted under Deno, it answers 405, 500
  `unconfigured` and 401 as documented.
- Setup guide: [docs/supabase.md](../../docs/supabase.md). It goes live at
  <https://three.ws/docs/supabase> with the next production deploy, and the `npx degit`
  install commands in it work once this folder is pushed to `nirholas/three.ws`.

## Owner steps

1. Push and deploy, so <https://three.ws/docs/supabase> and the degit paths resolve. Check:
   `curl -sI https://three.ws/docs/supabase` answers 200, and
   `npx degit nirholas/three.ws/integrations/supabase/supabase/functions/three-ws-forge /tmp/f`
   writes four files.
2. Optional but faster review: follow the guide in a real Supabase project and keep it running,
   so the reviewer can see a working install.
3. Open <https://supabase.com/partners?partner_type=Tech%20Partner#become-a-partner> (the
   Integration Partner program), fill the form with the copy below and a contact email you
   monitor, and submit.
4. When Supabase replies, send the listing copy and assets below and answer their review.
5. When the listing is live, add its URL to the `supabase-partner-catalog` entry in
   `data/listings.json` with status `live`, then run `npm run listings:build`.

## Application copy

**Company:** three.ws

**Website:** https://three.ws

**Program:** Integration Partner

**What the product does**

three.ws is a platform for 3D AI agents and 3D content. Its Forge API turns a text prompt into a
textured, ready-to-use 3D model (GLB) in a minute or two, on a free tier that needs only a
three.ws account. Forge already runs inside Blender, ComfyUI, Cursor, Claude and other tools.

**Who it helps**

Developers building on Supabase who want 3D in their app without running a 3D or GPU
pipeline: games and virtual worlds, e-commerce product previews, avatar and character apps,
AR prototypes, education, and AI apps that turn a user's description into an object they can
view, download or place in a scene.

**How it connects to Supabase**

The integration is native Supabase. Nothing runs outside the user's project except the Forge
API call:

- a `three_ws_models` Postgres table with row level security and column grants, so a signed-in
  user can insert only a prompt and see only their own models;
- an Edge Function (`three-ws-forge`) that submits each prompt to Forge, polls the job, and
  uploads the finished GLB to a private Storage bucket with owner-only policies;
- `pg_net` and `pg_cron` to call the function after each insert and every minute while a model
  is unfinished, with the function URL and shared secret kept in Vault;
- Realtime, so the app sees each status change as it happens.

Install is two migrations and one function: `supabase db push`, two secrets, and
`supabase functions deploy`. Docs: https://three.ws/docs/supabase. Source (Apache-2.0):
https://github.com/nirholas/three.ws/tree/main/integrations/supabase

**Maintenance**

three.ws maintains the integration in its main repository, beside the Forge API it calls, so
an API change and the integration change ship together. It has 44 tests over the real
migrations and a live test that generates a real model through production Forge. Support is
through GitHub issues at https://github.com/nirholas/three.ws/issues.

## Listing copy

**Name:** three.ws Forge

**Tagline:** Turn a prompt in a Postgres table into a textured 3D model in Supabase Storage.

**Category:** AI

**Developer:** three.ws

**Website:** https://three.ws

**Documentation:** https://three.ws/docs/supabase

**Overview**

three.ws Forge generates textured 3D models (GLB) from text. This integration brings it into
your Supabase project: insert a prompt into the `three_ws_models` table and a Supabase Edge
Function sends it to Forge, waits for the model, and stores the GLB in a private Storage
bucket under the user's own folder. Your app follows progress over Realtime and shows the
finished model with a signed URL.

Row level security lets each user insert only a prompt and read only their own models, and a
per-user cap stops anyone from draining your quota. Busy moments and rate limits are retried
when Forge asks, and every submission is idempotent, so a retry never pays twice. The free tier
covers the default image-to-3D pipeline with three quality tiers: draft, standard and high.

Setup takes a few minutes: add two migrations and one Edge Function, set two secrets, and
deploy.

## Assets

- Logo: `public/three-ws-app-icon-1024.png` (square) and `public/three-ws-lockup-on-light.png`
  / `public/three-ws-lockup-on-dark.png` (wordmark). The full press kit is
  `public/three-ws-press-kit.zip`.
- Hero image: `integrations/supabase/listing/hero.png`, a screenshot of the example client
  (`example/index.html`) showing a finished model in the viewer beside the live list.
