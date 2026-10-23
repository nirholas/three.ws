# Avaturn partner or integration inquiry

Program: no dedicated partner program found. Routes: developer portal, the contact form on avaturn.me, Discord, and `hello@in3d.io` (printed in the 2026-10-09 sweep).
Page last read: 2026-10-23, **not verified**. `https://developer.avaturn.me` returned only its title, and search found the docs (`docs.avaturn.me`) and the npm SDK but no partner page or partner terms. A partner program's existence and terms: not verified on 2026-10-23.
Prospect context: score 12 in `docs/partners/prospects.md`. We already ship the integration (`src/avatar-creator.js`, `src/avaturn-client.js`). `@avaturn/sdk` is 728 downloads a week (npm, 2026-10-09). Pricing seen: free tier, PRO USD 800 a month (vendor pricing page, per the sweep).
Nothing has been sent. Shared facts and owner-only inputs: [README.md](./README.md).

## The ask

A case study, a "works with" badge and a joint landing page for people who lost a previous avatar provider. No money changes hands in the ask.

## What we can truthfully show

- Production integration: selfie reconstruction through the Avaturn web SDK is one of the avatar creation paths. Proof brief (31 days to 2026-09-30): 703 avatars created by people, **154 through selfie reconstruction**.
- What happens after Avaturn: the GLB is canonicalized and retargeted onto the universal clip library, so an Avaturn avatar speaks, gestures and walks (`src/glb-canonicalize.js`, `src/animation-retarget.js`).
- Not all 154 are necessarily Avaturn: the proof brief names the bucket "selfie reconstruction" without splitting providers. Do not quote 154 as Avaturn-only unless the owner confirms the split with a query on `avatars.source`.

## Drafted message (contact form or `hello@in3d.io`)

Subject: three.ws x Avaturn: case study and "works with" badge

> Hi Avaturn team. three.ws is an open-source platform for embodied 3D AI agents. Avaturn's web SDK is one of our avatar creation paths: a selfie becomes an avatar, and we then rig-check it, retarget our animation library onto it, give it a voice and a brain, and embed it on any site with one web component. In the 31 days to 30 September 2026, 154 avatars on our platform came from selfie reconstruction. Two asks. First, a short joint case study and a "works with Avaturn" badge for our integrations page. Second, a joint page for people who lost a previous avatar provider and want a new body for their character. We will write the first draft of both. Who is the right person? Contact: support@three.ws.

## Eligibility and fields

No form fields known. The avaturn.me contact form is a general form; its fields were **not verified on 2026-10-23**. Expect name, email, company, message.

## Owner steps

1. Confirm the Avaturn share of the 154 selfie avatars.
2. Send the message through the contact form (or `hello@in3d.io`), record the date in `opportunities.csv` (no Avaturn row exists).
3. On a reply, write the case study draft in `docs/partners/` and wire the badge into the integrations page.
