# Microsoft MCP server certification (Copilot Studio, Microsoft 365 Copilot, Foundry)

Program: Microsoft MCP server certification (preview), submitted through Partner Center.
Page last read: 2026-10-23 (<https://learn.microsoft.com/microsoft-copilot-studio/mcp-certification>, page dated 2026-09-25, updated 2026-10-17).
Order: 939 task 1. Tracker row: "Microsoft Copilot Studio and Microsoft 365 Copilot MCP certification" in `marketing/growth/opportunities.csv`.
Nothing here has been submitted. Shared facts and the owner-only inputs list: [README.md](./README.md).

## Deadline

- Legacy certification route (`/microsoft-copilot-studio/mcp-server-certification`) is usable only through **2026-10-31**. Microsoft's own wording: use it if "you have an immediate publishing timeline or customer commitment".
- New submissions are meant to use the Partner Center offer type **Apps and Agents for M365 and Copilot**. No new-path deadline is stated. Microsoft warns processing on the new path "might be slower than usual" because of preview volume.
- Judgment call: submit on the **new** path. The legacy route is a dead end after 2026-10-31, we have no customer commitment that needs the old timeline, and existing certifications are being migrated to the new path anyway.

## Eligibility (quoted from the page)

| Requirement | Status for three.ws |
|---|---|
| Verified publisher: Partner Center account with completed business verification | Owner-only. Not recorded in the repo. Not verified on 2026-10-23 |
| Enrolled in the Microsoft 365 and Copilot program | Owner-only enrollment step |
| Own or control the MCP endpoint | Met. `https://three.ws/api/mcp-studio` and `https://three.ws/api/mcp` run on our Cloud Run service `three-ws-api` |
| Approved authentication method | OAuth 2.1 exists (`api/oauth/[action].js`). **Gap below** |
| Package: manifest, tool file, `intro.md`, Azure Key Vault auth config, icons, support/privacy/terms links | Drafted below |

### Gap: Dynamic Client Registration

The FAQ states "No, DCR isn't supported today." Our OAuth server registers clients dynamically (13 client names in the proof brief). Microsoft instead reads a **pre-registered** `ClientId`, `ClientSecret`, `AuthorizationUrl`, `TokenUrl` (and optionally `RefreshUrl`, `Scopes`) from the publisher's Azure Key Vault. Owner step: register one confidential client for Microsoft with `POST https://three.ws/api/oauth/register` (`token_endpoint_auth_method=client_secret_basic`), using the redirect URI Microsoft's service shows, and store the four values in a Key Vault. For a first submission, the free tools in `mcp-studio` need no auth, but Microsoft expects an auth configuration in the package, so register the client.

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
    "full": "Fifteen tools that turn a plain-language request or a photo into a textured, downloadable GLB, auto-rig it for animation, find ready-made CC0 assets, and open the result in an interactive viewer at three.ws/m/<id>. Free tools need no account."
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

The page does not list Partner Center's field-level form (the offer wizard is behind sign-in). Not verified on 2026-10-23. Expect these sections and use these answers.

| Field | Draft answer |
|---|---|
| Offer type | Apps and Agents for M365 and Copilot |
| Offer name | three.ws 3D Studio |
| Summary (one line) | Text or photo to a textured, rigged 3D model, with a viewer, from any Copilot agent. |
| Description | three.ws is an open-source platform for embodied 3D AI agents. Its hosted MCP server exposes fifteen tools: free text-to-3D generation, avatar generation, auto-rigging, a CC0 asset catalog, a model look-up for inspection, and persona tools. Every finished model opens in an interactive viewer. Endpoint: Streamable HTTP, MCP 2025-06-18, OAuth 2.1. |
| Category | Developer tools / Design (owner picks from Partner Center's list) |
| Support URL and email | `https://three.ws` and `support@three.ws` |
| Privacy and terms URLs | See the manifest |
| Test credentials / setup | Free tools need no credentials: `POST https://three.ws/api/mcp-studio`. For the OAuth path, supply the registered client details through Key Vault |
| Evaluation evidence (optional, speeds review) | Proof brief 2026-10: 13,898 MCP tool calls at 99.4% handler success, handler p50 143 ms, 13 OAuth client names, zero errors across 1,723 ChatGPT-facing calls. Attach `docs/partners/proof-brief-2026-10.md` figures only after rerunning `npm run partners:proof` |
| Known issues and limitations (`intro.md`) | Generation takes 30 to 300 seconds, so `forge_free` returns a job id and `check_job` polls it. Completion was 90.2% in normal operation and 87.0% over the last five days of September; two worker incidents are documented in the proof brief |

## Owner steps

1. Partner Center: complete business verification and enroll in the Microsoft 365 and Copilot program (not verified how long this takes; start today).
2. Create the Key Vault, register the confidential OAuth client on three.ws, store the secrets, and grant Key Vault Secrets User to service principal `8e91e74f-afe9-41cd-8c3f-17a9562a74ea`.
3. Generate `mcptools.json`, write `intro.md` from the description above, build the icons, zip the package, create the offer, upload, submit.
4. Log the submission in `opportunities.csv` (status `submitted`, date) and, if Microsoft asks for changes, treat that as the next row action.
5. Separate and later: Microsoft for Startups credits (up to USD 150,000, vendor claim in `docs/partners/prospects.md`) are a different program; the tracker row sequences it after the AWS Marketplace listing.

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
