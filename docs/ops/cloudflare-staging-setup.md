# Deploy three.ws staging on Cloudflare

Prepared 2026-11-24 for the existing nirholas/three.ws repository.

The deployment files are committed to main, the source branch selected by the
owner for this separate staging Worker. They do not replace the existing root
Dockerfile or GCP configuration.

## Values for the Cloudflare application form

| Field | Value |
| --- | --- |
| GitHub repository | nirholas/three.ws |
| Production branch for this separate staging Worker | main |
| Worker/project name | three-ws-staging |
| Root directory | / |
| Build command | Leave empty |
| Deploy command | npx --yes wrangler@4.168.0 deploy |
| Preview builds | Off |
| Build API token | Create new token automatically |
| Build variable | SKIP_DEPENDENCY_INSTALL = true |
| Build variable | NODE_VERSION = 24 |

The deployment uses a separate staging Worker. In Cloudflare terminology its
selected deployment branch is the Worker's production branch, but it is not
the live three.ws deployment. If the initial import form does not expose branch
selection, set the branch in Settings > Builds before triggering a build.

The Dockerfile installs dependencies and builds the full frontend inside the
image using the repository's existing build:gcp script. Despite its name, that
script only builds and checks assets; it does not invoke deploy:gcp. Avoid the
build:production/build:vercel orchestrator here: its post-build stage includes
external delivery/configuration actions. SKIP_DEPENDENCY_INSTALL avoids a second
monorepo install by the outer Cloudflare build runner.

Workers Paid must be enabled for Containers. Startup-program enrollment alone
does not activate a credit award or confirm that Container charges are covered.

## Runtime variables and secrets

After the Worker exists, open its Settings > Variables and Secrets. Store
credentials as runtime secrets, not build variables. Use the original variable
names from the Node application. The adapter forwards string-valued runtime
variables and secrets into the container; it does not forward object bindings.

At minimum, wire a staging database through DATABASE_URL and an externally
reachable Redis REST URL/token pair through UPSTASH_REDIS_REST_URL and
UPSTASH_REDIS_REST_TOKEN. Add authentication, object-storage, RPC, email, and
provider credentials required for the features you intend to verify. The
repository's .env.example and api/_lib/env.js document the supported names.

Use a staging database and service configuration while exercising writes. A
live database is not an isolated preview just because the hostname is staging.
Do not paste credentials into public files, the build-command field, or chat.

For previews, PUBLIC_APP_ORIGIN defaults to the original workers.dev HTTPS origin.
OAuth providers must have matching staging callback URLs configured. Some
frontend/SEO references remain pinned to https://three.ws by the existing app,
so verify that each tested feature actually calls the staging API.

When changing runtime secrets for an already running container, restart that
container through Cloudflare so the Node process receives the new environment.
The deployment intentionally has no scheduler and rejects /api/cron requests.
Schedule migration is a separate production cutover task, not an automatic
side effect of deploying this staging Worker.

## Import Cloud Run configuration from Cloud Shell

Complete the Worker's first deployment, including runtime-env.mjs, before import.
Create a Cloudflare custom API token with Account > Workers Scripts > Edit,
restricted to the destination account. Copy its 32-character account ID from
the Cloudflare dashboard. Open https://shell.cloud.google.com/ with a Google
account allowed to describe the service and access its referenced secrets.

Download the importer and run it. No local software installation is needed:

```sh
curl -fL https://raw.githubusercontent.com/nirholas/three.ws/main/scripts/migrate-cloudflare-env.py -o /tmp/three-ws-env-migration.py
python3 /tmp/three-ws-env-migration.py --apply
```

The defaults read three-ws-api in us-central1 in project
aerial-vehicle-466722-p5 and update Cloudflare Worker three-ws-staging. Override
--project, --region, --service, or --worker if the intended source differs.
The script displays its source and destination and prompts for the account ID
and API token. The token prompt hides input. It reads literal runtime values
and referenced Secret Manager versions, preserves Unicode and newlines, and
uploads the configuration through Cloudflare's bulk secrets endpoint. It does
not modify GCP, create a file of secret values, or print those values.

For a names-only inventory, omit --apply. Use --exclude NAME repeatedly to
leave out individual keys or --only NAME repeatedly to select a smaller set.
Importing production credentials gives staging access to the same services.
Exclude DATABASE_URL when using a separate staging database, then add its
staging value as an individual runtime secret in the dashboard. Existing
individual bindings for a selected source name cause import to stop; exclude
those names if the bindings should remain in use.

