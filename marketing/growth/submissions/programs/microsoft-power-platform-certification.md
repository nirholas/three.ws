# Microsoft Power Platform connector certification: three.ws 3D Studio

Program: Power Platform certified connectors (verified publisher). The pull request goes to `microsoft/PowerPlatformConnectors` (`dev` branch, `certified-connectors/three.ws 3D Studio/`), and the submission goes through Partner Center.
Order: 817 (microsoft 17). Plan: `docs/microsoft-marketplace-offer-plan.md` (Power Platform connector). Shared facts and owner-only inputs: [README.md](./README.md).
Prepared: 2026-11-11. **Status: ready to submit. Nothing has been submitted.** Once submitted, it is "pending review" until Microsoft publishes it. Do not call the connector certified before then.
Approved partnership wording only: "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace".

## What gets submitted

| Item | Where it comes from |
|---|---|
| `certified-connectors/three.ws 3D Studio/` (`apiDefinition.swagger.json`, `apiProperties.json`, `icon.png`, `readme.md`) | `PP_OAUTH_CLIENT_ID=<client_id> npm run package:power-platform-connector` writes it to `dist/microsoft/certified-connectors/three.ws 3D Studio/` |
| Package for Partner Center: `intro.md` plus `package.zip` (connector solution and flow solution) | Exported from the dev environment after the steps below. `intro.md` is `integrations/microsoft/power-platform-connector/intro.md` |
| Flow templates | `integrations/microsoft/power-platform-connector/templates/` (four flows), imported with `scripts/import-power-platform-templates.mjs` |
| Copilot Studio sample | `integrations/microsoft/power-platform-connector/templates/copilot-studio/` |

Source of truth: `integrations/microsoft/power-platform-connector/`. Never edit the built folder by hand. Change the source and rebuild.

## Pull request

**Title:** `three.ws 3D Studio`

**Body** (the repository template, filled in; tick the `paconn validate` box only after running it):

```markdown
three.ws 3D Studio connects flows, apps and agents to three.ws: generate textured 3D models (GLB) from a text prompt, poll the generation job, list your three.ws agents, search the public agent directory, and send a message to an agent and get its reply.

Publisher: three.ws (verified publisher). Authentication: OAuth 2.0 authorization code with S256 PKCE against https://three.ws/oauth, per-connector redirect URL (GlobalPerConnector). Five actions, no triggers.

- [x] I attest that the connector doesn't exist on the Power Platform today. I've verified by checking the pull requests in GitHub and by searching for the connector on the platform or in the documentation.
- [x] I attest that the connector works and I verified by deploying and testing all the operations.
- [x] I attest that I have added detailed descriptions for all operations and parameters in the swagger file.
- [x] I attest that I have added response schemas to my actions, unless the response schema is dynamic.
- [ ] I validated the swagger file, `apiDefinition.swagger.json`, by running `paconn validate` command.
- [x] If this is a certified connector, I confirm that `apiProperties.json` has a valid brand color and doesn't use an invalid brand color, `#007ee5` or `#ffffff`.
```

Before ticking the first box, search the open and merged pull requests in `microsoft/PowerPlatformConnectors` for "three.ws" and confirm there is no existing three.ws connector in the Power Platform connector reference. Tick the second box only after the steps under "Before you open the pull request" are done in a real environment.

## Checklist with evidence

| Requirement | State | Evidence |
|---|---|---|
| Title is 30 characters or fewer, with no "API", "Connector" or product names | Pass | `three.ws 3D Studio` (18). Checked by `checkDefinition` in `scripts/build-power-platform-connector.mjs` |
| Description is 31 to 499 characters and names no product | Pass | Same check |
| Summaries are 80 characters or fewer, letters, digits and parentheses only; descriptions are full sentences | Pass | Same check, applied to every operation, parameter and response property |
| Every operation, parameter and body property has `x-ms-visibility`; a required internal input has a default | Pass | Same check |
| Response schemas: only the 2xx response has one, no `default` responses, every property has a summary and description | Pass | Same check. `x-nullable` marks every field production can return as null |
| Swagger validator rules (no siblings next to `$ref`, no empty `required`, no body on GET, `consumes` present, `x-ms-dynamic-values` with `parameters`) | Pass | Same check, one rule per validator error name |
| Category is one of the certified list | Pass | `AI;Productivity`, checked against `CONNECTOR_CATEGORIES` |
| Valid against the schemas the repository validates with | Pass | `apiDefinition.swagger.schema.json` and `paconn-apiProperties.schema.json` vendored from the repository at commit `2ab73144` ([provenance](../../../../integrations/microsoft/power-platform-connector/schema/README.md)). The built folder was validated against both on 2026-11-11 |
| Icon: 100 to 230 px square, opaque, brand-color background, glyph within 70%, brand color not `#ffffff` or `#007ee5` | Pass | 230 x 230 on `#080814`, checked by `checkIcon` |
| `readme.md` follows the repository readme template | Pass | Title, then Publisher, Prerequisites, Supported Operations, Obtaining Credentials, Getting Started, Known Issues and Limitations, Frequently Asked Questions, Deployment Instructions, in order. Checked on every build |
| OAuth settings | Pass | `oauth2generic`, `GlobalPerConnector`, PKCE `{CodeChallenge}`/`{CodeVerifier}` templates, scopes `profile agents:read offline_access` matching the definition |
| Responses match production | Pass | `tests/microsoft-power-platform-connector-live.test.js` called all five actions against https://three.ws on 2026-11-11. Every response matched its declared schema (5 of 5) |
| Templates use only real actions and inputs | Pass | `scripts/power-platform-templates.mjs`, run by `--check` and `tests/microsoft-power-platform-connector.test.js` |
| `paconn validate` | Owner | Needs `paconn login` with the owner's Microsoft account |
| At least 10 successful calls per operation through the connector | Owner | Counted by Microsoft from connector telemetry, so the calls must go through the connector in an environment. Run each action 10 times, or run the four templates and the Copilot Studio test prompts |
| Solution Checker on the connector solution | Owner | Run in the dev environment |
| Package validation (`ConnectorPackageValidator.ps1`) | Owner | Run on `intro.md` plus `package.zip` before uploading to Partner Center |

