# Agent Connect: BYOL listing submission pack

Everything needed to list the three.ws 3D Studio MCP server in the **IBM watsonx
Orchestrate Agent Catalog**, filled in and verified. When the `APP_ID` arrives, this is a
transcription job into IBM Concierge, not a drafting job.

**Path: BYOL, not paid.** BYOL skips IBM approval and the tax, banking, and payout
paperwork, and it requires "your own license validation and management system", which our
x402 per-call settlement and OAuth scopes already are. Rationale in
[`docs/partners/ibm-partner-plus.md`](../../docs/partners/ibm-partner-plus.md).

---

## Step 0: the one blocking email

Send to **IBMAgentConnect@ibm.com**. Allow 2 to 3 business days.

> **Subject:** MCP APP_ID Request - three.ws
>
> Company name: three.ws
> MCP server name: three.ws 3d studio
> Submission type: BYOL
>
> Brief description: A remote MCP server that turns text prompts, images, and video into
> textured, rigged, animation-ready 3D models and returns them as inline interactive
> artifacts. Also performs remeshing, retexturing, segmentation, optimisation, and
> automatic rigging on existing models.
>
> We are an existing IBM Business Partner running IBM Granite on watsonx.ai in production.

Save the `APP_ID` from the reply. If it is ever lost, the same address retrieves it given
the server name.

---

## Step 1 and 2: the Concierge fields

### The naming trap, read before typing

Display Name accepts **lowercase `a-z`, digits, space, `/`, `(`, `)`, `.`, `-` only.**
No capitals. "three.ws 3D Studio" fails validation. Use the lowercase form below exactly.

| Field | Value |
| --- | --- |
| License type | **Create BYOL listing** |
| Product type | **MCP Server** |
| Display name | `three.ws 3d studio` |
| Name (programmatic) | auto-derived, read-only |
| Version | `1.0.0` |
| Change log | `Initial catalog listing.` |
| Domain tags (1 to 3) | **Productivity** (primary), **Sales**, **Research** |
| Language support | English |
| Application ID | the `APP_ID` from step 0 |
| Application Name | `three.ws` |
| Application icon | `public/partners/ibm/three-ws-agent-connect-icon.svg` |
| Server endpoint URL | `https://three.ws/api/mcp-3d` |
| Transport | **Streamable HTTP** |
| Authentication schema | **OAuth2** (pre-registered static client, see below) |

Domain tag reasoning: Productivity is the honest primary, since this is creative
production tooling. Sales covers product and storefront visualisation. Research covers
`capture_scene` reconstruction and the model inspection tools.

### Description (paste as-is)

> three.ws 3D Studio turns a sentence, an image, or a video into a textured,
> animation-ready 3D model, and returns it as an interactive artifact inline in the
> conversation rather than as a link to download later.
>
> Generate with text_to_3d or image_to_3d at draft, standard, or high fidelity, and poll
> generation_status until the GLB is ready. Reconstruct a real physical space from a video
> with capture_scene. Add a humanoid skeleton to any model with auto_rig_model, then drive
> it with apply_animation and pose_model from a shared clip library that works across
> Mixamo, VRM, Daz, MakeHuman, Avaturn, and custom Blender rigs without manual retargeting.
>
> Refine existing assets in place: remesh_model, retexture_model, retexture_region,
> stylize_model, segment_model, and generate_material. Analyse and ship them with
> inspect_model, optimize_model, and preview_3d. Persist a result as a durable named asset
> with save_avatar.
>
> Every generated model is a standard GLB that opens in any 3D tool and embeds on any web
> page. Licensing and billing are handled directly by three.ws.

### Authentication: why OAuth2 works with no code change

IBM supports **OAuth2 without Dynamic Client Registration**. Our authorisation server at
`https://three.ws/.well-known/oauth-authorization-server` does advertise a
`registration_endpoint`, but it also supports `client_secret_basic` and
`client_secret_post`, so IBM is issued a **pre-registered static client** and never
exercises DCR. Nothing needs to be built or changed for this listing.

Relevant scopes for the connector, from the published metadata: `avatars:read`,
`avatars:write`, `profile`, `offline_access`.

### Related links

| Link | Required | URL | Verified |
| --- | --- | --- | --- |
| Support | yes | `https://three.ws/support` | 200 |
| Terms and Conditions | yes | `https://three.ws/legal/eula` | 200 |
| Documentation | no | `https://three.ws/docs/mcp-3d-studio` | 200 |

All three checked live on 2026-09-10. The general legal index is `https://three.ws/legal`
(200) if IBM prefers the hub over the EULA directly.

---

## The required use case, for IBM QA

IBM asks for setup documentation plus at least one use case they can test. This is it, and
it exercises generation, rigging, and animation in one pass so a single run proves the
server end to end.

**"Produce a rigged, walking 3D character for a product page from one sentence."**

1. `text_to_3d` with prompt `a friendly robot shop assistant, clean white and orange
   panels, standing pose`, tier `standard`.
2. `generation_status` with the returned `job_id`, polled until it returns a GLB URL and
   an inline `<model-viewer>` artifact.
3. `auto_rig_model` on that GLB URL, which adds a humanoid skeleton.
4. `list_animations` to enumerate the clip library.
5. `apply_animation` with the rigged model and the `walk` clip.
6. `preview_3d` on the result to render it inline.

**Expected outcome:** a downloadable GLB that walks when previewed, produced from a single
sentence with no 3D software and no manual rigging. Typical wall time is a few minutes,
dominated by step 1.

---

## QA credentials: the thing that quietly breaks onboarding

IBM requires **persistent test credentials that stay valid for the whole onboarding
window**, which runs to 3 weeks of release pipeline after publish. A routine rotation
during that window silently fails IBM's connection test and reads on their side as a
broken listing.

Requirements for the credential issued to IBM:

- A dedicated OAuth client, not a reused internal one, so it can be revoked alone.
- Scoped to `avatars:read`, `avatars:write`, `profile`, `offline_access` and nothing wider.
- Exempt from routine rotation for the onboarding window, and tracked wherever rotations
  are scheduled so nobody expires it by housekeeping.
- Recorded with the issue date and the IBM contact it went to.

Never paste the secret into this file, the listing form notes, or a commit. It goes to IBM
through the Concierge connection form only.

---

## Step 3: publish, then wait

BYOL publishes without IBM approval, but it still enters the watsonx Orchestrate release
pipeline: **up to 3 weeks** before the listing appears in the catalog. Updates take the
same path, so batch changes rather than shipping them one at a time.

**Do not announce the listing until it is actually visible in the catalog.** The copy in
[`social-copy.md`](social-copy.md) is held for exactly this reason.

---

## Post-publish

- Builders discover the server in the catalog and add it to their agents themselves.
- They configure connections using the OAuth2 schema above.
- We validate licensing and handle billing directly; IBM does not meter BYOL usage.
- We provide first-line support for the server. The support URL above is the entry point.
- Adoption is reported back through IBM Ecosystem team reports; ask for them.

## Open item

The catalog icon is committed at `public/partners/ibm/three-ws-agent-connect-icon.svg` but
its public URL 404s until the next production deploy. Concierge takes a file upload rather
than a URL, so this does not block submission, but deploy before pointing IBM at the link.
