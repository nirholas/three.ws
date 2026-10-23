Google sign-in, the grouped consent screen (Read, Manage, Trade, Spend, Launch with "still asks first" lists), Connected apps revocation with immediate effect, two clients staying connected, the /connect steps and docs/mcp.md are shipped and covered by tests (tests/api/google-signin.test.js, tests/oauth-endpoints.test.js, tests/api/oauth-*.test.js).

Remaining, owner-gated:

1. Create a Google Cloud "Web application" OAuth client in project aerial-vehicle-466722-p5 (console only, no CLI path) with redirect URI https://three.ws/api/auth/google/callback. Store GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Secret Manager and attach them to three-ws-api with `gcloud run services update --update-env-vars` / `--update-secrets`. Until then api/config.js hides the Google button.
2. After deploy, connect Claude's custom connector and a second client at once against production and confirm both stay connected, then revoke one in Settings, Connected apps.
3. Run `npm run build:pages` once the shared worktree's changelog edits settle (it errored in a dirty tree).
