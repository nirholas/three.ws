# Microsoft MCP server certification (Copilot Studio, Microsoft 365 Copilot, Foundry)

Program: Microsoft MCP server certification (preview). New submissions start with Microsoft's intake form; the package is then filed under the Partner Center offer type "Apps and Agents for M365 and Copilot".
Page last read: 2026-11-14 (<https://learn.microsoft.com/microsoft-copilot-studio/mcp-certification>, page dated 2026-10-30, updated 2026-11-02; the legacy page <https://learn.microsoft.com/microsoft-copilot-studio/mcp-server-certification>, updated 2026-10-01). The intake form itself (a Microsoft Forms page) did not render to a fetch: its questions are **not verified on 2026-11-14**. Previous read: 2026-10-23.
Order: 939 task 1. Tracker row: "Microsoft Copilot Studio and Microsoft 365 Copilot MCP certification" in `marketing/growth/opportunities.csv`.
Nothing here has been submitted. Shared facts and the owner-only inputs list: [README.md](./README.md).

## What changed since 2026-10-23

- The legacy route was extended: it is usable **through 2026-11-18** (was 2026-10-31), still only "if you have an immediate publishing timeline or customer commitment".
- Step 2 of the new process is now "Submit intake form and email. Submit an intake form. Microsoft will reach out with further instructions." Intake form: <https://forms.cloud.microsoft/pages/responsepage.aspx?id=v4j5cvGGr0GRqy180BHbR9r8NB1yEjBHvyRFUGv3hYVUQUc3WkpTSDNYSzFTRTNXRThBMUtFWkwyMi4u&route=shorturl>.
- Microsoft now warns: "Due to high submission volume during preview, only a limited number of submissions can be processed. Microsoft will contact you if your submission is picked up for processing."
- Certified servers are listed as available in Azure Foundry, Cowork, Copilot chat and Copilot Studio.
- The FAQ now says both "No, DCR isn't supported today" and "No, PKCE isn't supported today". Our authorization server required PKCE for every client, so Microsoft's certification service could not have completed sign-in. Fixed on 2026-11-14, see the auth section below.

## Deadline and route

- **Intake form: no deadline, submit now.** It is the route Microsoft says to use "going forward", and a pick-up from the limited preview queue is first come.
- **Legacy route: through 2026-11-18.** It packages the server as a Power Platform connector. The certified-connector draft in [microsoft-power-platform-certification.md](./microsoft-power-platform-certification.md) is a REST connector, not an MCP one, and the legacy route also needs a business-verified Partner Center account. Judgment call: use the legacy route only if Partner Center verification has already cleared before 2026-11-18; otherwise do not chase it, because existing legacy certifications are being migrated to the new path anyway.

## Eligibility (quoted from the page)

| Requirement | Status for three.ws |
|---|---|
| Verified publisher: Partner Center account with completed business verification | Owner-only. Not recorded in the repo |
| Enrolled in the Microsoft 365 and Copilot program | Owner-only enrollment step |
| Own or control the MCP endpoint | Met. `https://three.ws/api/mcp-studio` and `https://three.ws/api/mcp` run on our Cloud Run service `three-ws-api` |
| Approved authentication method, configuration in Azure Key Vault | OAuth 2.1 in `api/oauth/[action].js`, now able to issue a pre-registered confidential client that signs in without PKCE (below) |
| Package: manifest, tool file, `intro.md`, Azure Key Vault auth config, icons, support/privacy/terms links | Drafted below |
| Evaluation evidence (optional, "can help accelerate review") | Proof brief figures, below |

### Authentication: pre-registered client, no DCR, no PKCE

Microsoft reads a pre-registered `ClientId`, `ClientSecret`, `AuthorizationUrl`, `TokenUrl` (and optionally `RefreshUrl`, `Scopes`) from the publisher's Azure Key Vault, and its service does not send a PKCE challenge.

Built on 2026-11-14 (commit `456a6385d`): a client that an operator registers by hand as `confidential` with a secret may now complete the authorization code flow without PKCE. Self-registered (DCR) clients and public clients still must use PKCE, and a code issued with a challenge still needs its verifier, so nothing else got weaker (RFC 9700 section 2.1.1 allows exactly this for confidential clients). Tests: `tests/oauth-endpoints.test.js`, "pre-registered confidential client without PKCE". The database migration (`20261114120000_oauth_codes_optional_pkce.sql`) is applied in production; the code change reaches production with the next deploy.

Register the client (prints the secret once; store it straight into Key Vault, never in git):

    node scripts/oauth-register-client.mjs --name "Microsoft Copilot" --redirect-uri <redirect URI Microsoft gives you> --apply

It prints `client_id`, `client_secret`, `authorization_url` (`https://three.ws/oauth/authorize`), `token_url` and `refresh_url` (`https://three.ws/oauth/token`), which go into the Key Vault secrets `ClientId`, `ClientSecret`, `AuthorizationUrl`, `TokenUrl` and `RefreshUrl`. Default scope `avatars:read profile`; pass `--scope` to change it. Run it without `--apply` first to see the dry run.

## Drafted manifest (replace the bracketed owner inputs)

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json",
  "version": "1.30",
  "id": "[GUID generated in Partner Center]",
  "developer": {
    "name": "[legal entity name, owner input]",
    "websiteUrl": "https://three.ws",
    "privacyUrl": "https://three.ws/legal/privacy",
    "termsOfUseUrl": "https://three.ws/legal/tos",
    "contactInfo": {
      "defaultSupport": {
        "userEmailsForChatSupport": ["support@three.ws"],
        "emailsForEmailSupport": ["support@three.ws"]
      }
    }
  },
  "name": { "short": "three.ws 3D Studio", "full": "three.ws 3D Studio: text and photo to 3D models and avatars" },
  "description": {
    "short": "Generate, rig and inspect 3D models and avatars from text or a photo.",
    "full": "Sixteen tools that turn a plain-language request or a photo into a textured, downloadable GLB, auto-rig it for animation, find ready-made CC0 assets, and open the result in an interactive viewer at three.ws/m/<id>. Free tools need no account."
  },
  "agentConnectors": [
    {
      "id": "threews-studio",
      "displayName": "three.ws 3D Studio",
      "description": "Generate, rig, look up and view 3D models and avatars.",
      "toolSource": {
        "remoteMcpServer": {
          "mcpServerUrl": "https://three.ws/api/mcp-studio",
          "mcpToolDescription": { "file": "mcptools.json" },
          "authorization": { "type": "AzureKeyVault", "referenceId": "https://[owner-keyvault].vault.azure.net/" }
        }
      }
    }
  ],
  "icons": { "outline": "Outline.png", "color": "Color.png" },
  "accentColor": "#[brand hex, owner input]"
}
```

Notes: the legal URLs above are existing pages (`public/legal/privacy.html`; the Terms of Service live at `https://three.ws/legal/tos`, per the 2026-09-17 ElevenLabs sheet). `mcptools.json` is generated from the live `tools/list` of the endpoint:

    curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

