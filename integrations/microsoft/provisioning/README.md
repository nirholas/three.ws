# Microsoft provisioning

One command creates or reconciles every Microsoft-side resource three.ws needs, using the operator's own `az login` session:

```bash
az login --tenant <publisher tenant>
npm run microsoft:provision                      # plan: read live state, print the diff, change nothing
npm run microsoft:provision -- --apply           # create or reconcile; a rerun changes nothing
npm run microsoft:provision -- --verify          # check live resources, Cloud Run env and production endpoints
```

It replaces the portal click path that was steps 4 to 8 of the [owner checklist](../../../docs/microsoft-marketplace-offer-plan.md#owner-checklist-in-order).

## What it manages

The desired state is [`resources.json`](./resources.json). Every entry names the file that uses it.

| Resource | Details | Feeds |
| --- | --- | --- |
| Entra app `threews-marketplace-fulfillment` | Single tenant. Client secret. | `MS_MARKETPLACE_TENANT_ID`, `MS_MARKETPLACE_CLIENT_ID`, `MS_MARKETPLACE_CLIENT_SECRET` ([microsoft-marketplace.js](../../../api/_lib/microsoft-marketplace.js), [microsoft-partner-center.js](../../../api/_lib/microsoft-partner-center.js)) |
| Entra app `threews-entra-sso` | Multitenant plus personal accounts. Web redirects for Sign in with Microsoft, Marketplace landing sign-in and Microsoft 365 admin consent; single-page-application redirect `/auth/microsoft/redirect` for OneDrive in Forge ([docs/onedrive.md](../../../docs/onedrive.md)). Delegated `openid profile email offline_access User.Read Files.ReadWrite`, application `ExternalConnection.ReadWrite.OwnedBy` and `ExternalItem.ReadWrite.OwnedBy`. `email` and `xms_edov` ID token claims, `DirectoryRole` group claims, v2 access tokens. Client secret. | `MS_ENTRA_SSO_CLIENT_ID`, `MS_ENTRA_SSO_CLIENT_SECRET` ([entra-oidc.js](../../../api/_lib/entra-oidc.js), [m365-connector.js](../../../api/_lib/m365-connector.js)) |
| Entra app `threews-teams-bot` | Single tenant. Client secret, used to call the Bot Connector API. | `MS_TEAMS_BOT_APP_ID`, `MS_TEAMS_BOT_APP_PASSWORD`, `MS_TEAMS_BOT_TENANT_ID` ([teams-connector.js](../../../api/_lib/teams-connector.js)) |
| Resource group `three-ws-microsoft` | `eastus` by default. | |
| Key Vault `threews-ops-<suffix>` | RBAC authorization, soft delete. Holds a copy of the three client secrets, tagged with their Graph `keyId`. Only the operator gets Secrets Officer. | Recovery when the local copy is lost |
| Key Vault `threews-copilot-<suffix>` | Holds the three.ws OAuth client that Microsoft 365 Copilot uses for the MCP agent connector (`ClientId`, `ClientSecret`, `AuthorizationUrl`, `TokenUrl`, `RefreshUrl`, `Scopes`). Microsoft's reader app `8e91e74f-afe9-41cd-8c3f-17a9562a74ea` gets Key Vault Secrets User on this vault only, so it can never read the ops secrets. | `MS_KEYVAULT_URL` for `npm run package:microsoft-app` |
| Azure Bot `three-ws-bot-<suffix>` | F0, single tenant, bound to the bot app, messaging endpoint `https://three.ws/api/microsoft-teams/messages`, Microsoft Teams and Microsoft 365 channels. | |

`<suffix>` is six hex characters derived from the tenant and subscription, so the globally unique names stay stable across reruns. Override any name with `--resource-group`, `--location`, `--bot-name`, `--ops-vault-name` or `--copilot-vault-name`.

Only Microsoft Graph permissions are managed, so the SharePoint delegated permissions the work-account OneDrive picker needs are printed as an owner step. Scopes a sign-in grants without an app-registration entry (the personal-account picker's `OneDrive.ReadWrite`) are listed under `implicitScopes` so the drift check still covers them.

Not managed here (they need no Entra app): the Power Platform connector uses three.ws's own OAuth server, and the Teams tab has no SSO. Partner Center steps (technical configuration, the Manager role for Partner Center insights) are printed as owner steps because Partner Center has no API for them.

## Rules it follows

- **Plan by default.** Without `--apply` it only reads.
- **Additive.** Redirect URIs, permissions and claims an operator added by hand are kept and listed as `kept (unmanaged)`. Nothing is ever deleted.
- **Adopts, never duplicates.** It finds apps by `uniqueName` first. An app with the same display name and no `uniqueName` is adopted. Two such apps block the run until one is removed.
- **Blocks instead of guessing.** It refuses `--apply` when a Graph permission id in `resources.json` differs from the one Microsoft Graph publishes, when a vault name is taken elsewhere, or when the bot is bound to a different app.
- **Idempotent.** After applying, it re-plans and prints `0 to create, 0 to change`. Role assignments use deterministic GUIDs.
- **Secrets never printed.** Client secrets are created with a 365-day expiry (display name `three.ws provisioner`). They go only to the ops Key Vault and to `~/.config/three-ws/microsoft-provision/secrets.json` (directory 700, file 600). The tool refuses a `--secrets-dir` inside the repository. A secret is reissued when it has under 30 days left, when its value is in neither place, or with `--rotate-secrets`. A lost local file is restored from Key Vault without reissuing.
- **Env handoff.** `--apply` writes the single `--update-env-vars` argument to `cloud-run.env` (mode 600) and prints the line that reads it, with the absolute path:

  ```bash
  gcloud run services update three-ws-api --region us-central1 --update-env-vars "$(cat '/home/<you>/.config/three-ws/microsoft-provision/cloud-run.env')"
  ```

  It never uses `--set-env-vars`, which would replace the whole env. It also prints the `npm run package:microsoft-app` line with `MS_KEYVAULT_URL` and `MS_TEAMS_BOT_APP_ID` filled in, and the admin consent URL for the multitenant app.

## Permissions the operator needs

- In the publisher tenant: Global Administrator, or Application Administrator. Granting tenant-wide admin consent for the application permissions in a customer tenant is that tenant admin's step: they use `/api/microsoft-365/connect/start`.
- On the subscription: Owner, or Contributor plus User Access Administrator (the tool creates role assignments).
- No subscription yet? `az login --allow-no-subscriptions` still lets it create the three apps and their secrets. The plan marks the bot and vaults as blocked until `--subscription <id>` is given.

## The Copilot OAuth client

Microsoft issues the redirect URI for the MCP agent connector during certification. Until then, `ClientId` and `ClientSecret` in the Copilot vault show as owner steps. Once the URI is known:

```bash
npm run microsoft:provision -- --apply --copilot-redirect-uri <uri from Microsoft>
```

This runs [`scripts/oauth-register-client.mjs`](../../../scripts/oauth-register-client.mjs) against the production database (it reads `DATABASE_URL` from Cloud Run when it is not set) and stores the client in the vault.

### The Copilot plugin sign-in

The declarative agent's plugin (`ai-plugin.json`) signs each Copilot user in to three.ws, because making or rigging a model needs an account. It uses a separate OAuth client registration in the Teams Developer Portal, whose id is `MS_COPILOT_OAUTH_REFERENCE_ID` for `npm run package:microsoft-app`. The steps are in [docs/microsoft-copilot-agent.md](../../../docs/microsoft-copilot-agent.md#register-the-sign-in-owner-step).

## Drift check

[`lib/code-scan.mjs`](./lib/code-scan.mjs) reads every source file under `api/`, `scripts/`, `server/` and `integrations/microsoft/` that talks to `login.microsoftonline.com`. It collects:

- each `/api/.../callback` redirect
- each Graph scope or permission in a scope or permission list
- each `.default` or `*_RESOURCE` audience
- each `MS_*` env var, from all scanned files

[`tests/microsoft-provision.test.js`](../../../tests/microsoft-provision.test.js) fails when code asks for anything `resources.json` does not list, and when a listed entry is no longer used by the file it names. Local-only overrides (emulator URLs, alert thresholds, Partner Center identities) go under `env.unmanaged` with a reason.

## Layout

| File | Role |
| --- | --- |
| [`resources.json`](./resources.json) | Desired state |
| [`lib/diff.mjs`](./lib/diff.mjs) | Pure: desired Graph and ARM bodies, diffs, secret policy, plan formatting |
| [`lib/azure.mjs`](./lib/azure.mjs) | `az account` identity and tokens. Graph, ARM and Key Vault REST calls. |
| [`lib/provision.mjs`](./lib/provision.mjs) | Read state, plan, apply, verify, env handoff |
| [`lib/secret-store.mjs`](./lib/secret-store.mjs) | The 600-mode local secret copy outside the repo |
| [`lib/code-scan.mjs`](./lib/code-scan.mjs) | Code-to-manifest drift scan |
| [`../../../scripts/microsoft-provision.mjs`](../../../scripts/microsoft-provision.mjs) | CLI |

Exit codes: `0` done, `1` error or `--verify` found work remaining, `2` not signed in to Azure (the plan for an empty tenant is still printed), `3` Azure CLI not installed.

Tests: `npx vitest run tests/microsoft-provision.test.js`. They run a full `--apply` against an in-memory tenant ([`tests/fixtures/microsoft-provision/fake-cloud.mjs`](../../../tests/fixtures/microsoft-provision/fake-cloud.mjs)) that answers the documented Graph, ARM and Key Vault REST calls. The tests capture every log line and assert that no issued secret appears in any of them.
