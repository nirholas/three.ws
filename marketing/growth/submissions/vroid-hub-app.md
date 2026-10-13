# VRoid Hub app registration: three.ws avatar import

Target: [developer.vroid.com](https://developer.vroid.com) application
registration (Doorkeeper OAuth2 client for hub.vroid.com).

Ready for owner order 939. Built and tested in work order 092; the
developer-account application registration, client credentials, and
Cloud Run env vars are owner actions (CLAUDE.md gate 2 and the "Never
blocked" rule for a step that needs a third-party account only the owner can
create). This Evolve session confirmed no VRoid Hub application exists in
production yet: `node scripts/read-service-env.mjs '^VROID' --names` returns
zero matches, so `VROID_HUB_CLIENT_ID` and `VROID_HUB_CLIENT_SECRET` are both
unset.

## What ships

- `api/auth/vroid/[action].js`: OAuth2 connect/callback/status/disconnect,
  mandatory PKCE (verified live: the authorize endpoint 400s without
  `code_challenge`), HMAC-signed state carrying the code verifier and a CSRF
  nonce in one round trip, same pattern as the GitHub social-connect flow.
- `api/_lib/vroid/config.js`, `api/_lib/vroid/client.js`: endpoint
  construction, the Doorkeeper token exchange, `X-Api-Version: 11` header,
  the `{data,error,_links,rand}` envelope unwrap, and the two-step download
  flow (`POST /api/download_licenses` then `GET /api/download_licenses/{id}/download`).
- `api/_lib/vroid/token-store.js`, `api/_lib/vroid/token-crypto.js`:
  AES-GCM encrypted token storage in the shared `social_connections` table,
  with transparent refresh.
- `api/_lib/vroid/license.js`: maps the real `CharacterModelLicenseSerializer`
  fields (`characterization_allowed_user`, `redistribution`, `modification`,
  `personal_commercial_use`, `corporate_commercial_use`, `credit`, plus the
  two content-rating fields) to four three.ws actions (public agent, export,
  modify, monetize) and a required-credit flag, defaulting closed.
- `api/vroid/models.js`: lists the signed-in user's own and hearted
  character models (`GET /api/account/character_models`, `GET /api/hearts`),
  each annotated with its license evaluation.
- `api/vroid/import.js`: mints a download license, resolves its redirect,
  validates the GLB header, canonicalizes bones, stores the license and
  credit line on the avatar, and redirects into `/avatars/{id}/edit`.
- `pages/import-vroid.html`: the picker UI at `/import/vroid`, four states
  (loading, not-configured, disconnected, connected), per-model license
  badges, and a working import button.
- Docs: `docs/vroid-hub-import.md`. Changelog, `data/pages.json`, and
  `STRUCTURE.md` wired.
- `api/_lib/migrations/20261015070000_vroid_hub_source.sql`: adds
  `'vroid_hub'` to the avatars `source` check constraint. Written, not
  applied (owner action, see Step 3 below).

Scope requested: `default` (VRoid Hub's own minimal grant; it is what the
`/api/account/character_models` and `/api/hearts` endpoints require and
nothing broader exists to request).

## Step 1: create the application at hub.vroid.com/oauth/applications

1. Sign in at <https://hub.vroid.com/oauth/applications> with a pixiv
   account (this can be a dedicated three.ws account or the owner's personal
   VRoid Hub account; either works, the application is independent of which
   account's characters get imported later), and agree to the Terms of Use
   and Privacy Policy when prompted. Confirmed live 2026-10-13: this page
   serves a real "Application management" sign-in screen (not 404), matching
   the row already tracked in `docs/partners/prospects.md`.
2. Create a new application.
3. **Application name:** `three.ws`.
4. **Redirect URI:** `https://three.ws/api/auth/vroid/callback` (must match
   `redirectUri()` in `api/_lib/vroid/config.js` exactly, including scheme
   and no trailing slash).
5. Confirm the application's **Client ID** and **Client secret**. The secret
   is typically shown once; store it immediately.
6. Per `developer.vroid.com`'s own guidelines, a new application generally
   needs approval before it can go live for end users outside the developer
   account's own characters; submit for approval if the dashboard presents
   that step (reply time is about a week per developer.vroid.com).

## Step 2: confirm scope and API version

1. VRoid Hub's `default` scope is the only one relevant for this
   integration: it covers the `/api/account/character_models`, `/api/hearts`,
   `/api/character_models/{id}`, and `/api/download_licenses*` endpoints this
   app calls. No additional scope needs to be requested in the application
   settings.
2. No action needed for API version: `api/_lib/vroid/config.js` already
   sends `X-Api-Version: 11` on every request, matching the version
   documented at `developer.vroid.com/en/api/oauth-api.html` as of this
   session.

## Step 3: set the environment on Cloud Run and run the migration

Use `--update-env-vars` (never `--set-env-vars`, which replaces the entire
env set):

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars VROID_HUB_CLIENT_ID=<client id>,VROID_HUB_CLIENT_SECRET=<client secret>
```

Then apply the pending migration:

```bash
npm run db:status   # confirm 20261015070000_vroid_hub_source.sql is the pending one expected
npm run db:migrate  # applies immediately, no dry run
```

This widens the `avatars.source` check constraint to accept `'vroid_hub'`
alongside the existing values.

## Step 4: verify live (this Evolve session cannot reach this point)

1. Open `/import/vroid` while signed out of VRoid Hub (but signed in to
   three.ws). Confirm the "Connect VRoid Hub" button redirects to a real
   `hub.vroid.com/oauth/authorize` screen and that approving it returns to
   the picker with `?vroid=connected`.
2. Confirm the picker lists at least one real character under "Your
   characters" (upload one in VRoid Studio and publish it to VRoid Hub first
   if the connected account has none) with correct license badges matching
   what was set in the VRoid Hub character's own publish settings.
3. Heart a downloadable character from another creator on hub.vroid.com,
   reload the picker, and confirm it appears under "Hearted characters".
4. Click **Import to three.ws** on a character whose license permits at
   least export or modify. Confirm the request succeeds, the avatar appears
   in the user's avatar library, and the browser lands on
   `/avatars/{id}/edit` with idle and walk animations playing on the
   imported rig. Screenshot this as the completion evidence for the "lands
   in the editor with animations playing" Definition of Done line.
5. Open the imported avatar's public page and confirm the creator credit
   line is visible, matching the character's `credit` license field.
6. Attempt to import a character whose license sets
   `characterization_allowed_user` to something other than `everyone` into
   a public agent slot (if/when that surface checks `source_meta.actions`)
   and confirm it is refused. This is the completion evidence for the
   license-enforcement Definition of Done line.

## Verification packet

- Source: this repository, `api/_lib/vroid/`, `api/auth/vroid/`,
  `api/vroid/`, `pages/import-vroid.html`.
- Every endpoint shape (authorize PKCE requirement, token grant-type
  requirement, the `{data,error,_links,rand}` envelope, the
  `CharacterModelLicenseSerializer` fields, the two-step download-license
  flow) was confirmed live against `hub.vroid.com` and
  `developer.vroid.com`'s published API reference during this session, not
  guessed.
- Local tests: `tests/vroid-license.test.js` (9 cases, license normalization
  and action evaluation). `npx vitest run tests/vroid-license.test.js` passes.
- `npm run check:rules` passes on every touched file.

## Owner steps (not automatable here)

1. Create the developer.vroid.com application and copy the client ID and
   secret (Step 1).
2. No scope/version changes needed beyond the defaults already wired
   (Step 2).
3. Set `VROID_HUB_CLIENT_ID` / `VROID_HUB_CLIENT_SECRET` on Cloud Run with
   `--update-env-vars`, then run `npm run db:migrate` for
   `20261015070000_vroid_hub_source.sql` (Step 3).
4. Connect a real VRoid Hub account, import a character, verify the editor
   landing and credit line, and confirm license enforcement; capture the
   screenshots this Definition of Done needs (Step 4).