Values are stored in encrypted THREE_WS_ENV_000 and subsequent numbered
bindings, plus THREE_WS_ENV_PARTS. The adapter reassembles them before starting
Node. This avoids one Worker binding per application variable and splits large
configuration into chunks below the per-binding size limit. The importer
checks the paid plan's 128-variable limit and uses at most 96 bundle bindings.
Manage an individual application key by adding a runtime binding with its
original name, which overrides the imported value. Do not edit individual
numbered chunks. Rerunning the importer replaces the selected configuration
bundle; it does not merge excluded keys from a previous import.

After a successful import, restart the staging container through Cloudflare
and test its staging URL. Imported credentials alone do not migrate private
Redis connections, GCP attached identity, secret file mounts, external GPU
workers, scheduled jobs, OAuth callback registrations, or build-time variables.
Secret references using latest resolve to the version current at import time.

## Runtime shape

- The Worker forwards requests to the existing server on port 8080.
- The routing code selects one fixed Durable Object name, main-site. End-user
  input cannot choose new container instance names.
- standard-3 gives 2 vCPU, 8 GiB RAM, and 16 GB disk. The repository's current
  production configuration allocates 8 GiB and documents memory peaks that
  make a 1 GiB or 4 GiB full-production recommendation unsafe without testing.
- The instance sleeps after two minutes of inactivity. Frequent traffic and
  streaming connections can keep it running. This is metered compute, not a
  flat $5/month server.
- Runtime disk is ephemeral. Keep persistent data in external storage.
- Preview requests use a local internal Host header to bypass the Node
  server's registered-custom-domain lookup. Forwarded host and protocol
  preserve the public HTTPS origin.

## Validation and current limits

Completed in this session:

- Node syntax check of the Worker source.
- Node tests for environment decoding, overrides, and safe validation failures.
- Python tests for configuration parsing and exact Python-to-Worker transport.
- Wrangler 4.168.0 configuration validation and Worker bundling using:

  npx --yes wrangler@4.168.0 deploy --dry-run --containers-rollout=none

Run the importer's focused checks without installing project dependencies:

```sh
node --test tests/cloudflare-runtime-env.node.mjs
python3 -m unittest discover -s tests -p 'test_cloudflare_env_migration.py'
```

Not completed:

- Full monorepo frontend build, Docker image build, or container boot.
- Cloudflare account deployment, runtime secrets, or end-to-end feature tests.
- Production migration of Redis, GPU services, scheduled jobs, or DNS.

Docker was unavailable in the preparation environment. The dry-run deliberately
skipped container rollout and therefore is not proof that the image builds or
that the complete website works on Cloudflare.

Workers Builds currently has a 20-minute build timeout, 8 GB RAM, and 20 GB disk.
This monorepo's clean image build may exceed those limits. If it does, build
the same Dockerfile on a sufficiently sized Docker-enabled machine and deploy
the resulting supported registry image instead of repeatedly retrying a build
that exceeds the builder limits. No local software installation is required
when a suitable cloud build environment is used.

The existing GCP deployment configuration routes Redis through a private VPC.
Those private endpoints are not reachable from a public Cloudflare container.
Configure a supported reachable endpoint or a deliberately designed private
network connection before claiming that Redis migration is complete. Provider
SDKs that relied on GCP's attached service-account identity also need explicit
authentication outside GCP. Existing external GPU workers remain separate.

## Verify the staging URL before any domain cutover

1. Open the staging workers.dev homepage and inspect browser/network errors.
2. Open /api/healthz and inspect dependency statuses, not only its HTTP 200.
3. Verify login, session cookies, CSRF protection, and OAuth callbacks.
4. Exercise a database read and a controlled staging write.
5. Verify Redis-backed behavior, model upload/download, and 3D rendering.
6. Test streaming, long requests, sleep/wake, and container restarts.
7. Verify GPU/provider routes using their actual external endpoints.

Only after those checks, prepare a production Worker/domain configuration and
an explicit one-owner scheduler cutover. Do not point three.ws at this staging
Worker merely because the homepage renders.

## Official references

- https://developers.cloudflare.com/containers/get-started/
- https://developers.cloudflare.com/containers/guides/deploy/
- https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/
- https://docs.cloud.google.com/sdk/gcloud/reference/secrets/versions/access
- https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/containers/platform/pricing/
