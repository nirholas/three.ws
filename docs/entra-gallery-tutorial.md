# Tutorial: Microsoft Entra SSO and automatic user provisioning for three.ws

This tutorial shows a Microsoft Entra administrator how to connect three.ws to their organisation: single sign-on (SSO) with OpenID Connect, launch from My Apps, and automatic user provisioning and deprovisioning over SCIM 2.0.

> **Gallery status.** three.ws has requested a listing in the Microsoft Entra app gallery, and the request is pending review. Until the listing is live, every step below works the same with a non-gallery application. The one difference, in [Before the gallery listing is live](#before-the-gallery-listing-is-live), is how you add the app.

When you integrate three.ws with Microsoft Entra ID, you can:

- Control in Microsoft Entra ID who has access to three.ws.
- Let people sign in to three.ws with their Microsoft Entra account, and open it from My Apps and the Microsoft 365 app launcher.
- Add people to your three.ws team when you assign them, keep their names and emails current, and end their access the moment you disable or unassign them.

## Prerequisites

- A Microsoft Entra tenant. A [free account](https://azure.microsoft.com/free/) works for testing.
- One of these Microsoft Entra roles: Cloud Application Administrator, Application Administrator, or Global Administrator. Granting tenant-wide consent and claiming the tenant on three.ws both need one of them; claiming also accepts Privileged Role Administrator.
- A three.ws account that owns a team. Create one at [three.ws/teams](https://three.ws/teams) if you do not have one yet.

## Scenario description

- three.ws supports **SP-initiated** SSO (people select **Continue with Microsoft** at [three.ws/login](https://three.ws/login)) and **IdP-initiated** launch from My Apps (the tile opens the three.ws sign-on URL, which signs the person straight in).
- three.ws supports **just-in-time** user creation: anyone your tenant allows can sign in, and a three.ws account is created on first sign-in.
- three.ws supports **automatic user provisioning and deprovisioning** of users and groups over SCIM 2.0.
- three.ws is a multitenant application on the Microsoft identity platform. There is no per-customer certificate, metadata file or reply URL to configure.

## Add three.ws from the gallery

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as at least a Cloud Application Administrator.
2. Go to **Identity > Applications > Enterprise applications > New application**.
3. In **Browse Microsoft Entra Gallery**, search for **three.ws** and select it.
4. Select **Sign up for three.ws**. You are sent to three.ws to sign in with Microsoft and accept the permissions. Select **Consent on behalf of your organization** so nobody else is asked. The enterprise application appears in your tenant as soon as consent is granted.

You can also grant tenant-wide consent from three.ws: an administrator opens [three.ws/enterprise/admin-consent](https://three.ws/enterprise/admin-consent), enters the tenant's domain or ID, and approves on Microsoft's own consent page.

### Before the gallery listing is live

Use the same multitenant app without the gallery tile:

1. An administrator signs in once at [three.ws/login](https://three.ws/login) with **Continue with Microsoft** and accepts for the organisation, or grants consent at [three.ws/enterprise/admin-consent](https://three.ws/enterprise/admin-consent). This creates the **three.ws** enterprise application in the tenant.
2. Find it under **Enterprise applications** (filter **Application type: All applications**, search "three.ws") and continue with the sections below.
3. For SCIM, if you prefer to keep provisioning in a separate application, create one with **New application > Create your own application > Integrate any other application you don't find in the gallery (Non-gallery)**. The [enterprise sign-in guide](enterprise-sso.md#scim-setup) walks through that path.

## Configure Microsoft Entra SSO

three.ws uses OpenID Connect, so there is nothing to upload or paste on the Single sign-on page.

1. In the three.ws enterprise application, open **Properties**:
   - **Enabled for users to sign-in?** Yes.
   - **Assignment required?** Choose **Yes** to let only assigned people and groups sign in, or **No** to let everyone in the tenant sign in.
   - **Visible to users?** Yes, so the tile shows in My Apps.
2. Open **Users and groups** and assign the people or groups who should use three.ws.
3. To require MFA, a compliant device or a trusted location, target the three.ws application in a **Conditional Access** policy. three.ws honours whatever Entra enforces at sign-in.

### What three.ws receives

| Item | Value |
| --- | --- |
| Authority | `https://login.microsoftonline.com/common/v2.0` (any work or school tenant, and personal Microsoft accounts) |
| Sign-on URL (My Apps) | `https://three.ws/sso/microsoft` |
| Redirect URI | `https://three.ws/api/auth/microsoft/callback` |
| Delegated permissions | Microsoft Graph `openid`, `profile`, `email`, `offline_access`, `User.Read` |
| Claims used | `tid`, `oid`, `name`, `preferred_username`, `email` with `xms_edov`, and `wids` (only to check an administrator role when claiming a tenant) |

Accounts are keyed by tenant ID and object ID (`tid:oid`), never by email or UPN, so a renamed person keeps the same account. The ID token's issuer must be `https://login.microsoftonline.com/{tid}/v2.0` for the token's own tenant, and anything else is rejected.

## Configure three.ws SSO

Claim your tenant so people from your organisation find your team when they sign in:

1. On three.ws, open your team and go to **Settings > Your organisation**.
2. Select **Claim with a Microsoft admin account** and sign in as an administrator of the tenant.
3. Choose the join mode: **Offer the team** (people see an invitation after sign-in) or **Join automatically**.

Without a claim, SSO still works: people sign in to their own three.ws accounts, they just are not connected to your team.

## Create a three.ws test user

You do not need to create users by hand. Either:

- assign a test user to the application and let them sign in (just-in-time creation), or
- turn on provisioning (below) and use **Provision on demand** for the test user.

## Test SSO

1. **From My Apps.** Sign in to [myapps.microsoft.com](https://myapps.microsoft.com) as the test user and select the **three.ws** tile. The tile opens `https://three.ws/sso/microsoft`, which starts the Entra sign-in without asking the person to pick an account again, and lands them on their three.ws dashboard.
2. **From three.ws.** In a private window, go to [three.ws/login](https://three.ws/login), select **Continue with Microsoft**, and sign in as the test user.
3. **Deep link.** `https://three.ws/sso/microsoft?next=/teams` lands on the teams page instead of the dashboard. A `next` that points off three.ws is ignored.
4. **Home realm hint.** `https://three.ws/sso/microsoft?domain_hint=contoso.com` (or `?tenant=contoso.com`) sends people straight to your organisation's sign-in page, and `login_hint=user@contoso.com` pre-fills the account.

## Configure automatic user provisioning

### Step 1: Plan the provisioning deployment

- Decide who to provision: assign users and groups to the application, and keep the default scope **Sync only assigned users and groups**.
- Each three.ws team holds one Entra tenant. The SCIM token you generate on three.ws reaches only that team.
- Provisioning is per team, so claim the tenant first (see [Configure three.ws SSO](#configure-threews-sso)).

### Step 2: Configure three.ws to support provisioning

1. On three.ws, open the team and go to **Settings > Your organisation > SCIM provisioning**.
2. Copy the **Tenant URL**: `https://three.ws/scim/v2`.
3. Select **Generate token** and copy it. It starts with `tws_scim_`, is shown once, and does not expire. three.ws stores only its hash. **Rotate token** issues a new one and stops the old one at once.

### Step 3: Add three.ws from the gallery

If you followed [Add three.ws from the gallery](#add-threews-from-the-gallery), use the same enterprise application.

### Step 4: Define who is in scope

Assign the people and groups who should be on the team under **Users and groups**. To narrow further, add scoping filters on the user mapping (for example `department EQUALS Design`).

### Step 5: Configure automatic provisioning

1. In the three.ws enterprise application, open **Provisioning** and select **Get started** (or **New configuration**).
2. Set **Provisioning Mode** to **Automatic**.
3. Under **Admin Credentials**, enter `https://three.ws/scim/v2` as **Tenant URL** and the `tws_scim_` token as **Secret Token**.
4. Select **Test Connection**. A success message confirms the URL and token.
5. Optionally enter a **Notification Email** and select **Send an email notification when a failure occurs**.
6. Select **Save**.
7. Under **Mappings**, review **Provision Microsoft Entra ID Users**. The defaults work as they are:

   | Microsoft Entra ID attribute | three.ws attribute | Matching precedence | Stored by three.ws |
   | --- | --- | --- | --- |
   | `userPrincipalName` | `userName` | 1 | Yes |
   | `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | | Yes |
   | `mail` | `emails[type eq "work"].value` | | Yes |
   | `displayName` | `displayName` | | Yes |
   | `givenName` | `name.givenName` | | Yes |
   | `surname` | `name.familyName` | | Yes |
   | `mailNickname` or `objectId` | `externalId` | | Yes |
   | `jobTitle`, `department`, `manager`, `employeeId` and other default rows | `title`, `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:*` and others | | Accepted and ignored |

   Rows three.ws does not store can stay. three.ws accepts them without error.

8. Review **Provision Microsoft Entra ID Groups**:

   | Microsoft Entra ID attribute | three.ws attribute | Matching precedence |
   | --- | --- | --- |
   | `displayName` | `displayName` | 1 |
   | `objectId` | `externalId` | |
   | `members` | `members` | |

9. Set **Provisioning Status** to **On** and select **Save**.

The first cycle starts shortly after and then runs about every 40 minutes. three.ws accepts at least 50 requests per second per tenant, so a first sync of a large directory is not throttled.

### Step 6: Monitor your deployment

- **Entra:** the **Provisioning logs** show every request and its result; **Provision on demand** tests a single person.
- **three.ws:** the SCIM section shows the token status, when it was last used and the last sync. The People list shows everyone Entra provisioned. **Admin activity** records every provisioning change with its actor and can be downloaded as CSV or JSON.

What each Entra action does on three.ws:

| Entra action | Effect on three.ws |
| --- | --- |
| Assign a person | A pending person on the team. They become a member the first time they sign in with Microsoft. |
| Change a name or email | The record updates. |
| Disable or unassign | Team access ends at once and the sessions they opened through your tenant are signed out. |
| Re-enable or reassign | Access is restored. |
| Delete | Removed from SCIM, access ended, sessions signed out, and they cannot rejoin by sign-in. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "Your organisation has not given you access to three.ws yet" (AADSTS50105) | **Assignment required** is Yes and the person is not assigned. Assign them or their group under **Users and groups**. |
| "three.ws is turned off in your organisation's Microsoft Entra directory" (AADSTS7000112) | **Enabled for users to sign-in?** is No, or the service principal was deleted. Turn it back on in **Properties**, or grant consent again. |
| "Your organisation's sign-in policy blocked this sign-in" (AADSTS53000 to 53004) | A Conditional Access policy blocked the sign-in (device, location, MFA registration). Check the sign-in log entry for the policy name. |
| "Your organisation has to approve three.ws" (AADSTS65001, AADSTS90094) | The tenant does not let users consent to apps. An administrator grants consent once at [three.ws/enterprise/admin-consent](https://three.ws/enterprise/admin-consent) or with **Permissions > Grant admin consent** in the enterprise application. |
| "That Microsoft account belongs to a different organisation" | The person signed in with an account from another tenant during a tenant claim or re-authentication. Sign in with the right account. |
| My Apps tile asks for an account every time | The tile must point to `https://three.ws/sso/microsoft`. `/login` shows the account picker on purpose. |
| Test Connection fails with 401 | The token was rotated or revoked, or the tenant was unclaimed. Generate a new token. |
| Test Connection fails with 404 | The Tenant URL is wrong. Use `https://three.ws/scim/v2` exactly. |
| Provisioning log shows 409 Conflict on create | A person with that `userName` already exists on the team, compared case-insensitively. Entra matches the existing record on the next cycle. |
| Provisioning log shows 429 | More than 3,000 requests per minute for the team. Entra backs off and retries on its own. |
| A provisioned person is not a member yet | They have not signed in with Microsoft. They join on first sign-in, matched by `userPrincipalName` or email. |

## More resources

- [Enterprise sign-in and SCIM provisioning](enterprise-sso.md): the full SSO and SCIM reference, filters, PATCH shapes and limits.
- [Microsoft IT admin deployment guide](microsoft-admin-deployment.md): roll three.ws out to every seat (Teams, Edge web app, extensions).
- [Microsoft identity platform: multitenant apps](https://learn.microsoft.com/entra/identity-platform/howto-convert-app-to-be-multi-tenant) and [SCIM provisioning with Microsoft Entra ID](https://learn.microsoft.com/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups).

Microsoft, Microsoft Entra, Microsoft Entra ID, Microsoft 365 and My Apps are trademarks of the Microsoft group of companies. Their use here is only to describe compatibility.
