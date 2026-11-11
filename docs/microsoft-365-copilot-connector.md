# Microsoft 365 Copilot connector

Index a three.ws account's AI agents, Forge 3D models and avatars into an organization's Microsoft 365 tenant. People in the organization find them in Microsoft Search (Office.com, SharePoint, Bing at work) and can ask Microsoft 365 Copilot about them, and only the people the admin chooses can see them. Results link back to three.ws.

The connector uses the Microsoft Graph connectors API (`/external/connections`). It runs on the customer's own tenant: three.ws never reads mail, files, users or anything else in the tenant, and never stores Microsoft credentials for the customer.

- Settings page: [/settings/microsoft-365](https://three.ws/settings/microsoft-365) (Settings > Workspace > Microsoft 365)
- Library: `api/_lib/m365-connector.js`
- API: `api/microsoft-365/[action].js`
- Cron: `api/cron/m365-connector-sync.js` (every 15 minutes)
- Tables: `m365_connections`, `m365_connector_items` (migration `20261111160500_m365_copilot_connector.sql`)
- Tests: `tests/m365-connector.test.js`
- Live probe: `node scripts/m365-connector-probe.mjs`

## For the Microsoft 365 admin

### Connect

1. Sign in to three.ws with the account whose content you want indexed and open **Settings > Microsoft 365**.
2. Click **Connect Microsoft 365**. Microsoft asks you, as an administrator of your tenant, to consent to two application permissions for the three.ws app:
   - `ExternalConnection.ReadWrite.OwnedBy`: create and manage the search connections this app owns.
   - `ExternalItem.ReadWrite.OwnedBy`: write items into those connections.

   Both are limited to connections the three.ws app created. They give no access to any other data in the tenant. Microsoft only lets a Global Administrator or Privileged Role Administrator consent to Microsoft Graph application permissions. A Search Administrator can manage the connection in the admin center afterwards.
3. Microsoft returns you to three.ws, which creates a connection named **three.ws agents and 3D models** and registers its schema. Microsoft takes 5 to 15 minutes to apply a schema. The settings page refreshes on its own and shows **Syncing** when it is ready; the first sync runs straight after.

The connection also appears in the Microsoft 365 admin center under **Settings > Search & intelligence > Data sources**, where you can watch its item count and turn on the result type and vertical if you want a dedicated three.ws tab in search.

### Choose who can see the items

| Audience | ACL sent to Microsoft | Use it when |
| --- | --- | --- |
| Everyone in the organization (default) | `everyoneExceptGuests` with your tenant id | The content is fine for every member. Guests never see it. |
| One Entra group | `group` with the group's object id | Only a team should see it. This is also how teammates who never signed in to three.ws with Microsoft get access: add them to the group. |
| Only me | `user` with your Entra object id | You want your own items in your own Copilot. Needs your three.ws account linked to a Microsoft work account in this tenant (sign in with Microsoft once). |

Whatever the audience, the person who connected the account is granted their own items too whenever their three.ws account is linked to a Microsoft identity in that tenant. Changing the audience re-sends every item with the new ACL on the next sync.

### What is indexed

Only public items, unless **Include private items** is ticked (they are then visible to the chosen audience only):

| Kind | Source | Title | Text Copilot reads |
| --- | --- | --- | --- |
| `agent` | Your agents that are not deleted | Agent name | Description, greeting, persona summary (first ~2,400 characters of the persona prompt), skills, category |
| `model` | Finished Forge models (latest refinement only) | The prompt | Prompt, category, refinement instruction, format and size |
| `avatar` | Your avatars that are not deleted | Avatar name | Description, visual description, tags |

Every item also carries `description`, `tags` (tags, skills and categories), `createdBy` (your three.ws display name), `createdDateTime`, `lastModifiedDateTime`, `iconUrl` (the profile image, model preview or avatar thumbnail), `url` (the three.ws page) and `visibility`. `itemType` tells the three kinds apart and is refinable, so a search vertical can filter by it.

Links to `https://three.ws/agent/<id>`, `https://three.ws/m/<id>` and `https://three.ws/avatars/<id>` pasted into Teams or Outlook resolve to their indexed item through the connection's URL resolvers.

### Sync

- Every 15 minutes three.ws deletes items that left (deleted, made private, or a Forge model replaced by a refinement) and pushes items that changed since the last run. Unchanged items are never re-sent: each item's payload is hashed and compared.
- **Full re-sync** on the settings page re-sends everything immediately (once a minute at most). Use it after renaming your account, or if search looks out of date.
- When Microsoft throttles (HTTP 429), three.ws waits exactly as long as Graph's `Retry-After` header asks, retries, and if the run still cannot finish it stops, keeps its place and resumes at the time shown as **Next attempt**.

### Disconnect

**Disconnect** deletes the connection from your tenant, which removes every indexed item from Microsoft Search and Copilot within minutes, then deletes the stored link on three.ws. Your content on three.ws is not touched. If consent was already revoked, three.ws still removes its side and tells you to delete the connection in the admin center under **Data sources**.

To revoke the app entirely, remove **three.ws** in Entra ID > Enterprise applications. The next sync reports the lost consent on the settings page.

### Errors and their fixes

The settings page shows the last error with the fix. The common ones:

| Shown as | Cause | Fix |
| --- | --- | --- |
| Only a Microsoft 365 administrator can grant this consent | Someone without the right role started the connect flow | Ask a Global Administrator or Privileged Role Administrator to click Connect |
| Consent was cancelled | Cancel was pressed on Microsoft's consent page | Connect again and accept |
| Your tenant no longer has consent / Microsoft rejected the three.ws app | The app was removed from Enterprise applications or consent revoked | Reconnect |
| Microsoft refused the request | Consent is missing one of the two permissions | Reconnect and accept both |
| Microsoft Graph asked three.ws to slow down | Throttling | Nothing; it resumes automatically |
| Your tenant hit a Microsoft Graph connector limit | Tenant connection or item quota reached | Remove unused connections in Data sources, then Full re-sync |

## Data handling

- **Stored on three.ws:** the tenant id, the connection id, the audience and group id you chose, sync timestamps, the last error, and for each indexed item its id, kind, a hash of what was sent and when. No Microsoft tokens are stored: each run requests a short-lived app-only token from `login.microsoftonline.com` and discards it.
- **Sent to Microsoft:** only the fields listed above for items the account chose to index, with the ACL you chose. Nothing is sent before an admin consents.
- **Deleted:** on disconnect, both the connection in your tenant and every row above. Deleting a three.ws account deletes these rows, after which three.ws can no longer reach the tenant copy, so disconnect first (or delete the connection under Data sources).

## For three.ws operators

The connector reuses the multitenant Entra app that the Microsoft Marketplace sign-in uses.

1. In the Entra admin center, on that app (**App registrations > the three.ws app > API permissions**), add the Microsoft Graph **application** permissions `ExternalConnection.ReadWrite.OwnedBy` and `ExternalItem.ReadWrite.OwnedBy`. Do not grant admin consent in the publisher tenant unless you want to index into it; customers consent in their own tenant.
2. Under **Authentication > Web > Redirect URIs**, add `https://three.ws/api/microsoft-365/connect/callback` (and `http://localhost:3000/api/microsoft-365/connect/callback` for local development).
3. Set `MS_ENTRA_SSO_CLIENT_ID` and `MS_ENTRA_SSO_CLIENT_SECRET` on the Cloud Run service with `gcloud run services update three-ws-api --region us-central1 --update-env-vars ...` (never `--set-env-vars`). Without them the settings page explains the connector is not available yet and the cron answers `skipped: not_configured`.
4. Check end to end with a Microsoft 365 developer tenant: connect, wait for **Syncing**, search for an agent name at office.com, then run `M365_PROBE_TENANT=<tenant id> node scripts/m365-connector-probe.mjs` to list the connection Graph holds.

### API

All routes need a signed-in session; writes need the `x-csrf-token` header (sent automatically by `apiFetch`).

| Route | Body | Returns |
| --- | --- | --- |
| `GET /api/microsoft-365/status` | | `{ configured, connected, status, itemsIndexed, counts, lastSyncAt, lastFullSyncAt, nextAttemptAt, lastError, audience, groupId, includePrivate, tenantId, connectionId, ownerInTenant }` |
| `GET /api/microsoft-365/connect/start` | | 302 to Microsoft's admin consent page |
| `GET /api/microsoft-365/connect/callback` | | 302 to `/settings/microsoft-365?connected=1` or `?error=<code>` |
| `PATCH /api/microsoft-365/settings` | `{ audience: "organization" \| "group" \| "owner", group_id, include_private }` | The status object |
| `POST /api/microsoft-365/resync` | | `{ run, status }` |
| `POST /api/microsoft-365/disconnect` | | `{ removed, remoteDeleted, remoteError, connectionId, tenantId }` |

### Schema

Registered with `baseType: microsoft.graph.externalItem`. `validateSchema()` checks it against Microsoft's documented rules (names of at most 32 alphanumeric characters, only string types searchable, refinable implies queryable and not searchable, known labels used once, descriptions of at most 200 characters, 1 to 128 properties) in the unit tests, so a bad edit fails `npm test` rather than a schema operation in a customer tenant.

| Property | Type | Flags | Label |
| --- | --- | --- | --- |
| `title` | string | searchable, queryable, retrievable | title |
| `description` | string | searchable, retrievable | |
| `itemType` | string | queryable, retrievable, refinable | itemType |
| `tags` | stringCollection | searchable, queryable, retrievable | tags |
| `url` | string | retrievable | url |
| `iconUrl` | string | retrievable | iconUrl |
| `createdBy` | string | searchable, queryable, retrievable | createdBy |
| `createdDateTime` | dateTime | queryable, retrievable, refinable | createdDateTime |
| `lastModifiedDateTime` | dateTime | queryable, retrievable, refinable | lastModifiedDateTime |
| `visibility` | string | queryable, retrievable, refinable | |

Changing the schema means bumping `SCHEMA_VERSION` and registering it again with a full re-sync; check Microsoft's schema update rules first, because some changes (removing or retyping a property) need a new connection.

Microsoft and Microsoft 365 are trademarks of the Microsoft group of companies. three.ws and Microsoft have announced a partnership; this connector is built by three.ws on Microsoft's public Graph connectors API.
