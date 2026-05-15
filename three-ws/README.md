# three.ws

A real Next.js 15 SaaS. A creature lives in the user's camera, walks around via on-screen joystick, scales with depth. Free tier with 1 creature + watermarked photo capture; Pro tier ($9/mo by default) unlocks 4 creatures, video recording, no watermark, 4K capture.

The code is real. The infrastructure (Stripe account, DB, OAuth credentials, deployment) is yours to bring.

## Stack

- **Next.js 15** App Router + Server Components
- **TypeScript** strict mode
- **NextAuth v5** with Prisma adapter — Google OAuth + Resend magic-link email
- **Prisma** + **Postgres** (Neon / Supabase / Railway — any Postgres)
- **Stripe** subscriptions with signature-verified webhook
- **Tailwind CSS**

## What you need to provide

Before this runs, you need accounts and credentials for:

1. **Postgres database.** [Neon](https://neon.tech) free tier is fine. Get the connection string.
2. **Stripe account** at [stripe.com](https://stripe.com).
   - Get test API keys from Dashboard → Developers → API keys.
   - Create a recurring Price in Dashboard → Products → Add product. Copy the `price_...` ID.
3. **Google OAuth** at [console.cloud.google.com](https://console.cloud.google.com).
   - APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web).
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (and your prod URL).
4. **Resend** at [resend.com](https://resend.com) for magic-link email. Get an API key.
5. **Stripe CLI** for local webhook testing: [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli).

## Setup

```bash
# 1. Install
pnpm install   # or: npm install / yarn

# 2. Configure env
cp .env.example .env
# Fill in every value. Generate AUTH_SECRET with: openssl rand -base64 32

# 3. Push the schema to your Postgres
pnpm db:push

# 4. In one terminal, forward Stripe webhooks to your local server.
# This prints a whsec_... secret — paste it into .env as STRIPE_WEBHOOK_SECRET.
pnpm stripe:listen

# 5. In another terminal, run the app
pnpm dev
```

Open `http://localhost:3000`. Log in. Click START PLAYING. Allow camera access in the browser prompt. Walk your creature around.

To test payments, use Stripe test card `4242 4242 4242 4242` with any future expiry and any CVC.

## Production deployment

### Vercel (recommended)

```bash
vercel
```

In the Vercel dashboard, add all env vars from `.env.example`. Update these for production:

- `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` → your real domain
- `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → live keys, NOT test keys
- `STRIPE_PRO_PRICE_ID` → the live mode price ID (separate from test mode)

### Stripe webhook for production

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://yourdomain.com/api/stripe/webhook`
3. Listen to these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in Vercel env.

### Google OAuth for production

Add `https://yourdomain.com/api/auth/callback/google` to Authorized redirect URIs in the Google Cloud console.

## Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts   NextAuth handlers
│   │   ├── stripe/checkout/route.ts      Creates a Stripe Checkout session
│   │   ├── stripe/portal/route.ts        Opens Stripe billing portal
│   │   ├── stripe/webhook/route.ts       Verifies signature, syncs subscription state
│   │   └── user/route.ts                 Returns current plan
│   ├── account/page.tsx                  Plan status, manage billing, sign out
│   ├── login/page.tsx                    Google + magic link
│   ├── play/page.tsx                     The AR experience (auth-gated)
│   ├── pricing/page.tsx                  Tiers + checkout button
│   ├── page.tsx                          Landing
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ManageBillingButton.tsx
│   └── ar/
│       ├── ARStage.tsx                   Main orchestrator: camera + joystick + avatar + capture
│       ├── CameraFeed.tsx                getUserMedia, facing switch, error handling
│       ├── Joystick.tsx                  Pointer-driven joystick UI
│       ├── useJoystick.ts                Joystick input hook (pointer + keyboard)
│       ├── Avatar.tsx                    Side-view SVG creature (4 palette variants)
│       ├── AvatarSelector.tsx            Tier-gated character picker
│       ├── HUD.tsx                       Top status bar
│       └── PaywallModal.tsx              Triggered when free user taps locked feature
├── lib/
│   ├── auth.ts                           NextAuth config
│   ├── db.ts                             Prisma client singleton
│   ├── stripe.ts                         Stripe SDK
│   ├── plans.ts                          Plan/entitlement definitions
│   ├── subscription.ts                   Resolves user's effective plan from DB
│   └── cn.ts                             Class merging utility
└── types/
    └── next-auth.d.ts                    Session.user.id type augmentation
```

## How gating works

`src/lib/plans.ts` is the single source of truth for what each tier includes. `getUserPlan(userId)` reads the user's `Subscription` row (kept fresh by the Stripe webhook) and returns the active entitlements. Both server pages and client components consult this:

- `src/app/play/page.tsx` (server) passes entitlements into `ARStage`
- `ARStage` (client) consults entitlements when the user taps a locked avatar or tries to capture a photo
- The watermark logic in `capturePhoto` checks `entitlements.watermark` and burns text into the canvas before download

There is no client-side trust: even if a free user bypassed the UI, the entitlements come from a server fetch tied to their authenticated session.

## Camera access in deployed environments

`getUserMedia` requires HTTPS (except on `localhost`). When deployed to your real domain it works on iOS Safari, Android Chrome, and desktop browsers. The user must grant camera permission via the native browser prompt.

## What's not included (intentionally)

These are common scope-creep additions that aren't shipped here. They're easy to add when you actually need them:

- Email transactional flow beyond magic-link sign-in
- User-uploaded custom avatars (requires file storage like S3/R2)
- Analytics (PostHog or Plausible — add to `layout.tsx`)
- Admin dashboard
- Internationalization

## Security notes

- Webhook signature verification uses `stripe.webhooks.constructEvent` and the raw request body — never bypass this.
- `Permissions-Policy` header in `next.config.mjs` restricts camera access to same-origin.
- All API routes that mutate state check the session.
- The Stripe customer ID and subscription state are stored server-side; the client never sees Stripe secrets.

## License

MIT. Build a business on it.
