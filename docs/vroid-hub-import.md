# Import your VRoid Hub avatar

**Page:** [/import/vroid](https://three.ws/import/vroid) · **API:** `GET /api/vroid/models`, `POST /api/vroid/import`, `GET|POST|DELETE /api/auth/vroid/[action]` · **Provider:** [VRoid Hub](https://hub.vroid.com) (developer.vroid.com OAuth2)

Bring a VRM character you made in [VRoid Studio](https://vroid.com/en/studio) and
published to VRoid Hub straight into three.ws, with the creator's license
honored automatically: the picker only ever offers an action (public agent,
export, modify, monetize) the character's own license conditions permit.

## How to use it

1. Open [/import/vroid](https://three.ws/import/vroid) and sign in to
   three.ws if you have not already.
2. **Connect VRoid Hub.** The first visit redirects to VRoid Hub's own OAuth
   screen (PKCE-secured) to authorize three.ws; you are sent back to the
   picker once you approve.
3. The picker lists **your characters** (everything in your VRoid Hub
   account, public or private) and **hearted characters** (anything you
   favorited on the Hub that its creator made downloadable).
4. Each card shows the creator's name, four license badges, and a link to
   what those terms mean. A greyed-out badge is not a bug: it means the
   creator did not grant that permission, and three.ws will not offer it on
   the imported avatar either.
5. Click **Import to three.ws**. The model downloads through your own VRoid
   Hub grant (a license you already hold, not a public scrape), lands in
   your avatar library, and opens directly in the [avatar editor](https://three.ws/avatars)
   with idle and walk animations already playing on the rig.

## What the license badges mean

VRoid Hub lets every creator set eight independent conditions on their
character. three.ws reduces them to four yes/no questions that map onto
what the platform actually lets you do with an avatar:

| Badge | Hub condition | Opens when |
| --- | --- | --- |
| Public agent | `characterization_allowed_user` | set to "everyone" (not just the creator's own account) |
| Export | `redistribution` | set to "allow" |
| Modify | `modification` | set to "allow" |
| Monetize | `personal_commercial_use` / `corporate_commercial_use` | either is set to a permitted commercial value |

Creator credit follows its own rule: unless the creator explicitly marked
`credit` as "unnecessary", three.ws keeps a credit line ("`"<character>" by
<creator>, imported from VRoid Hub.`") visible on every surface the avatar
appears on, including agent profiles and the avatar page.

A license field a creator left at VRoid Hub's own default, or any value this
page does not recognize, always normalizes to the closed/restrictive
reading. An avatar whose permissions cannot be read is never treated as more
open than it is.

## How it works

1. **Connect** (`api/auth/vroid/[action].js`). A PKCE code verifier and a CSRF
   nonce travel together inside one HMAC-signed `state` parameter, the same
   pattern the GitHub social-connect flow uses. The resulting access and
   refresh tokens are AES-GCM encrypted (per-row HKDF-derived key) and
   upserted into the same `social_connections` table every other OAuth
   provider on three.ws uses.
2. **List** (`api/vroid/models.js`). Reads `GET /api/account/character_models`
   (your own models, `publication: "all"`) and `GET /api/hearts`
   (your hearted, downloadable models) from the Hub API, each annotated by
   `api/_lib/vroid/license.js`.
3. **Import** (`api/vroid/import.js`). Mints a `DownloadLicense`
   (`POST /api/download_licenses`), follows its one-time redirect
   (`GET /api/download_licenses/{id}/download`) to the S3-hosted VRM/GLB,
   validates the GLB header, and runs it through
   [glb-canonicalize](../src/glb-canonicalize.js) so the idle/walk clip
   library retargets onto it exactly like any other imported avatar. License
   fields, the computed actions, and the credit line are stored on the
   avatar's `source_meta` so later surfaces (agent creation, export, a
   marketplace listing) can re-check them without another Hub round trip.

## Related

- [/import/rpm](https://three.ws/import/rpm): import any GLB/glTF avatar by URL, no license gate
- [docs/character-studio.md](character-studio.md): what you can do with an avatar once it is in your library
