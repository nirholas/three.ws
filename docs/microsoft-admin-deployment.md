# Microsoft IT admin deployment guide

Roll three.ws out to every seat from the admin consoles you already use. Nobody installs anything by hand: you approve the app once for the tenant, then push the Teams app, the web app and the Edge extensions through policy.

Everything on this page is generated from the real manifests into the [admin kit](../integrations/microsoft/admin-kit/README.md) (`node scripts/microsoft-admin-kit.mjs`), so the values below are the ones the kit contains.

- Admin consent page: [/enterprise/admin-consent](https://three.ws/enterprise/admin-consent)
- Kit: [integrations/microsoft/admin-kit/](../integrations/microsoft/admin-kit/README.md)
- Generator and tests: `scripts/microsoft-admin-kit.mjs`, `scripts/lib/microsoft-admin-kit.mjs`, `tests/microsoft-admin-kit.test.js`
- Related: [Enterprise sign-in and SCIM](enterprise-sso.md), [Trust center](https://three.ws/trust)

## Which parts do you need

| You want | Do | Needs |
| --- | --- | --- |
| People to sign in without a consent prompt | [Step 1: admin consent](#1-approve-the-sign-in-app-once) | Entra Global, Privileged Role, Application or Cloud Application Administrator |
| three.ws inside Teams, pinned for a group | [Step 2: Teams](#2-teams-install-and-pin-for-a-group) | Teams administrator |
| three.ws as an app on every managed Edge | [Step 3: web app](#3-edge-install-the-web-app) | Intune or Group Policy administrator |
| The browser extensions on every managed Edge | [Step 4: extensions](#4-edge-install-the-extensions) | Intune or Group Policy administrator |
| All of it | Steps 1 to 4 in order | The roles above |

Steps are independent. Do only the ones you need.

## 1. Approve the sign-in app once

three.ws signs people in with one multitenant Microsoft Entra application. Without tenant-wide consent, a user in a locked-down tenant sees "Your organisation has to approve three.ws" at their first sign-in.

1. Open [/enterprise/admin-consent](https://three.ws/enterprise/admin-consent). It lists the permissions in plain language:
   - Sign you in (`openid`), basic profile (`profile`), email address (`email`): identify the person and find their account.
   - Stay signed in (`offline_access`).
   - Read their own profile (`User.Read`).
   All are delegated, so they only apply while a person is signed in. None reads mail, files, chats or other people.
2. Optional: enter your domain or tenant id to send the administrator straight to your tenant. Select **Approve for my organisation**, or **Copy link for an administrator** to send it to someone with the right role.
3. Sign in as the administrator and select **Accept**. Microsoft returns you to the page, which shows your tenant id and the next steps.

If you decline, the page says so and nothing changes. If the account lacks the role, it names the roles that can approve.

Verify: in the Entra admin center, Enterprise applications, the three.ws application is listed with Permissions showing "Admin consent".

Rollback: delete the three.ws enterprise application in the Entra admin center.

## 2. Teams: install and pin for a group

1. Teams admin center, **Teams apps > Manage apps**, search for three.ws and set it to **Allowed**. Make sure the app permission policy that applies to the group allows it.
2. Install the Teams module and run the kit script as a Teams administrator. Always preview first:

```powershell
Install-Module MicrosoftTeams -Scope CurrentUser
./Deploy-ThreeWsTeams.ps1 -TeamsAppId <app id> -GroupId <group object id> -WhatIf
./Deploy-ThreeWsTeams.ps1 -TeamsAppId <app id> -GroupId <group object id>
```

`<app id>` is the app id shown for three.ws in Manage apps. `<group object id>` is the Entra group's object id. The script creates (or updates) a Teams app setup policy named `three.ws` that installs and pins the app, keeping any apps already in that policy, and assigns it to the group at rank 1.

Without PowerShell: Teams admin center, **Teams apps > Setup policies > Add**, name it, under **Installed apps** and **Pinned apps** add three.ws, then **Manage users > Group policy assignment** and assign it to the group.

Verify: a member of the group restarts Teams. Group assignments apply within hours and can take up to 24. three.ws appears in the app bar.

Rollback: `./Deploy-ThreeWsTeams.ps1 -TeamsAppId <app id> -GroupId <group object id> -Remove` removes the group assignment and the policy.

## 3. Edge: install the web app

The policy is `WebAppInstallForceList`. The value is generated from the web app manifest (start page, `window` launch container, desktop shortcut):

```json
[
  {
    "url": "https://three.ws/?source=pwa",
    "launch_container": "window",
    "create_desktop_shortcut": true,
    "fallback_app_name": "three.ws"
  }
]
```

**Intune.** Devices > Configuration > Create > New policy > Windows 10 and later > Settings catalog. Add **Configure list of force-installed Web Apps** in the Microsoft Edge category, enable it, paste the JSON, assign to a device group. Step by step: [intune-settings-catalog.md](../integrations/microsoft/admin-kit/intune-settings-catalog.md).

**Group Policy.** Install the Edge ADMX templates, then Computer Configuration > Administrative Templates > Microsoft Edge > Applications > **Configure list of force-installed Web Apps**: Enabled, paste the JSON.

**No management tooling (pilot or image).** Import `three-ws-edge-policies.reg`, or run `./Set-ThreeWsEdgePolicy.ps1 -WhatIf` and then without `-WhatIf` from an elevated prompt. The script merges with policies already on the machine.

**macOS and Linux.** Place `edge-policies.json` in the Edge managed policy folder (`/etc/opt/edge/policies/managed/` on Linux, or deliver it as a configuration profile on macOS).

Verify: `edge://policy` shows `WebAppInstallForceList` with status OK after **Reload policies**, and `edge://apps` lists three.ws.

Rollback: remove the setting from the Intune policy or GPO. For the script: `./Set-ThreeWsEdgePolicy.ps1 -Remove`. The app uninstalls at the next policy refresh.

## 4. Edge: install the extensions

The policy is `ExtensionInstallForcelist`, one `<extension id>;<update url>` entry per extension. The Edge Add-ons update URL is `https://edge.microsoft.com/extensionwebstorebase/v1/crx`.

The kit only includes extensions that have an Edge Add-ons id, listed in [extensions/edge-store-ids.json](../extensions/edge-store-ids.json). Extensions still waiting for store publication are left out, and the kit README says which. To force-install an unpublished one before then, self-host a CRX and an update manifest on your own HTTPS server and use `<extension id>;<your update manifest URL>` in the same policy.

Intune: add **Control which extensions are installed silently** in the same settings catalog policy. Group Policy: Administrative Templates > Microsoft Edge > Extensions > **Control which extensions are installed silently**.

Verify: `edge://extensions` shows the extension marked "Installed by your organization". Rollback: remove the entry.

## Verification checklist

- [ ] Entra: the three.ws enterprise application exists with admin consent.
- [ ] A test user signs in at three.ws with a work account and sees no consent prompt.
- [ ] Teams: a test group member sees three.ws pinned (allow up to 24 hours).
- [ ] Edge: `edge://policy` shows each policy with status OK.
- [ ] Edge: `edge://apps` lists three.ws, and `edge://extensions` lists the force-installed extensions.
- [ ] The network allows `https://three.ws` (see the FAQ).

## FAQ

**Where is our data processed?** In the United States: the application runs on Google Cloud Run in `us-central1` and the database is in AWS `us-west-2`. three.ws does not offer other regions today. See the [trust center](https://three.ws/trust) and its [subprocessor list](https://three.ws/trust/subprocessors).

**What can three.ws read in our tenant?** Only what the consent page lists: the signed-in person's own profile and email. No mail, files, chats, calendars or directory reads. Optional provisioning (SCIM) is a separate token you create and can revoke ([Enterprise sign-in and SCIM](enterprise-sso.md)).

**Which domains must the network allow?** Everything required runs over HTTPS (port 443) from `three.ws`. Sign-in also uses `login.microsoftonline.com`. Some features call extra services (AI model providers, payments, file storage); the [subprocessor list](https://three.ws/trust/subprocessors) names each one, so you can allow only the features you enable.

**Can users still uninstall the web app?** Force-installed web apps cannot be removed by the user while the policy is set. Remove the policy to let them.

**How do I undo everything?** Use the rollback line in each step: delete the enterprise application (consent), run the Teams script with `-Remove`, and remove the Edge policies.
