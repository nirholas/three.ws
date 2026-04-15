---
mode: agent
description: "First-run onboarding tour — connect wallet → take selfie → meet your agent"
---

# Stack Layer 2 (support): First-Run Onboarding

## Problem

New users landing on 3dagent.vercel.app see a viewer with no clear path to the magic moment. Need a guided first-run: connect wallet → take selfie → meet your agent → what next.

## Implementation

### Router

On `/` (home), if `!session`, show a landing with a big "Create your agent" CTA → routes to `/welcome/`.

### /welcome/ flow

Three-step wizard (server-side state: `users.onboarding_step`):

1. **Step 1: Connect** — "Your agent lives on-chain. Start by connecting a wallet or signing up with email."
   - Both auth paths.
   - On success, advance to step 2.
2. **Step 2: Take a selfie** — "This becomes your agent's body. We use your photo to generate a rigged 3D avatar."
   - Launches the flow from stack-05.
   - While generating, show "While we work, here's what your agent can do..." with 3 cards (skills, memory, embed).
3. **Step 3: Meet your agent** — "Here's [name]. Say hi?"
   - Live viewer with the new avatar.
   - Big "Try a skill" button, "Edit your agent" button, "Share your agent" button.
   - First action (e.g., greet) fires automatically — the avatar's first action is to greet its owner.

### Skip / later

Each step has "Skip for now" → marks step as skipped in `users.onboarding_step`. User can resume from `/welcome/`.

### Empty-state avatar

If user skips the selfie step, assign a default placeholder avatar (a specific preset, e.g., the "Shiba" preset). They can replace later.

### Persistence

`users.onboarding_completed_at` set after step 3. `/` routes through `/welcome/` only if this is null.

### Analytics

Fire `onboarding.step.reached` / `onboarding.step.completed` / `onboarding.skipped` events.

## Validation

- New signup → lands on `/welcome/` step 1.
- Completes all 3 → lands on `/dashboard/` with their agent visible.
- Skip step 2 → default avatar assigned, flow continues.
- Returning incomplete user → resumes on their current step.
- `onboarding_completed_at` set → `/welcome/` redirects to `/dashboard/`.
- `npm run build` passes.

## Do not do this

- Do NOT gate the viewer behind onboarding — the viewer without login should still work for anonymous users loading models.
- Do NOT make the user wait idle during avatar generation — the fun-facts-and-skills panel fills that gap.
