# Deploy three.ws staging on Cloudflare

Prepared 2026-11-24 for the existing nirholas/three.ws repository. The source
inspection identified main commit e989601bee236b89621b75cf07ee83f39dbabf45.
Review these additions against your latest branch before merging.

## Add the files first

Extract this archive. Add its contents to the repository root, preserving paths:

- wrangler.jsonc
- deploy/cloudflare/worker.mjs
- deploy/cloudflare/Dockerfile
- docs/ops/cloudflare-staging-setup.md

The owner selected main as the source branch for this separate staging Worker.
In the GitHub browser UI, select main, choose Add file, then Upload files, and drag the extracted
files and directories onto the upload area. Upload the extracted contents, not
the ZIP or an extra enclosing cloudflare_setup directory. Commit the additions.
These additions do not replace the existing root Dockerfile or GCP configuration.

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
- Wrangler 4.168.0 configuration validation and Worker bundling using:

  npx --yes wrangler@4.168.0 deploy --dry-run --containers-rollout=none

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
- https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/containers/platform/pricing/
