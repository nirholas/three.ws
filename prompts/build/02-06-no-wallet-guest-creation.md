# 02-06 — Guest selfie → agent, claim later with wallet

**Pillar 2 — Selfie → agent.**

## Why it matters

Asking users to sign in before they see their 3D self is backwards. The magic moment should come first, then the "save your agent" prompt should drive sign-up. Today, `/dashboard/avatars/new` requires auth.

Without this, most first-touch users bounce before they ever see themselves in 3D. We need a guest flow that keeps the magic up-front and converts via wallet sign-in *after* they're hooked.

## What to build

A guest creation flow at `/try` (or `/create`, pick shorter) that:

1. Anonymous user lands, sees a 10-second pitch + [Try it with my face] CTA.
2. Selfie capture → generation — fully client-side progress.
3. When the avatar is ready, it renders on screen with one big button: **Claim this agent** → triggers SIWE.
4. After sign-in, the guest-created avatar + agent row is reassigned to the now-authenticated user atomically.
5. A 24-hour guest-session token (not our `__Host-sid`) scopes the unclaimed avatar so no one else can claim it.

## Read these first

| File | Why |
|:---|:---|
| [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) | SIWE flow. The claim step reuses this + a follow-up handoff. |
| [api/avatars/index.js](../../api/avatars/index.js) | Avatar create flow — will need a guest mode that stamps a guest user placeholder. |
| [api/_lib/auth.js](../../api/_lib/auth.js) | Session helpers. |
| Backend from 02-02 / 02-03 | Generation pipeline — needs to accept guest-session token. |
| [api/agents.js](../../api/agents.js) | Agent auto-create on `GET /api/agents/me`. |

## Build this

### 1. Guest session

New endpoint `POST /api/guest/start` — no auth. Mints a short token (JWT, 24h TTL) tied to a freshly-created `guests` row:

```sql
create table if not exists guests (
  id text primary key,
  token_hash text not null,
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  claimed_user_id text references users(id),
  claimed_at timestamptz
);
```

Returns `{ guest_token }`. Client stores in `sessionStorage` (not localStorage — tied to tab).

### 2. Guest-scoped APIs

Extend `api/avatars/presign.js` and `api/avatars/index.js` to accept `Authorization: Bearer guest:<token>` as an alternative to session. A guest can upload ONE selfie and create ONE avatar. Record `guest_id` on the avatar row so the claim step can find it.

Same for `POST /api/selfies/*` if 02-02 added one.

### 3. Generation on guest path

Fire the generator with guest_token. On completion, the avatar row exists but has `owner_id = null` and `guest_id = <id>`.

### 4. Agent auto-create for guest

Skip on the guest path — we don't create an agent until the user claims. Just cache the generated GLB URL in memory.

### 5. Claim flow

Button on the result page: **Claim this agent**. Runs SIWE (or email sign-up). After `verify` returns 200, call `POST /api/guest/claim` with:
- `Authorization: Bearer guest:<token>`
- Cookie: the brand-new `__Host-sid`

Server atomically:
1. Looks up `guest_id` by token hash.
2. Confirms `claimed_user_id IS NULL`.
3. Transfers the avatar row: `update avatars set owner_id = <user>, guest_id = null where guest_id = <guest>`.
4. Creates an `agent_identities` row for the user (if they don't already have one) and sets `avatar_id`.
5. Marks guest `claimed_user_id = <user>, claimed_at = now()`.
6. Returns `{ user, agent }`.

Race-free via `SELECT … FOR UPDATE` inside a transaction.

### 6. Cleanup

A cron-friendly (or Vercel cron) endpoint `POST /api/guest/reap` that deletes unclaimed guest avatars + R2 objects older than 24h. Auth by `Authorization: Bearer <env CRON_SECRET>`.

## Out of scope

- Do not give guests access to any other avatars / agents. One guest = one avatar.
- Do not support guest sharing / embeds. The unclaimed avatar is not publicly routable.
- Do not build an account merge flow (existing users with avatars can't absorb a guest avatar from the same device).
- Do not persist guest rows beyond the TTL unless claimed.

## Deliverables

**New:**
- `api/guest/start.js`
- `api/guest/claim.js`
- `api/guest/reap.js`
- `public/try/index.html`, `public/try/try.js`
- Migration: `guests` table + `avatars.guest_id` column (ask before running).

**Modified:**
- `api/avatars/presign.js` + `api/avatars/index.js` — accept guest bearer.
- `vercel.json` — `/try` route, guest endpoints, cron entry for `/api/guest/reap`.

## Acceptance

- [ ] `/try` works in incognito. Guest flow completes without auth prompt until the claim button.
- [ ] Claim → SIWE → lands on `/dashboard/` with the just-created avatar already in the list.
- [ ] Attempting to claim twice → 409.
- [ ] Expired guest tokens get reaped; R2 object is deleted.
- [ ] Network trace shows zero `/api/auth/*` calls before the claim step.
- [ ] `npm run build` passes.

## Test plan

1. Open `/try` in incognito. Hit button. Capture selfie. Wait for generation. See the avatar.
2. Click claim → SIWE → dashboard shows the avatar under the new user.
3. In a second incognito window, start a guest flow, complete capture, but don't claim. Wait 24h (or call reap with `CRON_SECRET` + set `expires_at` to past via a dev tool) → avatar + selfie + guest row gone.
4. Try to POST another avatar with the same guest token → 409 `guest_quota_exceeded`.
