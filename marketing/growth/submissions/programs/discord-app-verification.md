# Discord app verification and Activity Discovery

Program: Discord Developer Portal app verification, then Activity Discovery listing for the Forge Room Activity.
Full build record, Developer Portal setup, URL mappings, env vars and the verification packet: [../discord-activity.md](../discord-activity.md) (order 088). This file adds the application-form layer only and does not repeat that setup.
Page last read: 2026-10-23. The Discovery doc moved: `https://discord.com/developers/docs/activities/discovery` now answers 301 to `https://docs.discord.com/developers/activities/discovery`, and the new URL returned 404 when fetched. **Discovery criteria and thresholds: not verified on 2026-10-23.** The existing submission file cites the old URL; update it after the owner reads the live page.
Tracker: no dedicated row in `opportunities.csv` (the Discord Activities prospect is in `docs/partners/prospects.md`, F-R-A score 14).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## Deadline and eligibility

- No deadline known. Per `docs/partners/prospects.md` (read 2026-10-09): verify the app and team, meet the Discovery criteria, and listing follows within 24 hours of verification (a vendor-page claim, not re-read today).
- Verification normally asks for a verified team and may have server-count conditions for gated features. Not verified on 2026-10-23; read the live Developer Portal "Verification" panel before relying on any number.
- Blocker to date: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_PUBLIC_KEY` are unset in production (checked by the build order). The Activity cannot be submitted until Steps 1 to 6 of the linked file are done in a real Discord client.

## Listing fields and drafted answers

| Field | Draft answer |
|---|---|
| Name | Forge Room (fallback: `three.ws Forge Room` if the name is taken) |
| Tagline | Prompt, generate, and vote on a 3D model together, live in your voice channel. |
| Description | Forge Room turns your voice channel into a tiny shared 3D studio. Anyone in the call can type a prompt, and everyone watches the same model generate in real time, powered by the free three.ws Forge pipeline. When it is done, vote on it as a group and open the full interactive 3D view in your browser with one tap. No sign-up, no wallet, nothing to buy. |
| Category | Creativity / Social |
| Platforms | Desktop and mobile |
| Monetization | None. Free, no in-app purchases |
| Permissions and scopes | Authorization-code grant through the Embedded App SDK `authorize()` call; user identity read for the room roster. Exact scope list: see the linked file's Step 3 |
| Privacy policy URL | `https://three.ws/legal/privacy` (`public/legal/privacy.html`) |
| Terms of Service URL | `https://three.ws/legal/tos` |
| Support | `support@three.ws` |
| Data stored | The room's own event log (prompts, generated model references, votes). No payment or message-content data |
| Team and verification | Owner input: Discord team, owner identity verification, business information |

## Owner steps

1. Do Steps 1 to 6 in [../discord-activity.md](../discord-activity.md) (create the app, enable Activities, set the `cdn` URL mapping, env vars, migration, test in a real client from two accounts).
2. Read the live Discovery and verification pages on `docs.discord.com`, then correct this file's "not verified" line and the stale URL in the linked file.
3. Submit verification, then the Discovery listing using the table above.
4. Log the outcome in `opportunities.csv` (add a row if none exists) and, once listed, add the App Directory URL to `docs/discord-activity.md`.
