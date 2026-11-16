# three.ws 3D for SharePoint and Viva Connections

Put a live three.ws agent or an interactive 3D model on any modern SharePoint page, and an agent card on the Viva Connections dashboard. The solution is a SharePoint Framework (SPFx 1.24.1) package. Source: [integrations/microsoft/sharepoint-spfx/](../integrations/microsoft/sharepoint-spfx/README.md).

| Component | Where it appears |
| --- | --- |
| three.ws Agent web part | SharePoint pages, full-width sections, Teams tabs and personal apps. A live, animated agent visitors can watch and talk to. |
| three.ws 3D Model web part | The same hosts. An interactive Forge model or any https GLB file. |
| three.ws Agent card | Viva Connections dashboard. Avatar poster, name and live status, a quick view with the description, and a link to the agent page. |

three.ws and Microsoft have announced a partnership. This is a three.ws product, not a Microsoft product, and is not endorsed by Microsoft. Microsoft, SharePoint, Viva and Microsoft Teams are trademarks of the Microsoft group of companies.

## For a tenant administrator

One time, per tenant.

1. **Upload the package.** Download `three-ws-3d.sppkg` (built by `npm run package:sharepoint`, or the AppSource install once listed). Open the SharePoint admin center, then **More features**, **Apps**, **Open**, **Upload**. For a single site, use that site's App Catalog instead.
2. **Deploy.** Choose **Make this solution available to all sites in the organization** to deploy tenant-wide, or add the app to individual sites. The package asks for no API permissions and needs no custom script permission.
3. **Allow the runtime.** In the SharePoint admin center open **Advanced**, **Script sources** (Trusted script sources) and add:

       https://three.ws/agent-3d/1.5.2/

   This is the only entry needed. The page's Content Security Policy then lets the pinned, integrity-checked runtime load. If the entry is missing, the web part tells the site owner the exact value to ask the administrator for.
4. **Viva Connections.** Open the dashboard editor, **Add card**, **three.ws Agent card**.

What the solution does on your network: it loads `https://three.ws/agent-3d/1.5.2/agent-3d.js` (with a Subresource Integrity hash) and makes credential-less reads of the public `https://three.ws/api` (agent directory and model gallery). It stores nothing in the tenant and reads no tenant data.

## For a site owner

1. Edit the page, **Add a new web part**, search for **three.ws**.
2. **three.ws Agent**: click **Choose an agent** and search by name. Results are live from three.ws. **three.ws 3D Model**: search the Forge gallery by what the model shows, or paste an https link to a GLB file.
3. Set the options in the property pane:

   | Option | Meaning |
   | --- | --- |
   | Accessible title | Read by screen readers. Defaults to the agent or model name. |
   | Height | 240 to 1200 px. |
   | Background | Transparent, dark or light. |
   | Framing | Full body or portrait (closer). |
   | Autoplay animation | Turn off for visitors who need still content. |
      | Chat (agent only) | Let visitors talk to the agent. |

The web parts follow the section theme variant and are keyboard operable.

## Build and test it yourself

Needs Node 22.14 or newer (SPFx 1.24 requirement). The SPFx toolchain stays inside the package folder.

    cd integrations/microsoft/sharepoint-spfx
    npm ci
    npm run package:sharepoint     # tests, production build, .sppkg, 53 package checks
    npm run harness                # headless render under SharePoint's script CSP, live data

From the repository root, `npm run package:sharepoint` runs the same thing.

## Troubleshooting

| You see | Cause and fix |
| --- | --- |
| The web part asks for a Trusted script sources entry | Add `https://three.ws/agent-3d/1.5.2/` (step 3). |
| "Could not load this agent" | The agent was unpublished or the id is wrong. Choose the agent again. |
| The stage stays on its poster | Click it. Posters load the 3D scene on demand to keep pages light. |
| Nothing renders in a Teams tab | The tenant blocks `three.ws`. Allow `https://three.ws` in the network policy. |
