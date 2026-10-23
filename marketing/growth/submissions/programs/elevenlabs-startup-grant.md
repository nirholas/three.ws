# ElevenLabs Startup Grant (and Commercial Partner Program)

Program: ElevenLabs Startup Grants (33,000,000 characters over 12 months, "$5,500+ in value"), plus the separate Commercial Partner Program.
Page last read: 2026-10-23 (<https://elevenlabs.io/startup-grants> read in full; <https://elevenlabs.io/grants-application> read, which shows only an "Apply now" heading and a sign-up button; <https://elevenlabs.io/partner-application> read).
The complete, source-verified application sheet already exists: [../../applications/elevenlabs-startup-grants.md](../../applications/elevenlabs-startup-grants.md) (verified 2026-09-17). Its answers are the ones to paste. This file records what changed on 2026-10-23 and the figures to correct before pasting.
Tracker row: "ElevenLabs Startup Grants and Demo Day" in `opportunities.csv` (target date 2026-09-24, now overdue).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## Deadline

Rolling; ElevenLabs says to expect an answer within one week. The "Startup Grants Virtual Demo Day" on 2026-10-21 has passed, so do not mention Demo Day 2026.

## Eligibility re-read today

| Criterion | Status |
|---|---|
| Fewer than 25 employees at application time | Owner confirms (not in the repo) |
| Business or monetization strategy | Met: the platform lane is priced at USD 0.30 per 1,000 characters and USD 0.50 per clone |
| Long-term product, not a one-off | Met |
| Valid business email | Use a three.ws address |
| No projects for children aged 18 or under | **Disclosure issue stands.** Our Terms say users must be at least 13. Do not claim adults-only. The owner decides whether to age-gate the voice features before applying |
| One application per company; no agencies, consultancies or SMBs | Product company; no prior application recorded |
| Existing enterprise customers excluded; paying self-serve customers allowed | None recorded |
| No NDAs signed for grants; characters cannot be resold or cashed out | Acknowledged |

## Corrections to the 2026-09-17 sheet before pasting

- The traction paragraph there quotes 75,959 avatars, 3,831 agents and 23,444 generations from the platform stats endpoint. Those include seeded and machine-created rows. Replace them with the people-only figures from the October proof brief: 727 agents by 415 owners (725 with a 3D body), 703 avatars, 7,111 finished 3D models in 31 days, 412 signups. Rerun `npm run partners:proof` the day of submission.
- The sheet's "632 widgets embedded on other sites" conflicts with the proof brief ("Embeds: weak": 18 widgets created, 173 views, all but one on three.ws). Drop that claim.
- The platform lane still has no ElevenLabs key on `three-ws-api` as of the 2026-09-17 check; re-run `node scripts/read-service-env.mjs '^ELEVENLABS' --names` on the day and state the result truthfully.

## Application questions

The live form is behind sign-in and lists only "tell us more about the startup you're building, your team, how you expect to grow". Field-level questions: **not verified on 2026-10-23**. Use the answers in the linked sheet for: company one-liner, what you are building, how you use ElevenLabs, business model, growth, team (owner input), anything else.

## Commercial Partner Program (secondary)

The page is for "consultancies, system integrators, and referrers" and requires a signed Commercial Partner Agreement before any referral relationship exists. three.ws is a product company, so it is a poor fit. Skip it unless the owner wants to refer ElevenLabs Enterprise deals. Updated note for `docs/partners/prospects.md`: the row's "then the Commercial Partner Program" step should read "poor fit, not pursued".

## Owner steps

1. Confirm headcount (under 25), decide the under-18 disclosure, pick the business email.
2. Apply at <https://elevenlabs.io/grants-application> with the corrected answers.
3. On award: follow the "After an award" section of the linked sheet. Log the outcome in `opportunities.csv`.
