# three.ws flow templates and Copilot Studio sample

Ready-made Power Automate flows and a Copilot Studio agent built on the three.ws 3D Studio connector. Each flow is a `workflow.json` in the Logic Apps workflow definition language (the format Power Automate stores cloud flows in), with a README covering what it does, what it needs, and its parameters.

| Template | Trigger | three.ws actions | Other connectors |
|---|---|---|---|
| [sharepoint-item-to-3d-model](sharepoint-item-to-3d-model/) | New SharePoint list item | Generate a 3D model from text, Get generation job | SharePoint, Microsoft Teams |
| [forms-response-to-3d-model-email](forms-response-to-3d-model-email/) | New Microsoft Forms response | Generate a 3D model from text, Get generation job | Microsoft Forms, Office 365 Outlook |
| [daily-agent-digest](daily-agent-digest/) | Daily schedule | List my agents, Search public agents | Office 365 Outlook |
| [teams-ask-your-agent](teams-ask-your-agent/) | New Teams channel message | Send a message to an agent | Microsoft Teams, Content Conversion |
| [copilot-studio](copilot-studio/) | Chat in Teams or Microsoft 365 Copilot | All five | none |

## How they stay correct

`npm run package:power-platform-connector -- --check` runs [scripts/power-platform-templates.mjs](../../../../scripts/power-platform-templates.mjs) over this folder. Every three.ws action must exist on the connector, every input must be declared, with allowed enum values, and every required input must be present. Every `body('<three.ws action>')?['field']` must be a field the action returns. Every `runAfter`, `parameters()`, `variables()` and action reference must resolve. Every README must name the three.ws actions its template uses. The live contract test (`tests/microsoft-power-platform-connector-live.test.js`) calls each of those actions against production and checks the responses against the same schemas.

## Import into an environment

Flows are addressed through connection references, so they move between environments without edits. To create them as cloud flows:

1. In the target environment, create one connection per connector the template uses: three.ws 3D Studio, plus SharePoint, Teams, Forms, Office 365 Outlook or Content Conversion as listed above.
2. Write a `values.json` with the connector's API name, the connection ids, and the parameter values for each template you want. Before certification the three.ws connector is a custom connector, and its API name has a suffix: copy it from the connector's details page.

   ```json
   {
     "connectorApi": "shared_threews3dstudio",
     "connections": { "shared_threews3dstudio": "<id>", "shared_office365": "<id>" },
     "templates": { "daily-agent-digest": { "Digest recipient": "you@contoso.com", "Time zone": "UTC" } }
   }
   ```
3. Run the importer. It creates any missing connection references and the flows, turned off, optionally inside a solution:

   ```bash
   DATAVERSE_TOKEN=$(az account get-access-token --resource https://<org>.crm.dynamics.com --query accessToken -o tsv) \
     node scripts/import-power-platform-templates.mjs --env https://<org>.crm.dynamics.com --values values.json --solution threewsTemplates
   ```

   `--dry-run` checks the values file without calling the environment.
4. Open each flow, review it, and turn it on.

For certification, export the solution that holds the connector and these flows. That flow solution goes in `package.zip`, next to the connector's `intro.md`.
