# VRoid Hub app approval

Program: pixiv VRoid Hub developer application, then the approval request that publishes the app at <https://hub.vroid.com/apps>.
Full build record, registration steps, redirect URI, env vars and verification packet: [../vroid-hub-app.md](../vroid-hub-app.md) (order 092). This file adds the approval layer only.
Page last read: 2026-10-23, through search results quoting `developer.vroid.com/en/api/recognize.html` (the site itself returned 403 to a direct fetch). The Approval request page and its field list were **not verified on 2026-10-23**.
Tracker: no dedicated row in `opportunities.csv`; prospect score 13 in `docs/partners/prospects.md`.
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What the documentation says

- An app published at `hub.vroid.com/apps` is approved. Any other is unapproved.
- Approval requires inspection by the VRoid Team. Send the required information through the Approval request page; the team replies within a week and, if approved, publishes the app on VRoid Hub.
- Unapproved apps show end users a warning, can load only a limited set of models, and face a per-application API rate limit.
- Review criteria are not published. The VRoid developer Discord is the route for questions.

## Deadline and eligibility

No deadline. Eligibility is "a VRoid Hub developer account that registered an OAuth application". Registration needs a pixiv account and acceptance of the Terms of Use and Privacy Policy.

## Drafted approval-request content (fields unverified, so organized by what a reviewer needs)

| Item | Draft answer |
|---|---|
| App name | three.ws |
| Redirect URI | `https://three.ws/api/auth/vroid/callback` |
| Scope | `default` only. It is the only scope the account and hearts endpoints need |
| API version | `X-Api-Version: 11` |
| What the app does | Lets a signed-in three.ws user import their own VRoid Hub models, and models they have hearted, as 3D avatars they can animate, embed and edit. Import goes through the documented download-license flow (`POST /api/download_licenses`, then the download redirect). |
| License handling | Reads each model's `CharacterModelLicenseSerializer` fields (characterization allowed user, redistribution, modification, personal and corporate commercial use, credit, content ratings). Maps them to four actions (public agent, export, modify, monetize), defaults closed, stores the credit line, and shows a per-model badge before import. |
| Security | PKCE enforced (the authorize endpoint rejects requests without `code_challenge`), HMAC-signed state with CSRF nonce, tokens AES-GCM encrypted at rest with transparent refresh. |
| Data retention | Tokens in `social_connections`; the imported GLB, its license record and the credit line on the avatar. Disconnect deletes the token. |
| Public URL | `https://three.ws/import/vroid`, docs `docs/vroid-hub-import.md` |
| Screenshots needed | The picker with license badges, the post-import editor with the credit line (the verification packet in the linked file lists them; they must be captured against a real account) |
| Contact | `support@three.ws` |

## Owner steps

1. Register the application at <https://hub.vroid.com/oauth/applications> (Step 1 of the linked file) and set the Cloud Run env vars and migration (Step 3).
2. Run a real import and capture the screenshots (Step 4).
3. Open the Approval request page from developer.vroid.com, paste the table above, and update this file with the actual fields.
4. Log the outcome. When approved, link the `hub.vroid.com/apps` entry from `docs/vroid-hub-import.md`.
