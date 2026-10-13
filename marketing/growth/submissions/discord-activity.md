# Discord Activity submission: Forge Room

Target: [Discord Developer Portal](https://discord.com/developers/applications)
(create the application) and, once live, [Discord Activity Discovery](https://discord.com/developers/docs/activities/discovery)
(order 939).

Ready for owner order 939. Built and tested in work order 088; the account
creation, env vars, and Discovery submission are owner actions (CLAUDE.md
gate 2 and the "Never blocked" rule for a step that needs a third-party
account only the owner can create). This Evolve session confirmed no Discord
application exists in production yet: `DISCORD_CLIENT_ID` /
`DISCORD_CLIENT_SECRET` are unset, and even `DISCORD_PUBLIC_KEY` (used by the
pre-existing interactions webhook, `api/gateway/discord.js`) has never been
provisioned.

## What ships

- `pages/discord-activity.html` + `src/discord-activity/app.js`: the
  Activity's client, built on `@discord/embedded-app-sdk` v2.5.0.
- `api/gateway/discord-activity-config.js`: public runtime config
  (`client_id`, `cdn_host`), 503 until the owner sets the env vars below.
- `api/gateway/discord-activity-token.js`, `api/gateway/discord-activity-session.js`,
  `api/_lib/gateway/discord-activity-auth.js`: the OAuth2 code exchange and
  session minting, verified against Discord's own `/users/@me`.
- `api/gateway/discord-activity-room/[id].js`, `api/_lib/gateway/discord-activity-store.js`:
  the shared room (snapshot, SSE stream, prompt/creation/vote), backed by
  `api/_lib/migrations/20261015050000_discord_activity_rooms.sql`.
- `api/_lib/gateway/discord-activity-agent.js`: grounded agent reaction lines.
- Docs: `docs/discord-activity.md`. Changelog and `STRUCTURE.md` wired.

## Step 1: create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name: `three.ws` (or `three.ws Forge Room` if that name is taken by
   another of the owner's apps).
3. Under **General Information**, copy the **Application ID** (this is
   `DISCORD_CLIENT_ID`) and the **Public Key** (this is `DISCORD_PUBLIC_KEY`,
   needed by the existing `api/gateway/discord.js` interactions webhook,
   currently also unset).
4. Under **OAuth2 → General**, click **Reset Secret**, copy it
   (`DISCORD_CLIENT_SECRET`). This value is shown once.

## Step 2: enable Activities

1. In the application sidebar, open **Activities → Settings**.
2. Toggle **Enable Activities** on.
3. **Supported Platforms**: enable Desktop and Mobile (the room UI is
   responsive; it has been reviewed for a narrow mobile Activity panel width).
4. **Root Mapping**: set the Activity's root URL to the production three.ws
   origin (`https://three.ws`), with the entry path `/discord-activity`.
   Discord auto-proxies this root domain; no explicit URL Mapping entry is
   needed for it.
5. **URL Mappings** (additional mappings, beyond the root): add one row:
   - Prefix: `cdn`
   - Target: the live value of `S3_PUBLIC_DOMAIN` without the scheme, e.g.
     `pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev` (confirm the exact live
     value with `node scripts/read-service-env.mjs '^S3_PUBLIC_DOMAIN$' --raw`
     before saving; it must match exactly, no trailing slash).

   This is the CDN that serves Forge preview images; the client calls
   `patchUrlMappings([{ prefix: 'cdn', target: cdnHost }], ...)` on boot
   (`src/discord-activity/app.js`) to route through it. Do not add a mapping
   for `/api/forge` or `/api/gateway/*`: those are same-origin and already
   covered by the root mapping.

## Step 3: OAuth2 redirect and scopes

1. Under **OAuth2 → General → Redirects**, add:
   `https://three.ws/discord-activity` (the client only uses the
   authorization-code grant inside the SDK's `authorize()` call, which does
   not perform a browser redirect, but Discord requires at least one
   registered redirect URI to issue a client secret).
2. No additional OAuth2 scopes need to be pre-approved; the Activity requests
   `identify` only, at runtime, via `discordSdk.commands.authorize()`.

## Step 4: set the environment on Cloud Run

Use `--update-env-vars` (never `--set-env-vars`, which replaces the entire
env set):

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars DISCORD_CLIENT_ID=<application id>,DISCORD_CLIENT_SECRET=<client secret>,DISCORD_PUBLIC_KEY=<public key>
```

## Step 5: run the migration

```bash
npm run db:status   # confirm the pending migration is the one expected
npm run db:migrate  # applies immediately, no dry run
```

This creates `discord_activity_rooms`, `discord_activity_participants`, and
`discord_activity_events`.

## Step 6: verify in a real Discord client

1. In the Developer Portal, add a **Test Server** the owner controls (or use
   an existing server where the owner has **Manage Server**).
2. Open that server's voice channel in the actual Discord desktop or mobile
   client (Activities do not run in a browser tab outside Discord; this
   Evolve session's build cannot verify this step because no Discord
   application has ever been registered, so there is nothing to launch
   against yet).
3. Click the Activities launcher (rocket icon) in the voice channel and
   select the three.ws Activity.
4. Have a second account join the same voice channel and open the Activity.
5. From account A, type a prompt and submit. Confirm account B's panel shows
   the same prompt line, the same "Generating..." status, and the same
   finished model + vote count once it completes, without refreshing.
6. Screenshot both accounts' panels side by side as the completion evidence
   for this Definition of Done line.

## Step 7: Discovery submission

Once Step 6 passes, submit for Activity Discovery per
<https://discord.com/developers/docs/activities/discovery>. Suggested listing
copy:

**Name:** Forge Room

**Tagline:** Prompt, generate, and vote on a 3D model together, live in your
voice channel.

**Description:**

> Forge Room turns your voice channel into a tiny shared 3D studio. Anyone in
> the call can type a prompt, and everyone watches the same model generate in
> real time, powered by three.ws's free Forge pipeline. When it's done, vote
> on it as a group and open the full interactive 3D view in your browser with
> one tap. No sign-up, no wallet, nothing to buy: just the group, a prompt,
> and a model everyone made together.

**Category:** Creativity / Social

**Age rating:** Discord's standard Activity rating applies; no user-generated
content beyond the text prompt and the resulting 3D model is stored outside
the room's own event log, and prompts flow through the same content
validation the public Forge studio already uses.

## Verification packet

- Source: this repository, `pages/discord-activity.html`,
  `src/discord-activity/`, `api/gateway/discord-activity-*`,
  `api/_lib/gateway/discord-activity-*`.
- OAuth2 code-exchange wiring proven live: a POST to Discord's real
  `https://discord.com/api/oauth2/token` with a placeholder client id/secret
  and an invalid code returns Discord's own documented `invalid_client`
  error, confirming the exchange path reaches Discord's real API rather than
  a mock (see the Evolve session's closing report for the exact response).
- Local tests: `tests/discord-activity-store.test.js`,
  `tests/discord-activity-auth.test.js` (pglite-backed, no mocks of the
  store's own SQL).
- `npm run check:rules` passes on every touched file.

## Owner steps (not automatable here)

1. Create the Discord application and copy its three credentials (Step 1).
2. Enable Activities, set the root mapping and the `cdn` URL Mapping (Step 2).
3. Add the OAuth2 redirect (Step 3).
4. Set `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_PUBLIC_KEY` on
   Cloud Run with `--update-env-vars` (Step 4).
5. Run `npm run db:migrate` for `20261015050000_discord_activity_rooms.sql`
   (Step 5).
6. Add a test server, open the Activity from two real Discord accounts in a
   voice channel, and capture the two-accounts-same-state screenshots
   (Step 6).
7. Submit the Discovery listing using the copy above (Step 7).