Microsoft allows only ASCII header names and values in the manifest and tool files. Icons must follow the Teams Store icon guidance (outline and color PNGs, sized per that checklist). Source art: `public/logo.png`.

## Partner Center form answers

Neither the intake form's questions nor Partner Center's offer wizard could be read (both need a browser session or sign-in): **not verified on 2026-11-14**. The page names the package areas below, so the answers cover each one; paste the matching ones into the intake form.

| Field | Draft answer |
|---|---|
| Offer type | Apps and Agents for M365 and Copilot |
| Offer name | three.ws 3D Studio |
| Summary (one line) | Text or photo to a textured, rigged 3D model, with a viewer, from any Copilot agent. |
| Description | three.ws is an open-source platform for embodied 3D AI agents. Its hosted MCP server exposes sixteen tools (live `tools/list`, 2026-11-14): free text-to-3D generation, avatar generation, auto-rigging, a CC0 asset catalog, a model look-up for inspection, and persona tools. Every finished model opens in an interactive viewer. Endpoint: Streamable HTTP, MCP 2025-06-18, OAuth 2.1. |
| Category | Developer tools / Design (owner picks from Partner Center's list) |
| Support URL and email | `https://three.ws` and `support@three.ws` |
| Privacy and terms URLs | See the manifest |
| Test credentials / setup | Free tools need no credentials: `POST https://three.ws/api/mcp-studio`. For the OAuth path, the client from `scripts/oauth-register-client.mjs`, delivered through Key Vault |
| Evaluation evidence (optional, speeds review) | Proof brief 2026-10: 13,898 MCP tool calls at 99.4% handler success, handler p50 143 ms, 13 OAuth client names, zero errors across 1,723 ChatGPT-facing calls. Attach `docs/partners/proof-brief-2026-10.md` figures only after rerunning `npm run partners:proof` |
| Known issues and limitations (`intro.md`) | Generation takes 30 to 300 seconds, so `forge_free` returns a job id and `check_job` polls it. Completion was 90.2% in normal operation and 87.0% over the last five days of September; two worker incidents are documented in the proof brief |

## Owner steps (deadline first)

1. Today: submit the intake form at the link above with the package answers in this file. Microsoft contacts you if the submission is picked up.
2. Partner Center: complete business verification and enroll in the Microsoft 365 and Copilot program (duration not stated by Microsoft; start today). If verification clears before 2026-11-18 and you want the legacy route as well, follow [microsoft-power-platform-certification.md](./microsoft-power-platform-certification.md).
3. Approve the production deploy that carries commit `456a6385d` (the PKCE exemption), then register the client with `scripts/oauth-register-client.mjs` (above) once Microsoft gives the redirect URI.
4. Create the Key Vault, store the secrets, and grant Key Vault Secrets User to service principal `8e91e74f-afe9-41cd-8c3f-17a9562a74ea`.
5. Generate `mcptools.json`, write `intro.md` from the description above, build the icons, zip the package and upload it where Microsoft's reply points.
6. Log the submission in `opportunities.csv` (status `submitted`, date). Microsoft's request for changes is the next row action.
7. Separate and later: Microsoft for Startups credits (up to USD 150,000, vendor claim in `docs/partners/prospects.md`) are a different program; the tracker row sequences it after the AWS Marketplace listing.

## Do not claim

No Microsoft partnership, endorsement or certification until Microsoft confirms it. Certified status is "pending review" until then.

<!-- media:microsoft:start (generated by npm run media:microsoft; edits inside are overwritten) -->

### Listing media (captured 2026-11-12 from https://three.ws)

Regenerate with `npm run media:microsoft`. How it works and when to refresh: [marketing/microsoft/media/README.md](../../../../marketing/microsoft/media/README.md). Exact sizes and checksums: [manifest.json](../../../../marketing/microsoft/media/manifest.json).

**Microsoft Teams Store app** (requirements read 2026-11-11: <https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/submission-checklist>)

- [`screenshot-1-teams-tab-1366x768.png`](../../../../marketing/microsoft/media/teams/screenshot-1-teams-tab-1366x768.png): 1366 x 768, 90 KB. Caption: "The three.ws tab for Microsoft Teams: browse agents and see what each one did today."
- [`screenshot-2-adaptive-card-1366x768.png`](../../../../marketing/microsoft/media/teams/screenshot-2-adaptive-card-1366x768.png): 1366 x 768, 145 KB. Caption: "The agent card as an Adaptive Card, rendered by the Adaptive Cards SDK with the Microsoft Teams host config."
- [`screenshot-3-agent-1366x768.png`](../../../../marketing/microsoft/media/teams/screenshot-3-agent-1366x768.png): 1366 x 768, 191 KB. Caption: "Every agent has a public page with its 3D body, its skills and a chat anyone can open."
- [`screenshot-4-forge-result-1366x768.png`](../../../../marketing/microsoft/media/teams/screenshot-4-forge-result-1366x768.png): 1366 x 768, 254 KB. Caption: "The finished model from that one prompt, ready to orbit, download as GLB or place in a scene."
- [`screenshot-5-viewer-1366x768.png`](../../../../marketing/microsoft/media/teams/screenshot-5-viewer-1366x768.png): 1366 x 768, 242 KB. Caption: "The three.ws viewer: inspect any GLB or glTF in the browser, with lighting, animation and AR."
- Video: the listing takes a YouTube or Vimeo link, not a file. Upload <https://storage.googleapis.com/three-ws-desktop-releases/marketing/microsoft/2026-11-12/three-ws-demo-a9ba45979ad6.mp4> with the captions in [`three-ws-demo.en.srt`](../../../../marketing/microsoft/media/video/three-ws-demo.en.srt), then paste that link.

<!-- media:microsoft:end -->
