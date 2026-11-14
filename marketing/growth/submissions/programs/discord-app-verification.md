# Discord app verification and Activity Discovery

Program: Discord Developer Portal app verification, then Activity Discovery listing for the Forge Room Activity.
Full build record, Developer Portal setup, URL mappings, env vars and the verification packet: [../discord-activity.md](../discord-activity.md) (order 088). This file adds the application-form layer only and does not repeat that setup.
Page last read: 2026-11-14. `https://docs.discord.com/developers/activities/discovery` still returns 404, and Discord's developer help center article "What are Verified and Unverified Activities?" (<https://support-dev.discord.com/hc/en-us/articles/26576097154199>) answered HTTP 403 to a direct fetch, so the facts below come from search results quoting that article and the App Directory articles on the same help center. The existing submission file cites the old URL.
Tracker row: "Discord Activity" in `opportunities.csv` (the Discord Activities prospect is in `docs/partners/prospects.md`, F-R-A score 14).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## Deadline and eligibility

- No deadline.
- **Unverified Activities** are visible only to the developer, the team and app testers, are not discoverable, and are limited to servers with fewer than 25 members.
- **Verified Activities** are visible to everyone with no server member limit, playable in any server, may enable discovery, and may monetize if Premium App requirements are met. "Verification is necessary to enable discovery and monetization features for your Activity."
- After verification a "Discovery" section appears in the Developer Portal. Fill in "Discovery Settings" first; tags: at least 1 and up to 5 are required for App Directory eligibility. The "Enable Discovery" button on the Discovery Status tab stays disabled until the checklist is met; the product page can be previewed before that.
- Discovery surfaces once enabled: the App Directory and the App Launcher (the article names three surfaces; the third was not visible in the quoted text).
- The verification form's own fields (team, identity, business details) sit inside the Developer Portal: **not verified on 2026-11-14**.
- Blocker to date: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_PUBLIC_KEY` are unset in production (rechecked 2026-11-14 on `three-ws-api`). The Activity cannot be submitted until Steps 1 to 6 of the linked file are done in a real Discord client.

## Listing fields and drafted answers

| Field | Draft answer |
|---|---|
| Name | Forge Room (fallback: `three.ws Forge Room` if the name is taken) |
| Tagline | Prompt, generate, and vote on a 3D model together, live in your voice channel. |
| Description | Forge Room turns your voice channel into a tiny shared 3D studio. Anyone in the call can type a prompt, and everyone watches the same model generate in real time, powered by the free three.ws Forge pipeline. When it is done, vote on it as a group and open the full interactive 3D view in your browser with one tap. No sign-up, no wallet, nothing to buy. |
| Category | Creativity / Social |
| Tags (1 to 5, at least 1 required) | 3D, Creative, AI, Social, Party |
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
2. Submit verification from the Developer Portal, then fill "Discovery Settings" (with at least one tag) using the table above and press "Enable Discovery" once the checklist allows it.
3. Record the verification form's actual fields in this file.
4. Log the outcome in `opportunities.csv` (add a row if none exists) and, once listed, add the App Directory URL to `docs/discord-activity.md`.
