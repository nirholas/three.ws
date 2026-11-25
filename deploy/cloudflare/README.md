# Cloudflare staging deployment

The repository root wrangler.jsonc deploys the main website and API to a
separate Worker named three-ws-staging. Its Dockerfile builds the frontend and
runs server/index.mjs on port 8080. Runtime Worker secrets are forwarded to the
Node process. Scheduled jobs are disabled for this staging deployment.

runtime-env.mjs also decodes the encrypted configuration chunks produced by
scripts/migrate-cloudflare-env.py. Individual runtime bindings override imported
values. Bundle metadata and Worker control settings stay outside the container.

Use main as the source branch, as selected by the owner. The existing GCP
deployment files and three.ws domain routing are independent of this setup.

See [the setup guide](../../docs/ops/cloudflare-staging-setup.md) for exact
dashboard settings, runtime credentials, validation limits, and cutover checks.
