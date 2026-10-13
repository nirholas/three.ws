# Discord Activity: Forge Room

three.ws ships a [Discord Activity](https://discord.com/developers/docs/activities/overview):
an embedded web app that opens inside a Discord voice channel, visible to
everyone in the call. Ours is a **shared Forge room**: the group writes one
prompt together, watches the same 3D model generate, and votes on it, live,
without leaving Discord.

**On this page:** [How it works](#how-it-works) · [Auth flow](#auth-flow) · [Proxy and CSP](#proxy-and-csp) · [Shared state](#shared-state) · [Purchases](#purchases) · [Owner setup](#owner-setup)

---

## How it works

Open the Activity from a voice channel's Activities launcher and everyone in
the call sees the same room:

1. One person types a prompt. The room shows "`<name>` prompted: ...".
2. The prompt goes straight to the real `/api/forge` generation pipeline
   (the same endpoint [the Forge Studio](/forge) uses) and the room polls it
   to completion.
3. The finished model (preview image + an "Open in 3D" link) posts to
   everyone in the room at once, with a shared like/vote count.
4. An agent reacts in text to what just happened, grounded only in the real
   prompt and vote count (see [Agent reactions](#agent-reactions)).

No account creation, no wallet, no purchase: the room is free to use for
anyone already in the voice channel.

## Auth flow

The Activity never holds a Discord client secret. The flow, per
[Discord's documented OAuth2 flow for Activities](https://discord.com/developers/docs/activities/development-guides/networking):

1. The client calls `discordSdk.commands.authorize({ scope: ['identify'] })`
   and gets back an authorization `code`.
2. The client POSTs that code to `POST /api/gateway/discord-activity-token`,
   which exchanges it for an `access_token` server-side
   (`api/_lib/gateway/discord-activity-auth.js`, `exchangeActivityCode`).
3. The client calls `discordSdk.commands.authenticate({ access_token })` to
   finish authenticating the SDK itself.
4. The client POSTs the access token plus the Activity's `instance_id`,
   `guild_id`, and `channel_id` to `POST /api/gateway/discord-activity-session`,
   which re-verifies the token against Discord's own `/users/@me` (never
   trusting the client's claimed identity), creates or updates the room, and
   mints a short-lived (4 hour) HMAC-signed session token scoped to that one
   room.

Every room API call after that carries `Authorization: Bearer <session token>`
(the SSE stream carries it as `?token=` instead, since the browser's native
`EventSource` cannot set custom headers).

## Proxy and CSP

Everything inside the Activity iframe runs under Discord's `/.proxy/` network
model: same-origin calls (`/api/forge`, `/api/gateway/...`) are proxied
automatically by Discord's root URL mapping, no configuration needed. Any
*other* domain the client fetches, loads an image from, or opens a script
against needs an explicit URL Mapping in the Discord Developer Portal, or
Discord's CSP blocks it.

This app has exactly one such cross-origin dependency: the R2 CDN that serves
Forge preview images and GLBs. The client calls
`patchUrlMappings([{ prefix: 'cdn', target: cdnHost }], { patchFetch: true, patchXhr: true, patchSrcAttributes: true })`
once at startup (`src/discord-activity/app.js`), which transparently rewrites
any request to that host through Discord's proxy. The matching Developer
Portal mapping is listed in
[`marketing/growth/submissions/discord-activity.md`](https://github.com/nirholas/three.ws/blob/main/marketing/growth/submissions/discord-activity.md).

Deliberately kept out of the iframe: a full WebGL `<model-viewer>`. This
codebase only ever loads `<model-viewer>` from an external CDN script tag, and
that would mean a second URL Mapping plus a `script-src` CSP exception for a
cramped voice-channel panel. The room instead shows the 2D preview image and
an `openExternalLink` button to the model's real `/forge/share/:id` page,
which opens full 3D in the user's normal browser.

## Shared state

One room per Discord Activity `instance_id` (one room per voice-channel
session). State lives server-side as an append-only event log
(`discord_activity_events`, migration
`api/_lib/migrations/20261015050000_discord_activity_rooms.sql`), folded into
one snapshot (`getRoomSnapshot` in `api/_lib/gateway/discord-activity-store.js`)
that both a fresh `GET` and a reconnecting `EventSource` agree on. Voting
reuses the platform's real `forge_votes` table (`castVote`/`removeVote` in
`api/_lib/forge-store.js`), so a room's vote count is the same tally the
public Forge gallery shows, not a separate throwaway count.

## Purchases

None. This Activity does not sell anything, so it registers no SKUs and never
calls `discordSdk.commands.startPurchase`. If a paid room tier is added later,
it goes through Discord's own IAP flow (SKUs configured in the Developer
Portal, `startPurchase` client-side) rather than our own payment rails, since
Discord requires Activity purchases to go through its own commerce API.

## Owner setup

The Activity needs a registered Discord application before any of this runs
live. Exact Developer Portal settings, the URL Mapping list, and the
Discovery listing copy are written out in
[`marketing/growth/submissions/discord-activity.md`](https://github.com/nirholas/three.ws/blob/main/marketing/growth/submissions/discord-activity.md).
Owner action is tracked in `prompts/finish/_context/production-100-OWNER-ACTIONS.md`.
