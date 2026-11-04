# three.ws Power Platform connector

The custom connector, and later the certified connector, that lets Power Automate, Power Apps, Logic Apps and Copilot Studio call three.ws. It is work order 986, task 3, of the Microsoft distribution plan ([docs/microsoft-marketplace-offer-plan.md](../../../docs/microsoft-marketplace-offer-plan.md)).

| File | What it is |
|---|---|
| `apiDefinition.swagger.json` | OpenAPI 2.0 definition of the five actions, with the connector extensions (`x-ms-summary`, `x-ms-visibility`, `x-ms-dynamic-values`, `x-ms-connector-metadata`) |
| `apiProperties.template.json` | Connection settings: three.ws OAuth 2.0 authorization code with S256 PKCE (`oauth2generic`), brand color, publisher. `${PP_OAUTH_CLIENT_ID}` is filled in at build time |
| `icon.png` | 230 x 230 icon on the brand color `#080814`, glyph inside 70% (regenerate with `--regen-icon`) |
| `intro.md` | The connector documentation certification asks for: operations, credentials, getting started, known issues |
| `schema/swagger-2.0.schema.json` | The official Swagger 2.0 JSON schema (OAI/OpenAPI-Specification `_archive_/schemas/v2.0/schema.json`), vendored so validation runs offline |

## Actions

| Action | operationId | Endpoint | Sign-in |
|---|---|---|---|
| Generate a 3D model from text | `GenerateModel` | `POST /api/3d/studio` | not needed |
| Get generation job | `GetGenerationJob` | `GET /api/3d/studio?job=` | not needed |
| List my agents | `ListMyAgents` | `GET /api/agents` | required |
| Search public agents | `SearchAgents` | `GET /api/agents/public` | not needed |
| Send a message to an agent | `SendAgentMessage` | `POST /api/agents/talk` | required |

The connection always signs in, because a connector has one security scheme. The two generation actions and the search ignore the token. The response schemas mirror the live handlers ([api/3d/studio.js](../../../api/3d/studio.js), [api/agents.js](../../../api/agents.js) `decorate()`, [api/agents/public.js](../../../api/agents/public.js), [api/agents/talk.js](../../../api/agents/talk.js)). Change them together.

`/api/agents/talk` limits each signed-in caller on their own bucket rather than per IP, because connector calls for every tenant leave from a few shared Azure egress addresses.

## Build and validate

```bash
npm run package:power-platform-connector -- --check     # schema + certification rules, no owner value needed
PP_OAUTH_CLIENT_ID=mcp_xxx npm run package:power-platform-connector
```

The build writes `dist/microsoft/three-ws-power-platform-connector/` (the four files `paconn` and `pac connector` take) and a zip of the same files. `--check` runs these checks:

- **Swagger schema.** The definition is validated against the official Swagger 2.0 schema, with its draft-04 references inlined for Ajv 8.
- **Certification text rules:**
  - The title is 30 characters or fewer, contains no "API", "Connector" or product names, and ends alphanumeric.
  - The description is 31 to 499 characters and names no product.
  - Every operation and parameter summary is 80 characters or fewer and alphanumeric.
  - Every description is a full sentence.
- **Certification structure rules:**
  - There are no `default` responses, and each 2xx response has an exact schema.
  - Every `$ref` resolves.
  - `x-ms-dynamic-values` targets an existing operation.
  - Contact and connector metadata are present.
  - The host is production and the scheme is https only.
- **OAuth settings:**
  - `oauth2generic` with `GlobalPerConnector`.
  - The PKCE `{CodeChallenge}` and `{CodeVerifier}` templates.
  - The scopes match the definition and include `offline_access`.
- **Icon:** square, 100 to 230 px, opaque, the background equals `iconBrandColor`, and the glyph stays within 70%.
- **intro.md:** documents every action and has the Prerequisites, Obtaining credentials and Known issues sections.

The suite is [tests/microsoft-power-platform-connector.test.js](../../../tests/microsoft-power-platform-connector.test.js).

## Owner steps to publish

1. **Create the connector** in the Power Platform environment that will own it:

   ```bash
   pac connector create --api-definition-file apiDefinition.swagger.json --api-properties-file apiProperties.json --icon-file icon.png
   ```

   Build it first with a temporary id (`PP_OAUTH_CLIENT_ID=pending-registration`), since the redirect URL only exists once the connector does. Import through the maker portal UI is not enough, because it drops the PKCE templates in `apiProperties.json`.
2. **Copy the redirect URL** the connector shows under Security. With `GlobalPerConnector` it is `https://global.consent.azure-apim.net/redirect/<connector-api-name>`.
3. **Register the public client** with that exact URL. `token_endpoint_auth_method: none` makes it a public PKCE client, so there is no secret to rotate:

   ```bash
   curl -s https://three.ws/oauth/register -H 'content-type: application/json' -d '{
     "client_name": "three.ws for Power Platform",
     "client_uri": "https://three.ws",
     "logo_uri": "https://three.ws/logo.png",
     "redirect_uris": ["https://global.consent.azure-apim.net/redirect/<connector-api-name>"],
     "grant_types": ["authorization_code", "refresh_token"],
     "token_endpoint_auth_method": "none",
     "scope": "profile agents:read offline_access"
   }'
   ```
4. **Rebuild and update the connector** with the returned client id:

   ```bash
   PP_OAUTH_CLIENT_ID=<client_id> npm run package:power-platform-connector
   pac connector update --connector-id <id> --api-properties-file dist/microsoft/three-ws-power-platform-connector/apiProperties.json
   ```

   Then create a connection and run each action at least 10 times, as certification requires.
5. **Certify.** Run the Solution Checker on the connector solution. Export the connector and test flow solutions, then package them with `intro.md` as the certification guide describes. Submit as a verified publisher in Partner Center, and open the pull request to `microsoft/PowerPlatformConnectors` under `certified-connectors/three.ws 3D Studio/`.
