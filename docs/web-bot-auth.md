# Web Bot Auth

three.ws agents sign their outbound web requests so a site can verify who is fetching and attribute or rate-limit it, instead of blocking an unidentified bot. This is the signing half of [Web Bot Auth](https://github.com/cloudflare/web-bot-auth) (HTTP Message Signatures, RFC 9421, Ed25519).

## What a signed request looks like

```
Signature-Agent: "https://three.ws"
Signature-Input: sig1=("@authority" "signature-agent");created=1793793600;expires=1793793900;keyid="<thumbprint>";alg="ed25519";nonce="...";tag="web-bot-auth"
Signature: sig1=:<base64>:
```

`keyid` is the RFC 7638 thumbprint of the public key. A site fetches the key from the directory the `Signature-Agent` URL points at:

```
GET https://three.ws/.well-known/http-message-signatures-directory
content-type: application/http-message-signatures-directory+json

{ "keys": [ { "kty": "OKP", "crv": "Ed25519", "x": "...", "kid": "<thumbprint>" } ] }
```

The directory response is itself signed (`tag="http-message-signatures-directory"`, covering `"@authority";req`).

## Where requests are signed

| Origin | How |
| --- | --- |
| Tool gateway `web_fetch` and `parse_document` (`api/_lib/tool-gateway/download.js`) | Per hop, through the `hopHeaders` option of `fetchSafePublicUrlPinned`, so a redirect to another host gets a signature for that host. |
| Agent screen pool navigations (`workers/agent-screen-pool/egress-guard.js`) | Top-level navigations only. Subresources are left unsigned because a custom header on a cross-origin fetch forces a CORS preflight. |

The signing module is `api/_lib/web-bot-auth.js` with a byte-identical copy in `workers/agent-screen-pool/web-bot-auth.js`; `tests/web-bot-auth.test.js` fails if they drift.

## Operating it

1. `node scripts/generate-web-bot-auth-key.mjs > key.pem` (private key on stdout, public JWK on stderr).
2. Store the PEM in Secret Manager and mount it as `WEB_BOT_AUTH_PRIVATE_KEY` with `gcloud run services update <service> --region us-central1 --update-secrets=WEB_BOT_AUTH_PRIVATE_KEY=web-bot-auth-private-key:latest` (never `--set-env-vars` or `--set-secrets`, which replace the whole set). The runtime service account needs `roles/secretmanager.secretAccessor` on the secret.
3. Verify: `curl -si https://three.ws/.well-known/http-message-signatures-directory`.

**Production (since 2026-11-12):** the key lives in the Secret Manager secret `web-bot-auth-private-key` (version 1), readable by `three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com`, and is mounted on `three-ws-api` from revision `three-ws-api-00533-zjh`. The published key id is `kYd4J5VUUD_UysEEQRjeokYQpDNg3SrfuYwEdDDaQu0`. `agent-screen-pool` is not deployed yet; mount the same secret on it with the command above when it is, so both surfaces sign with the one published key. To rotate, add a new secret version and redeploy; the directory and every signature follow the mounted key.

With the variable unset, nothing is signed and the directory answers 404, so an unconfigured deploy never advertises a key it cannot sign with. A bad key value is treated the same as unset. Signing never throws into a fetch: an unsigned request beats a failed one.

Tests: [tests/web-bot-auth.test.js](../tests/web-bot-auth.test.js) verifies signatures with an independent verifier built only from the published JWKS.
