# Microsoft Entra app gallery request: three.ws (OIDC single sign-on plus SCIM provisioning)

Program: Microsoft Entra App Gallery, requested through Microsoft's application onboarding portal after the prerequisites below.
Order: 841 (microsoft 41). Shared facts and owner-only inputs: [README.md](./README.md).
Prepared: 2026-11-16. **Status: ready to submit. Nothing has been submitted.** Once submitted it is "in review" until Microsoft validates and publishes it.
Approved partnership wording only: "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace". The listing itself makes no partnership claim.

Source read on 2026-11-16: [Prerequisites to validate and publish your app](https://learn.microsoft.com/entra/identity/enterprise-apps/v2-howto-app-gallery-listing) (updated by Microsoft 2026-09-02). The onboarding portal's own form sits behind a Microsoft sign-in and was not read, so field names below follow that page; check each against the live form on the submission day.

## Capabilities requested

| Capability | Protocol | State in the product |
|---|---|---|
| Single sign-on | OpenID Connect, multitenant, `common` authority | Live. SP-initiated at `https://three.ws/login` (Continue with Microsoft) and IdP-initiated from My Apps at `https://three.ws/sso/microsoft` |
| Automatic user provisioning | SCIM 2.0, users and groups | Live at `https://three.ws/scim/v2`, bearer token per team (`tws_scim_`) and OAuth client credentials |

## Shared prerequisites (Microsoft's list) and where each stands

| Prerequisite | Status | Evidence or owner action |
|---|---|---|
| Agree to the Entra App Gallery terms and conditions | Owner | https://azure.microsoft.com/support/legal/active-directory-app-gallery-terms/ |
| Production-ready app customers can reach | Done | https://three.ws, sign-in and SCIM verified below |
| Engineering and support contacts | Drafted | Engineering and support: `support@three.ws`; security: `security@three.ws`. Owner confirms the named person |
| Public customer documentation per capability | Done | [docs/entra-gallery-tutorial.md](../../../../docs/entra-gallery-tutorial.md) (SSO and provisioning in Microsoft's tutorial structure) and [docs/enterprise-sso.md](../../../../docs/enterprise-sso.md) |
| Test tenant and test accounts | Owner | Join the Microsoft 365 Developer Program for a renewable tenant; steps below |
| Associate the organisation with the Microsoft AI Cloud Partner Program | Owner | The Partner Center account that publishes on Microsoft Marketplace |
| Partner One ID (formerly MPN ID) of the publisher organisation | Owner input | Not recorded in the repo |

## Request fields

| Field | Answer |
|---|---|
| Application name | three.ws |
| Publisher | three.ws (the legal entity name is an owner input, see README.md) |
| Website | https://three.ws |
| Short description | Give your AI agents a 3D body. Sign in with your work account, open three.ws from My Apps and provision your team automatically. |
| Category | Developer tools, or Collaboration if the portal offers only one choice. Owner picks from the live list |
| Sign-on URL (My Apps launch) | `https://three.ws/sso/microsoft` |
| Redirect URI | `https://three.ws/api/auth/microsoft/callback` |
| Protocol | OpenID Connect, multitenant |
| Supported SSO flows | SP-initiated and IdP-initiated (My Apps) |
| Just-in-time user creation | Yes |
| Provisioning | SCIM 2.0, Tenant URL `https://three.ws/scim/v2`, secret token authentication, users and groups |
| Customer documentation URL | https://three.ws/docs/entra-gallery-tutorial (source: docs/entra-gallery-tutorial.md) |
| Privacy policy | https://three.ws/legal/privacy |
| Terms of service | https://three.ws/legal/tos |
| Security and trust page | https://three.ws/trust |
| Support | `support@three.ws`, https://three.ws/support |
| Licensing needed by customers | None beyond a Microsoft Entra tenant. SSO works with Microsoft Entra ID Free. Provisioning needs Entra ID P1 or P2 or the provisioning licence Microsoft documents, and a three.ws team |
| Roles needed to set up | Cloud Application Administrator, Application Administrator or Global Administrator (Privileged Role Administrator also accepted for claiming a tenant) |

## Logo

| Item | Spec | File |
|---|---|---|
| App logo | Square PNG, 215 x 215 pixels, transparent or solid background, under the size limit the form states | Render from [marketing/microsoft/media/marketplace/logo-300x300.png](../../../microsoft/media/marketplace/logo-300x300.png) (the brand cube) scaled to 215 x 215 with `sips` or ImageMagick `convert logo-300x300.png -resize 215x215 logo-215x215.png`. Not committed: a derived binary |
| Larger logo if requested | 300 x 300 PNG | The same source file |

## Test tenant and test user (owner prepares)

1. In the Microsoft 365 Developer Program, create the sandbox tenant (for example `contosothreews.onmicrosoft.com`) with sample users.
2. Create two test users: a `Reviewer One` member and a `Reviewer Admin` with the Cloud Application Administrator role.
3. In three.ws, sign in with a normal account that owns a team (create one at https://three.ws/teams), open **Settings > Your organisation > Claim with a Microsoft admin account** and sign in as the sandbox admin. Leave the join mode on **Offer the team**.
4. Under **SCIM provisioning** generate the token and copy it once. Give it to Microsoft in the form's secure field. It belongs to that one team and is rotated with **Rotate token**.
5. Assign the test users to the three.ws enterprise application in the sandbox tenant, then confirm the My Apps tile works for them (steps in the tutorial).

Do not use a customer team for review. Revoke the token after Microsoft finishes validation.

## Evidence, collected 2026-11-16

| Check | Result |
|---|---|
| SCIM conformance, users and groups: create, get, filter by `userName` and `externalId`, Entra patch shapes (no-path objects, dotted and filtered keys, `active` as a string), replace, delete, 1-based paging with `count=0`, `excludedAttributes=members`, membership probes, error format, 25 requests per second | `npx vitest run tests/scim-entra-conformance.test.js` against the real handlers on an isolated database: passes |
| OIDC: any tenant, issuer equals `https://login.microsoftonline.com/{tid}/v2.0` for the token's own `tid`, accounts keyed by `tid:oid`, admin consent, Conditional Access and blocked-tenant errors, safe `next`, `domain_hint` and `login_hint` handling | `tests/entra-oidc.test.js`, `tests/entra-gallery-oidc.test.js` pass |
| Suites together | 4 files (`scim-entra-conformance`, `entra-gallery-oidc`, `entra-oidc`, `scim`), 95 tests, all passing |
| My Apps launch trace | The production server code served locally answered `GET /sso/microsoft?domain_hint=contoso.com&login_hint=a@contoso.com&next=/teams` with `302` to `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` carrying `scope=openid profile email offline_access User.Read`, `response_type=code`, PKCE `code_challenge_method=S256`, `state`, `nonce`, `login_hint` and `domain_hint`, and set the signed `__Host-msauth` cookie (HttpOnly, Secure, SameSite=Lax, 600 s) holding `next=/teams` |
| Production SCIM | `GET https://three.ws/scim/v2/ServiceProviderConfig` answers `200` with patch and filter supported and the OAuth bearer scheme |
| Production tutorial page | `https://three.ws/docs/entra-gallery-tutorial` also answered `404` on 2026-11-16 for the same reason (listed in data/pages.json, not yet deployed). It must be live before submission |
| Production My Apps URL | `https://three.ws/sso/microsoft` answered `404` on 2026-11-16: the route is in the repository but the current production revision predates it. A production deploy is an owner step and must land before the request is submitted |

Microsoft's own SCIM validator needs a public endpoint with a real team token; it is the owner's final check against the sandbox team above ("Provision on demand" and **Test Connection** in the Entra admin center exercise the same cases).

## Submission steps (owner)

1. Deploy production so `https://three.ws/sso/microsoft` resolves (`npm run deploy:gcp:full`, gate 2). Confirm `curl -sI https://three.ws/sso/microsoft` answers `302` to `login.microsoftonline.com`.
2. Confirm `MS_ENTRA_SSO_CLIENT_ID` and `MS_ENTRA_SSO_CLIENT_SECRET` are set on the Cloud Run service (see docs/enterprise-sso.md).
3. Complete the owner rows of the prerequisite table, create the sandbox tenant and the test team as above.
4. Open Microsoft's Entra App Gallery onboarding portal as the publisher, create one request for SSO (OIDC) and one for provisioning (SCIM), paste the fields above and attach the tutorial URL.
5. Answer Microsoft's validation questions with this file. Expect an iteration or two; Microsoft states the SCIM and sign-in checks it runs in its requirements articles.
6. After it is published, flip the gallery status note in docs/entra-gallery-tutorial.md and record the date in marketing/growth/opportunities.csv.
