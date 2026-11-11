# Enterprise sign-in and SCIM provisioning (Microsoft Entra ID)

Sign in with Microsoft works for everyone: work, school and personal Microsoft accounts. On top of it, a team owner can claim their organisation's Microsoft Entra tenant so colleagues find the team the moment they sign in, and can let Microsoft Entra ID provision and deprovision people over SCIM 2.0.

- Sign-in: [/login](https://three.ws/login) (Continue with Microsoft). Link or unlink an existing account in [Settings > Sign-in methods](https://three.ws/dashboard/settings#sign-in-methods).
- Organisation settings: open a team you own at [/teams](https://three.ws/teams), then Settings > Your organisation.
- SCIM base URL: `https://three.ws/scim/v2`
- Code: `api/_lib/entra-oidc.js` (OpenID Connect), `api/auth/microsoft/[action].js` (sign-in round trip), `api/_lib/identities.js` (account linking rules), `api/_lib/team-enterprise.js` (tenant claims, people, tokens, events), `api/_lib/scim.js` and `api/scim/v2.js` (SCIM)
- Tables: `team_tenant_claims`, `team_people`, `team_scim_tokens`, `team_scim_groups`, `team_scim_group_members`, `team_enterprise_events` (migration `20261111160232_enterprise_sso_scim.sql`)
- Tests: `tests/entra-oidc.test.js`, `tests/identity-login-rules.test.js`, `tests/scim.test.js`, `tests/teams-ui-handlers.test.js`

## Sign in with Microsoft

The button uses one multitenant Entra app on the `common` authority, so any organisation and any personal Microsoft account can sign in without a per-customer setup.

- **Protocol.** Authorization code flow with PKCE (S256), a one-time `state` and `nonce` held in a ten-minute `__Host-msauth` cookie, and the ID token verified against Microsoft's published keys.
- **Issuer check.** The `common` authority means the issuer differs per organisation, so the check is strict per tenant: the token's `iss` must equal `https://login.microsoftonline.com/{tid}/v2.0` for the token's own `tid`. A token from one tenant presenting another tenant's issuer is rejected.
- **Identity.** The account is keyed by `tid:oid` (tenant id and object id), never by email or username, which people and admins can change. Accounts linked through a Microsoft Marketplace purchase use the same key, so they keep signing straight in.
- **Linking to an existing account** follows the rules Google sign-in follows, with no shortcuts:
  - A Microsoft identity already linked to an account signs in to that account.
  - If Microsoft vouches for the email (the `xms_edov` claim, or a verified primary email on a personal account) and it matches a verified three.ws account, the person sees a confirm page and must prove they own that account before the identity is linked.
  - An email Microsoft does not vouch for never reaches an existing account. A new account is created with a private placeholder address instead of the unproven one, and the person can add a real address later.
  - With no match, a new account is created.
- **Unlinking** in Settings requires proof from the last five minutes (your password, or a fresh Microsoft sign-in), and is refused when Microsoft is the account's only way in.

## Claim your organisation's tenant

A team can hold one Entra tenant, and a tenant can belong to one team.

1. Open your team, go to **Settings > Your organisation**, and select **Claim with a Microsoft admin account**.
2. Sign in as a directory administrator of the organisation. Accepted roles: Global Administrator, Privileged Role Administrator, Application Administrator or Cloud Application Administrator. These are the roles that can already consent to an app for the whole tenant. The sign-in is forced fresh, so a remembered session does not count.
3. Back on the team page the tenant shows as **Claimed**, with who verified it and when. **Re-verify** repeats the admin proof; **Unclaim** releases the tenant.

Choose what happens when someone from the tenant signs in with Microsoft:

- **Offer the team** (default). After sign-in they see an invitation to the team and choose Join or Decline.
- **Join automatically.** They are added as a member the first time they sign in.

Members from the tenant get read access to the team, including a private team. People you removed, or that SCIM deactivated or deleted, are never re-admitted by sign-in or automatic join. Personal Microsoft accounts are never matched to a tenant.

Unclaiming stops new joins and revokes the SCIM token. People already on the team keep their access until you remove them in the People list.

## SCIM setup

Provisioning lets Microsoft Entra ID add people to the team, keep their names and emails current, and remove their access when they leave or are unassigned. Claim the tenant first: the token only exists for a claimed tenant.

### 1. Generate the token on three.ws

1. Open the team, go to **Settings > Your organisation > SCIM provisioning**.
2. Copy the **Tenant URL** (`https://three.ws/scim/v2`).
3. Select **Generate token** and copy it. It starts with `tws_scim_` and is shown once; three.ws keeps only a hash. If you lose it, select **Rotate token**: the old token stops working at that moment.

### 2. Create the enterprise application in Microsoft Entra

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) as at least a Cloud Application Administrator.
2. Go to **Identity > Applications > Enterprise applications > New application**.
3. Select **Create your own application**, name it (for example "three.ws"), choose **Integrate any other application you don't find in the gallery (Non-gallery)**, and select **Create**.

### 3. Connect provisioning

1. In the new application, open **Provisioning** and select **Get started** (or **New configuration**).
2. Set **Provisioning Mode** to **Automatic**.
3. Under **Admin Credentials**, paste the Tenant URL into **Tenant URL** and the token into **Secret Token**.
4. Select **Test Connection**. Entra sends a filtered `GET /Users` with the token; a success message means the token and URL are right.
5. Select **Save**.

### 4. Check the mappings

The default mappings work without changes. three.ws stores these user attributes:

| Entra attribute (default mapping) | SCIM attribute | Used for |
| --- | --- | --- |
| `userPrincipalName` | `userName` | Matching the person's Microsoft sign-in to their provisioned record |
| `mail` | `emails[type eq "work"].value` | Matching and display |
| `displayName` | `displayName` | Display |
| `givenName`, `surname` | `name.givenName`, `name.familyName` | Display |
| `Switch([IsSoftDeleted], ...)` | `active` | Removing and restoring access |
| `mailNickname` or `objectId` | `externalId` | Entra's own matching key |

Other attributes in the default mapping, including the enterprise extension (department, manager, employee number), are accepted and not stored, so you do not need to delete them. Group provisioning is supported (`displayName`, `members`).

### 5. Assign people and start

1. Open **Users and groups** and assign the people or groups who should be on the team. With the default scope **Sync only assigned users and groups**, only they are provisioned.
2. Back in **Provisioning**, set **Provisioning Status** to **On** and select **Save**.
3. Entra runs the first cycle shortly after, then about every 40 minutes. To test one person immediately, use **Provision on demand**.

On three.ws, the SCIM section shows the token status, when it was last used and the last sync time. The People list shows everyone Entra provisioned, and **Recent activity** logs each change with who made it (your organisation's directory or a team owner).

### What each Entra action does

| Entra action | Request | Effect on three.ws |
| --- | --- | --- |
| Assign a person | `POST /Users` | A pending person on the team. They become a member the first time they sign in with Microsoft (matched by `userName` or email) |
| Change a name or email | `PATCH /Users/{id}` | The record updates |
| Disable the account, or unassign | `PATCH active: false` | Team access ends at once and the sessions they opened by signing in through your tenant are signed out. Their other sessions and their own account are untouched |
| Re-enable or reassign | `PATCH active: true` | Access is restored |
| Delete | `DELETE /Users/{id}` | Hidden from SCIM, access ended, sessions signed out, and the person cannot rejoin by sign-in or automatic join |

A team owner can also remove or restore any person in the People list; removal signs out their tenant sessions the same way.

## SCIM reference

All endpoints are under `https://three.ws/scim/v2` and answer `application/scim+json`.

| Endpoint | Methods |
| --- | --- |
| `/ServiceProviderConfig` | GET |
| `/ResourceTypes`, `/ResourceTypes/{User,Group}` | GET |
| `/Schemas`, `/Schemas/{urn}` | GET |
| `/Users` | GET (list, filter, paging), POST |
| `/Users/{id}` | GET, PUT, PATCH, DELETE |
| `/Groups` | GET (list, filter, paging), POST |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE |

- **Authentication.** `Authorization: Bearer tws_scim_...`. Each token reaches only its own team. Discovery endpoints do not need a token.
- **Filters.** `eq` comparisons joined with `and`. Users: `userName`, `externalId`, `id`, `displayName`, `emails`, `emails.value`, `emails[type eq "work"].value`, `active`. Groups: `displayName`, `externalId`, `id`, `members`. Any other filter is a `400 invalidFilter`, never silently ignored.
- **Paging.** `startIndex` (1-based) and `count`, up to 200 per page.
- **PATCH.** The shapes Entra sends: capitalised op names, `"False"` and `"True"` as strings, no-path replace with dotted keys (`name.givenName`), value-filtered paths (`emails[type eq "work"].value`, `members[value eq "<id>"]`), and member removal by filter or by value list. Up to 100 operations per request.
- **Errors.** RFC 7644 error bodies with `scimType` where one applies (`uniqueness` on a duplicate `userName`, `invalidFilter`, `invalidValue`).
- **Limits.** 1,200 requests per minute per team, and 20 failed authentications per 10 minutes per IP address. Over the limit the answer is `429` with `Retry-After`; Entra backs off and retries on its own.
- **Audit.** Every provisioning change is written to the team's activity log and to the account audit log.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Test Connection fails with 401 | The token was rotated, revoked or mistyped, or the tenant was unclaimed. Generate a new token and paste it again. |
| Test Connection fails with 404 | The Tenant URL is wrong. Use `https://three.ws/scim/v2` exactly, with no trailing path. |
| A provisioned person does not appear as a member | They have not signed in with Microsoft yet. They join on first sign-in, matched by their `userPrincipalName` or email. |
| "That Microsoft account is not a directory administrator" when claiming | Sign in with one of the four admin roles listed above. |
| "That Microsoft tenant already belongs to another three.ws team" | The other team's owner has to unclaim it first. |
| "Your organisation has to approve three.ws" at sign-in | The tenant requires admin consent for apps. An Entra administrator grants consent once, then everyone can sign in. |
| Provisioning log shows 429 | The team exceeded 1,200 requests per minute. Entra retries automatically; no action needed. |

## Operator setup (three.ws deployment)

Sign in with Microsoft needs the multitenant app registration that the Microsoft Marketplace landing page also uses:

1. In the Entra admin center, **App registrations**: supported account types **Accounts in any organizational directory and personal Microsoft accounts**.
2. Redirect URI (Web): `https://three.ws/api/auth/microsoft/callback`.
3. **Token configuration**: add the optional ID token claims `email` and `xms_edov`, and set group claims to **Directory roles** (`groupMembershipClaims: "DirectoryRole"`), so the admin check can read `wids` from the ID token.
4. **API permissions**: Microsoft Graph delegated `openid`, `profile`, `email`, `offline_access`, `User.Read`.
5. Set `MS_ENTRA_SSO_CLIENT_ID` and `MS_ENTRA_SSO_CLIENT_SECRET` on the Cloud Run service. Until both are set, the button stays hidden and `/api/auth/microsoft/start` returns people to `/login` with a clear message.

Microsoft, Microsoft Entra, Microsoft Entra ID and Microsoft Marketplace are trademarks of the Microsoft group of companies.

## Related

- [three.ws and Microsoft](./microsoft.md)
- [Microsoft Marketplace SaaS offer](./microsoft-marketplace-saas.md)
- [Trust center](./trust.md)
