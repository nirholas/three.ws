# Meta Muse connector submission kit

Everything Meta's Muse Connector Platform asks for when three.ws submits its
MCP server as an "Existing MCP", answered from the code and checked against
production on 2026-11-28. The submission itself is made by the owner inside the
logged-in portal at [platform.muse.ai](https://platform.muse.ai/); Meta's rules
are in [platform.muse.ai/docs](https://platform.muse.ai/docs).

Registry row: `meta-muse-connectors` in [`data/listings.json`](../data/listings.json).

## What we submit, and why this server

We submit the free 3D studio, `https://three.ws/api/mcp-studio?auth=oauth`
([mcp-studio.md](mcp-studio.md)).

The other hosted servers are not a fit. Muse guideline 4.6 excludes financial
money movement and trading tools, and the main `/api/mcp` server carries wallet,
payment and launch tools. The studio carries none: it makes, rigs and inspects
3D models and agent personas, and every model it saves is unlisted on the
user's own account.

## Form answers

**Connector name:** three.ws 3D Studio

**MCP URL:** `https://three.ws/api/mcp-studio?auth=oauth`

**Documentation URL:** `https://three.ws/docs/mcp-studio`

**Privacy policy:** `https://three.ws/legal/privacy` (section 10 covers MCP
connectors). **Terms:** `https://three.ws/legal/tos`. **Support:**
`https://three.ws/support`. **Security contact:** `security@three.ws`
([security.txt](https://three.ws/.well-known/security.txt)). **Trust center:**
`https://three.ws/trust`.

**What the connector does (overview):**

> three.ws 3D Studio turns a conversation into real 3D assets. Describe an
> object and it generates a textured GLB model; describe a character and it
> builds a rigged, animation-ready avatar; hand it a mesh and it adds a
> skeleton or refines it. It searches a catalog of thousands of ready-made CC0
> models, rigged characters and motion clips, renders any model from several
> angles so the assistant can check its own work, and can give an avatar a
> persona that speaks in character. Every model is saved, unlisted, to the
> signed-in user's free three.ws account.

**Value beyond the browser (guideline 1.2):** the assistant runs the whole
pipeline in one conversation: find or generate a model, look at the render,
refine it, rig it, and give it a persona, without the user moving files between
tools. `look_at_model` returns real renders the assistant can reason about, so
it can catch a bad result and retry before the user sees it.

### Example prompts

1. "Make a 3D model of a brass ship's telescope on a wooden tripod."
2. "Create a rigged cartoon astronaut avatar I can animate."
3. "Search the three.ws catalog for a low-poly oak tree and show me the best
   match."
4. "Make a stone knight statue standing in a T-pose, then rig it so I can
   animate it."
5. "Look at https://three.ws/avatars/mannequin.glb from the front and side
   and describe its proportions."
6. "Give my astronaut a cheerful mission-control persona and have it introduce
   itself."

### Tool classification (guideline 3.2, annotations per 5.6)

Meta counts a tool that both reads and writes as a Write. No tool is a
Sensitive write: nothing spends money, sends a message, publishes publicly or
deletes data.

Read (no side effects):

- `search_catalog`, `get_catalog_item`, `get_item_source`: catalog search and
  item details.
- `search_docs`: three.ws documentation search.
- `get_job`, `get_agent_persona`: read a job or a saved persona.
- `look_at_model`: renders a model from fixed angles.
- `pano_capture_status`, `pano_capture_list`, `pano_scene_status`: read 3D
  capture state.

Write (creates or saves something on the user's own account, unlisted):

- `forge_free`, `text_to_avatar`, `mesh_forge`, `forge_avatar`: generate a
  model or avatar.
- `rig_mesh`, `refine_model`: rig or refine a model and save the result.
- `create_agent_persona`, `persona_say`: save a persona, and advance its
  conversation (turn count).
- `pano_capture_start`, `pano_scene_create`: start a capture or build a scene.
- `check_job`: reads job status, and can save a finished model or restart a
  failed job, so it counts as a Write.

### Read-only option (guideline 3.1)

The three.ws consent screen shows two grant groups. "Read your avatars and
profile" is required; "Create and update avatars" (`avatars:write`) can be
unticked. A read-only grant is enforced on the server: every Read tool works,
and every Write tool returns `insufficient_scope` with an
`error="insufficient_scope"` challenge for `avatars:write`, without generating
or billing anything. Code: `writeScopeMissing` in
[`api/_mcp/creator-gate.js`](../api/_mcp/creator-gate.js); test:
[`tests/mcp-studio-oauth-write-scope.test.js`](../tests/mcp-studio-oauth-write-scope.test.js).

### OAuth details

- OAuth 2.1 authorization code flow with PKCE (S256 required).
- Dynamic client registration: `https://three.ws/api/oauth/register`.
- Authorization server metadata:
  `https://three.ws/.well-known/oauth-authorization-server`.
- Protected resource metadata (RFC 9728):
  `https://three.ws/.well-known/oauth-protected-resource/api/mcp-studio`,
  scopes `avatars:read`, `avatars:write`, `profile`, `offline_access`.
- Access tokens last 3600 seconds (`expires_in: 3600`), which meets Muse's
  one-hour minimum. Refresh tokens rotate on every use.
- Tokens are bound to the studio resource (RFC 8707) and can be revoked at
  `/api/oauth/revoke`; the user can revoke any connected app from
  [Settings, Connected apps](https://three.ws/dashboard/settings#connected-apps).

### Data processing questionnaire (guidelines 4.2, 5.3)

**Data the connector touches:** the account id, email and display name
(`profile` scope); the prompts, reference image URLs and model URLs the user
sends to a tool; the models, jobs and personas the tools create; and usage
records of each tool call (tool name, status, latency).

**Purpose:** only to run the tool the user asked for and to meter the free
tier. No sale, no advertising, no model training on user content (privacy
policy section 10).

**Storage and retention:** data is processed and stored in the United States.
Generated models are saved unlisted to the user's account until they or the
account are deleted. Usage events stay 60 days in the live database, then move
to a private archive in us-central1; an expiry rule that matches the privacy
policy's 90-day window is being added to that archive (tracked on the trust
center). Third parties that
process data are listed at
[three.ws/trust/subprocessors](https://three.ws/trust/subprocessors).

**How a user deletes it:**

1. Disconnect: remove the connector in Muse, and revoke it under Settings,
   Connected apps on three.ws, which ends access and revokes its refresh
   tokens.
2. Delete everything: email `privacy@three.ws` from the account's address. The
   account is soft-deleted for 30 days, then its files and rows are purged by
   the daily `purge-deleted-accounts` job (financial records are kept without
   identifying details).

**Incident notice (guideline 4.8):** a security incident affecting Muse users
is reported to `vendor-incident@meta.com` within 48 hours, alongside the
disclosure process at [three.ws/trust](https://three.ws/trust#disclosure).

### Security measures: tick only these

Each is in place and verifiable today:

- TLS everywhere with HSTS preload (`max-age=63072000; includeSubDomains;
  preload`).
- OAuth 2.1 with mandatory PKCE, refresh token rotation and token revocation.
- Sessions, refresh tokens and API keys stored as hashes.
- Per-user data isolation: every tool reads and writes only the signed-in
  user's records.
- Opt-in two-step verification (authenticator app and recovery codes) on every
  sign-in path.
- Daily off-provider database backups to an immutable bucket, restore-tested on
  every run.
- Vulnerability disclosure: RFC 9116 security.txt and a monitored security
  contact.
- Public status page and enforced, tested retention jobs.
- Open source (Apache 2.0), so every control can be read in the code.

Do not tick: SOC 2, ISO 27001, a third-party penetration test, signed written
security policies, or data residency outside the US. None is held today (see
the compliance table at [three.ws/trust](https://three.ws/trust)).

## Owner steps to submit

1. Sign in at [platform.muse.ai](https://platform.muse.ai/), choose "Submit a
   connector", then "Existing MCP", and complete Meta's business verification.
2. Create the reviewer test account: register a fresh account at
   `https://three.ws/register` with a mailbox you control (not the internal QA
   login), confirm it signs in, and enter its email and password only in Meta's
   form. The free tier covers every studio tool, so the account needs no
   funding.
3. Paste the answers above into the form.
4. Copy the challenge token (and the file name, if Meta gives one) from the
   verification step and set it on production. This is a config-only change:

   ```bash
   gcloud run services update three-ws-api --region us-central1 \
     --update-env-vars MUSE_CHALLENGE_TOKEN=<token>,MUSE_CHALLENGE_FILE=<file name>
   ```

   Leave out `MUSE_CHALLENGE_FILE` if Meta does not name a file. Then confirm
   the verifier will see the token:

   ```bash
   curl -i https://three.ws/.well-known/muse-challenge/<file name>
   ```

   It should answer `200`, `text/plain`, with the token as the whole body.
   Until the token is set, the path answers an honest `404`. Code:
   [`api/_lib/muse-challenge.js`](../api/_lib/muse-challenge.js), served by
   `api/wk.js`; test: [`tests/muse-challenge.test.js`](../tests/muse-challenge.test.js).
5. Run Meta's sign-in test, then submit. Review runs in three stages (risk
   assessment, tool review, end-to-end QA), and status shows only in the portal
   (guideline 5.7), so check there rather than waiting for email.
6. Update the `meta-muse-connectors` row in `data/listings.json` to `pending`
   and run `npm run listings:build`.

## Reviewer-facing behavior we fixed for this submission

- A malformed JSON body sent to any MCP endpoint now gets a JSON-RPC `-32700`
  parse error instead of a REST `bad_request` body that no MCP client can read
  ([`server/body-parse-errors.mjs`](../server/body-parse-errors.mjs)).
- A read-only OAuth grant now limits the studio to its Read tools, as described
  above.
