# AppSource listing for a SharePoint Framework solution: three.ws 3D

Program: SharePoint Framework solutions on Microsoft AppSource (Office apps, SharePoint), submitted through Partner Center.
Order: 835 (microsoft 35). Shared facts and owner-only inputs: [README.md](./README.md).
Prepared: 2026-11-16. **Status: ready to submit. Nothing has been submitted.**
Approved partnership wording only: "three.ws and Microsoft have announced a partnership".

## What gets submitted

| Item | Where it comes from |
|---|---|
| `three-ws-3d.sppkg` | `npm run package:sharepoint` from the repo root writes `integrations/microsoft/sharepoint-spfx/sharepoint/solution/three-ws-3d.sppkg` |
| Solution id | `498157c3-9cd8-48d9-998c-5e13373e05b7` (`config/package-solution.json`) |
| Screenshots | Agent web part, model web part and the Viva Connections card on a real page. Plan below |
| Test notes | Section below |
| Support, privacy, license | `https://three.ws/support`, `https://three.ws/legal/privacy`, Standard Contract for Microsoft Commercial Marketplace |
| Admin guide | [docs/microsoft-sharepoint.md](../../../../docs/microsoft-sharepoint.md) |

## Listing copy

**Name:** three.ws 3D

**Summary:** Put a live three.ws agent or an interactive 3D model on any SharePoint page or Viva Connections dashboard.

**Description:**

> three.ws 3D adds two web parts and a Viva Connections card to SharePoint.
>
> three.ws Agent shows a live, animated agent your visitors can watch and talk to. Pick it from a searchable directory, no ids to copy.
>
> three.ws 3D Model shows an interactive model from the Forge gallery on three.ws, or any https GLB file.
>
> The Agent card puts an agent's avatar, name and live status on your Viva Connections dashboard with a quick view and a link to its page.
>
> Network access: the web parts load the three.ws runtime from https://three.ws/agent-3d/1.5.2/ with an integrity hash and read public, credential-less data from https://three.ws/api. Nothing is stored in your tenant and no tenant data is read. A tenant administrator allows the script source once (Trusted script sources).
>
> Free to use. Create agents and models at https://three.ws.

**Search keywords:** 3D, GLB, avatar, agent, Viva Connections

## Screenshots plan (1366 x 768 PNG)

1. A page section with the Agent web part and the property pane open.
2. The Model web part with the gallery picker.
3. The Agent card on a Viva Connections dashboard and its quick view.
4. The same page inside a Teams tab.

## Test notes for the reviewer

1. Upload the .sppkg to the App Catalog and deploy tenant-wide.
2. Add `https://three.ws/agent-3d/1.5.2/` to Trusted script sources (SharePoint admin center, Advanced, Script sources).
3. Edit a modern page, add **three.ws Agent**, choose any agent from the picker. The agent renders and answers in the chat box.
4. Add **three.ws 3D Model**, search "chair" in the gallery and pick a result. It renders and orbits with mouse or keyboard.
5. Without step 2 the web part shows the exact entry the administrator must add. No account or credentials are needed anywhere.

## Checklist with evidence

| Requirement | State | Evidence |
|---|---|---|
| Builds with current SPFx | Pass | SPFx 1.24.1, `npm run package:sharepoint` |
| Package validation | Pass | `npm run validate` in the package, 53 of 53 checks on 2026-11-16 |
| `includeClientSideAssets` and no external script in the bundle | Pass | `scripts/validate-package.mjs` |
| No tenant API permissions requested | Pass | none declared in `config/package-solution.json` |
| Renders under SharePoint script-src CSP | Pass | `npm run harness` (headless, live three.ws data) |
| Cross-origin agent read works from SharePoint origin | Owner | Needs the production deploy carrying the `GET /api/agents/:id` CORS fix (`tests/agents-public-read-cors.test.js`) |
| Trusted script sources entry | Owner | Tenant admin step in the admin guide |
| Screenshots from a real tenant | Owner | Plan above |
| Partner Center offer created and submitted | Owner | Partner Center, Marketplace offers, New offer, SharePoint Framework solution |
