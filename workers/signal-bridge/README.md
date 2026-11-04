# signal-bridge

The Signal leg of the three.ws agent chat gateway: a Cloud Run service that
holds one registered Signal number and exposes it over HTTP so the gateway can
send and receive Signal messages for agent owners.

It is a thin layer over the maintained
[signal-cli REST bridge](https://github.com/bbernhard/signal-cli-rest-api)
(`bbernhard/signal-cli-rest-api:0.100`). The upstream image does the hard part:
signal-cli, the REST surface, and the live receive websocket. This layer adds
the one thing Cloud Run lacks, **persistence**: a Signal registration is a set of
identity keys and ratchet state on disk, Cloud Run disks are in-memory, and
losing them means re-verifying the number. `persist.sh` restores that state from
a mounted Cloud Storage bucket on boot and snapshots it back on a timer.

## How it fits

```
Signal user ──► signal-bridge (this service) ◄── agent gateway worker ──► api/_lib/gateway/core.js
                 signal-cli + REST + receive WS      (workers/agent-gateway)     pairing, commands,
                 state snapshot in GCS                                           conversation, approvals
```

The gateway core is platform-neutral and already lists Signal as a platform
([api/_lib/gateway/platforms.js](../../api/_lib/gateway/platforms.js): no
buttons, no in-place edits, voice notes on). The process that connects this
bridge to the core is the gateway worker in [workers/agent-gateway](../agent-gateway).

## Files

| File | Role |
|---|---|
| `Dockerfile` | `FROM bbernhard/signal-cli-rest-api:0.100`, sets the bridge mode and state env, installs `persist.sh` as the entrypoint. |
| `persist.sh` | Restores `signal-cli.tgz` from the state volume, starts a background snapshot loop, then `exec`s the upstream `/entrypoint.sh`. |
| `cloudbuild.yaml` | Creates the Artifact Registry repo and the versioned state bucket if missing, builds, pushes, deploys to Cloud Run, and grants the runtime service account `run.invoker`. |

## Configuration

Set in the Dockerfile; override with `-e` locally or `--update-env-vars` on Cloud Run.

| Variable | Default | Meaning |
|---|---|---|
| `MODE` | `json-rpc` | Keeps one signal-cli process resident, so a send takes milliseconds instead of a JVM start, and serves the receive websocket. |
| `PORT` | `8080` | The REST port. |
| `JSON_RPC_TRUST_NEW_IDENTITIES` | `on-first-use` | Trust a contact's identity key the first time it is seen. |
| `JSON_RPC_IGNORE_STORIES`, `JSON_RPC_IGNORE_STICKERS` | `true` | Drop message types the gateway never handles. |
| `SIGNAL_STATE_DIR` | `/state` | Where the state volume is mounted. The snapshot is `$SIGNAL_STATE_DIR/signal-cli.tgz`. |
| `SIGNAL_SNAPSHOT_SECONDS` | `120` | Snapshot interval. A snapshot is written only when a file under the signal-cli config dir changed since the last one, so an idle bridge does not rewrite the object. |
| `SIGNAL_CLI_CONFIG_DIR` | `/home/.local/share/signal-cli` | Set by the upstream image: the tree that is snapshotted and restored. |

Snapshots are written to a temporary name and renamed, so a restart in the
middle of a write restores the previous complete tarball rather than a torn one.

## Run locally

From the repo root:

```bash
docker build -t signal-bridge workers/signal-bridge
mkdir -p .signal-state
docker run --rm -p 8080:8080 -v "$PWD/.signal-state:/state" signal-bridge
```

The first boot logs `no snapshot at /state/signal-cli.tgz, starting unregistered`.
Once the API is up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/v1/health   # 204
curl -s http://localhost:8080/v1/about    # {"versions":["v1","v2"],...,"mode":"json-rpc","version":"0.100",...}
curl -s http://localhost:8080/v1/accounts # [] until a number is registered
```

Within one snapshot interval the log shows `snapshot written <time>`, and the
next container started on the same volume logs `restoring state from
/state/signal-cli.tgz`.

## Register the number

Do this once per number. The registration then lives in the state bucket and
survives every redeploy. These are the upstream bridge's endpoints
([full reference](https://bbernhard.github.io/signal-cli-rest-api/)); `+15551234567`
stands for the gateway's own number in E.164 form.

```bash
BRIDGE=http://localhost:8080

# Ask Signal for an SMS code. Signal usually requires a captcha token first:
# solve https://signalcaptchas.org/registration/generate.html and copy the
# signalcaptcha:// link it produces.
curl -X POST "$BRIDGE/v1/register/+15551234567" \
  -H 'content-type: application/json' \
  -d '{"use_voice": false, "captcha": "signalcaptcha://..."}'

# Confirm with the code that arrived by SMS.
curl -X POST "$BRIDGE/v1/register/+15551234567/verify/123456"

# Send a test message.
curl -X POST "$BRIDGE/v2/send" \
  -H 'content-type: application/json' \
  -d '{"number": "+15551234567", "recipients": ["+15557654321"], "message": "three.ws gateway online"}'
```

To use an existing phone's Signal account instead of a dedicated number, link
the bridge as a secondary device: open `$BRIDGE/v1/qrcodelink?device_name=three-ws-gateway`
in a browser and scan the QR code from Signal on the phone (Settings, Linked devices).

Inbound messages stream over the websocket at `ws://<bridge>/v1/receive/<number>`
in `json-rpc` mode; that is the socket a gateway Signal adapter consumes.

## Deploy

Production deploys are owner-gated (see CLAUDE.md). The command, from the repo root:

```bash
gcloud builds submit workers/signal-bridge --config workers/signal-bridge/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

The build runs as `three-ws-build@`, the service runs as `three-ws@`, and the
deploy flags are load-bearing:

| Flag | Why |
|---|---|
| `--max-instances=1` | signal-cli owns one number's key material. Two instances would each advance the ratchets and corrupt the other's sessions. |
| `--min-instances=1`, `--no-cpu-throttling` | The gateway holds the receive websocket open; scale-to-zero would drop inbound messages. |
| `--no-allow-unauthenticated` | The upstream bridge has no auth of its own. Only the runtime service account (the gateway) may invoke it, with a Google ID token. |
| `--add-volume ... bucket=three-ws-signal-bridge-state` | The versioned bucket holds `signal-cli.tgz`, so a new revision restores the registration instead of needing the number verified again. |
| `--startup-probe=httpGet.path=/v1/health` | The JVM daemon takes a few seconds; traffic waits for it. |

To register the number against the deployed service, call the same endpoints
through an authenticated proxy:

```bash
gcloud run services proxy signal-bridge --region us-central1 --port 8080
# then use BRIDGE=http://localhost:8080 with the commands above
```

## Operations

- **Logs:** `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="signal-bridge"' --freshness=1h`. Look for `restoring state from`, `snapshot written`, and `snapshot failed`.
- **Roll back the registration state:** the bucket has object versioning on, so an earlier `signal-cli.tgz` generation can be restored with `gcloud storage cp gs://three-ws-signal-bridge-state/signal-cli.tgz#<generation> gs://three-ws-signal-bridge-state/signal-cli.tgz` before restarting the service.
- **Upgrading the upstream image:** bump the `FROM` tag, then run it locally on a copy of the state tarball before deploying, since a signal-cli upgrade can migrate the on-disk format.

## Related

- [api/_lib/gateway/](../../api/_lib/gateway): the platform-neutral gateway core, inbox and pairing.
- [api/gateway/](../../api/gateway): the Telegram and Discord webhook receivers and the connections API.
- [workers/agent-gateway](../agent-gateway): the gateway worker.
