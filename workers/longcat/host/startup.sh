#!/usr/bin/env bash
# GCE startup script for the LongCat GPU host. Runs as root on every boot and is
# idempotent: it converges the VM to "weights synced and verified, worker and TLS
# front running, idle-stop timer armed". Everything it needs comes from instance
# metadata (set by workers/longcat/deploy-gce.sh); no secret is stored in it, the
# API key is read from Secret Manager at service start.
set -euo pipefail

MD="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
md() { curl -fsS -H 'Metadata-Flavor: Google' "${MD}/$1"; }

IMAGE="$(md longcat-image)"
WEIGHTS_URI="$(md weights-uri)"
OUTPUT_BUCKET="$(md output-bucket)"
FIRESTORE_PROJECT="$(md firestore-project)"
SECRET_NAME="$(md api-key-secret)"
PUBLIC_HOST="$(md public-host)"
IDLE_MINUTES="$(md idle-minutes)"
GRACE_MINUTES="$(md grace-minutes)"

WEIGHTS_ROOT=/mnt/weights
STATE_DIR=/var/lib/longcat
mkdir -p "${WEIGHTS_ROOT}/longcat" "${STATE_DIR}" /opt/longcat

echo "==> waiting for the NVIDIA driver"
for _ in $(seq 1 60); do
	if nvidia-smi >/dev/null 2>&1; then break; fi
	sleep 10
done
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

echo "==> syncing weights from ${WEIGHTS_URI}"
gcloud storage rsync --recursive "${WEIGHTS_URI}" "${WEIGHTS_ROOT}/longcat"
if [[ ! -f "${STATE_DIR}/weights.verified" ]] || ! cmp -s "${WEIGHTS_ROOT}/longcat/weights.sha256" "${STATE_DIR}/weights.verified"; then
	echo "==> verifying weight checksums"
	(cd "${WEIGHTS_ROOT}/longcat" && sha256sum --check --quiet weights.sha256)
	cp "${WEIGHTS_ROOT}/longcat/weights.sha256" "${STATE_DIR}/weights.verified"
fi

echo "==> authenticating docker to Artifact Registry"
gcloud auth configure-docker "$(cut -d/ -f1 <<<"${IMAGE}")" --quiet
docker pull "${IMAGE}"
docker pull caddy:2
docker pull node:22-alpine

md idle-shutdown-js >/opt/longcat/idle-shutdown.mjs

cat >/opt/longcat/start-worker.sh <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
API_KEY="\$(gcloud secrets versions access latest --secret=${SECRET_NAME})"
docker rm -f longcat >/dev/null 2>&1 || true
exec docker run --rm --name longcat --gpus all --network host \\
	-e API_KEY="\${API_KEY}" \\
	-e GCS_BUCKET=${OUTPUT_BUCKET} \\
	-e FIRESTORE_PROJECT=${FIRESTORE_PROJECT} \\
	-e WEIGHTS_DIR=/weights/longcat \\
	-v ${WEIGHTS_ROOT}:/weights:ro \\
	${IMAGE}
SCRIPT
chmod 0755 /opt/longcat/start-worker.sh

cat >/opt/longcat/Caddyfile <<CADDY
${PUBLIC_HOST} {
	reverse_proxy 127.0.0.1:8080
}
CADDY

cat >/opt/longcat/idle-check.sh <<SCRIPT
#!/usr/bin/env bash
set -uo pipefail
docker run --rm --network host -v ${STATE_DIR}:${STATE_DIR} -v /opt/longcat:/opt/longcat:ro \\
	-e IDLE_MINUTES=${IDLE_MINUTES} -e GRACE_MINUTES=${GRACE_MINUTES} -e IDLE_LOG_PATH=${STATE_DIR}/task-log.json \\
	node:22-alpine node /opt/longcat/idle-shutdown.mjs
code=\$?
if [[ "\${code}" -eq 10 ]]; then
	logger -t longcat-idle "idle timeout reached, powering off"
	/sbin/shutdown -h now "longcat idle timeout"
fi
SCRIPT
chmod 0755 /opt/longcat/idle-check.sh

cat >/etc/systemd/system/longcat.service <<UNIT
[Unit]
Description=LongCat video avatar worker
After=docker.service network-online.target
Requires=docker.service

[Service]
ExecStart=/opt/longcat/start-worker.sh
ExecStop=/usr/bin/docker stop longcat
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/longcat-tls.service <<UNIT
[Unit]
Description=TLS front for the LongCat worker
After=docker.service network-online.target
Requires=docker.service

[Service]
ExecStartPre=-/usr/bin/docker rm -f longcat-tls
ExecStart=/usr/bin/docker run --rm --name longcat-tls --network host -v /opt/longcat/Caddyfile:/etc/caddy/Caddyfile:ro -v ${STATE_DIR}/caddy:/data caddy:2
ExecStop=/usr/bin/docker stop longcat-tls
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/longcat-idle.service <<UNIT
[Unit]
Description=LongCat idle-shutdown check

[Service]
Type=oneshot
ExecStart=/opt/longcat/idle-check.sh
UNIT

cat >/etc/systemd/system/longcat-idle.timer <<UNIT
[Unit]
Description=Run the LongCat idle-shutdown check every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now longcat.service longcat-tls.service longcat-idle.timer
echo "==> longcat host converged"