## Before you open the pull request

1. Deploy production, so the agent-message fix (owners can always message their own agents, commit `8af4a7341`) is live.
2. In a dev environment, create the connector from the build with `pac connector create`, register the public PKCE client with its redirect URL, and rebuild with the real client id. The steps are in the [connector README](../../../../integrations/microsoft/power-platform-connector/README.md#owner-steps-to-publish).
3. Run `paconn validate --api-def "dist/microsoft/certified-connectors/three.ws 3D Studio/apiDefinition.swagger.json"`.
4. Import the four flow templates with `scripts/import-power-platform-templates.mjs` ([how](../../../../integrations/microsoft/power-platform-connector/templates/README.md#import-into-an-environment)). Turn each flow on and run it until every action has 10 or more successful calls.
5. Build the Copilot Studio sample from `templates/copilot-studio/` and send each of its test prompts.
6. Run the Solution Checker. Export the connector solution and the flow solution into `package.zip`, put `intro.md` beside it, and run `ConnectorPackageValidator.ps1`.
7. Open the pull request with the title and body above, then submit in Partner Center with the package and the reviewer account below.

## Reviewer test account

Microsoft's testers need a working three.ws sign-in. Use a dedicated account, never a personal or admin one:

1. Create an account at https://three.ws (email and password sign-in), for example `powerplatform-review@three.ws`. Use a long random password.
2. Sign in and create one agent (https://three.ws/create), give it a 3D body, and publish it, so List my agents, Search public agents and Send a message to an agent all return real data.
3. Generate one model at https://three.ws/create-prompt to confirm generation works for the account.
4. Give the email and password in Partner Center, in the certification notes field only. Never put them in the pull request, the readme or this repository.
5. Testing instructions for the notes field:

   > Create a connection and sign in with the account above. Approve the consent screen. Generate a 3D model from text with prompt "a small ceramic robot figurine" and Quality "draft". If the status is pending, call Get generation job with the returned job until the status is done, then open viewerUrl. List my agents returns the account's agent. Search public agents with Sort "newest" returns public agents. Send a message to an agent with that agent and message "What can you help me with?" returns a reply.

6. Keep the account active until the connector is published, and delete it afterwards.

## After submission

- Record the Partner Center submission id and the pull request URL here, with the date.
- Microsoft's feedback arrives on the pull request and in Partner Center. Make each fix in `integrations/microsoft/power-platform-connector/`, rebuild, rerun `--check` and the live test, and push the rebuilt folder to the same pull request.
- Publishing rolls out by region over several weeks after approval. Only then may the docs say the connector is available in Power Automate.
