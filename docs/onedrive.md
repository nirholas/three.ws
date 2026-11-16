# OneDrive and SharePoint in Forge

Forge can read photos from, and save finished models to, Microsoft OneDrive (personal and work) and SharePoint document libraries.

- **From OneDrive or SharePoint** (beside the photo views in image mode) opens Microsoft's File Picker in a dialog. It shows images only, and you can select up to six. Each file is downloaded through Microsoft Graph and goes through the same path as a dropped photo: type check, photo preparation, the 8 MB cap and slot handling.
- **Save to OneDrive** (in the Download menu) asks for a folder in the same picker, then uploads three files:
  - the GLB (`<title>.glb`),
  - a poster PNG of the current viewer frame (`<title> poster.png`),
  - for a stored model, the one-slide PowerPoint deck (`<title>.pptx`).

  A toast shows per-file progress, has a Cancel button and links to each saved file and to the folder. A name that already exists gets a numbered copy (`conflictBehavior=rename`), so nothing is overwritten.

Both actions are hidden unless the server is configured with the three.ws Entra app id (see below).

## Using it

1. Click **From OneDrive or SharePoint** or **Save to OneDrive**.
2. The first time, a Microsoft sign-in window opens. Choose a personal or work account, then approve file access. The approval is asked for on that click, never at three.ws sign-in.
3. Pick photos, or pick a folder and click **Save here**.

**Switch account** in the dialog header signs out of the current Microsoft account in this tab and shows the account chooser. The sign-in is kept in `sessionStorage`, so it ends when the tab closes.

### What you will see when something goes wrong

| Situation | What happens |
| --- | --- |
| You close the picker or the sign-in window | Nothing changes and no error is shown. |
| You decline the permission prompt | A message saying three.ws needs file permission, with the option to add the photo from your device instead. |
| Your organization requires admin approval | The message says so and points the admin at the consent steps below. |
| The session expires mid-flow | A silent token refresh first. If Microsoft needs you, a **Continue** button appears so the sign-in popup opens from a fresh click and is not blocked. |
| Graph throttles (429 or 503) | Waits for `Retry-After` (capped at 60 s), retries up to four times, then resumes an interrupted upload from the server's `nextExpectedRanges`. |
| OneDrive is full | "That OneDrive or library is full…" on the affected file. The partial upload session is deleted, and the other files still save. |
| Offline | The action refuses to start and says to reconnect. |
| A PowerPoint deck cannot be built (private model, unsaved mesh edits) | Only the PPTX row fails, with the reason. The GLB and poster still save. |

## How it works

| Piece | File |
| --- | --- |
| Picker protocol, Graph requests, upload chunker, error mapping (pure, unit tested) | [src/microsoft-graph/onedrive-core.js](../src/microsoft-graph/onedrive-core.js) |
| MSAL session and the picker host (loaded on first use) | [src/microsoft-graph/onedrive-client.js](../src/microsoft-graph/onedrive-client.js) |
| MSAL popup redirect bridge, served at `/auth/microsoft/redirect` | [pages/microsoft-auth-redirect.html](../pages/microsoft-auth-redirect.html), [src/microsoft-graph/redirect-bridge.js](../src/microsoft-graph/redirect-bridge.js) |
| Forge UI: photo button, picker dialog, export row, progress toast | [src/forge-onedrive.js](../src/forge-onedrive.js) |
| Feature flag and client id | `oneDrive` in [api/config.js](../api/config.js) |
| Tests | [tests/onedrive-core.test.js](../tests/onedrive-core.test.js) |

Notes on the implementation:

- **Auth.** [MSAL Browser](https://github.com/AzureAD/microsoft-authentication-library-for-js) (`@azure/msal-browser`) runs as a public SPA client on authority `common`, so both personal and work accounts work. No client secret is used in the browser.
- **Picker.** File Picker v8 runs in an iframe inside a `<dialog>` rather than a second popup. The sign-in popup uses up the click's user activation, so a second popup would be blocked.
  - Personal accounts load `https://onedrive.live.com/picker`.
  - Work accounts load the tenant's `-my.sharepoint.com` host, read from `GET /me/drive`.
  - The picker asks for tokens over a `MessagePort`. Every command is acknowledged, then answered.
- **Downloads.** Each picked item is fetched through its pre-authenticated `@microsoft.graph.downloadUrl`. The `/content` redirect would drop the Authorization header.
- **Uploads.** Files up to 4 MB use a single PUT. Larger files use a Graph upload session, sent in 10 MiB chunks (a multiple of 320 KiB), with progress from each chunk. A failed session is deleted.

## Owner setup (Entra app registration)

The feature uses the existing multitenant three.ws Entra app (the one behind `MS_ENTRA_SSO_CLIENT_ID`).

**Automated.** `npm run microsoft:provision -- --apply` ([provisioning README](../integrations/microsoft/provisioning/README.md)) reconciles the `sso` app from [resources.json](../integrations/microsoft/provisioning/resources.json). It adds:

- the Single-page application redirect URI `https://three.ws/auth/microsoft/redirect` (`spaRedirectUris`; the existing Web platform redirects are untouched),
- the delegated Microsoft Graph permission `Files.ReadWrite`: read the photo you pick, write the model files you save. Personal accounts get the picker page's own `OneDrive.ReadWrite` scope with this consent (listed under `implicitScopes`).

It is additive: a redirect or permission someone added by hand is kept and reported. `npm test` fails if the code asks for a redirect or scope that resources.json does not list (tests/microsoft-provision.test.js).

**By hand, once** (the provisioner manages Microsoft Graph permissions only). In the Entra admin center, under App registrations > three.ws:

1. **API permissions > Add a permission > SharePoint > Delegated:** `MyFiles.Write` and `AllSites.Read`. The work-account picker page authenticates to the tenant's SharePoint host with `<host>/.default` and needs these.
2. **Optional, for local dev:** under Authentication > Single-page application, add `http://localhost:3000/auth/microsoft/redirect` and `http://localhost:3136/auth/microsoft/redirect`.
3. **Supported account types** must stay "Accounts in any organizational directory and personal Microsoft accounts".

None of these permissions need admin consent by default. Tenants that restrict user consent can grant them once for everyone through the existing `/enterprise/admin-consent` page.

**Turn it on:** `MS_ENTRA_SSO_CLIENT_ID` on the Cloud Run service (it is already set wherever Sign in with Microsoft is live). `/api/config` then returns `oneDrive.enabled: true`, and both actions appear in Forge.

## Privacy

Files go straight between the browser and Microsoft Graph. three.ws servers never see your Microsoft tokens or the files you pick. The only exception is that saving fetches the PPTX from three.ws, as the regular download does. Tokens live in this tab's `sessionStorage` and are cleared by **Switch account** or by closing the tab.
