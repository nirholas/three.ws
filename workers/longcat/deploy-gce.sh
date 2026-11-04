#!/usr/bin/env bash
# Create or converge the LongCat GPU host on Compute Engine. Idempotent: every
# step checks before it creates, so a re-run only repairs what drifted. No secret
# lives in this file: the worker's API key is read from Secret Manager by the VM.
#
#   workers/longcat/deploy-gce.sh              # converge and leave the VM running
#   workers/longcat/deploy-gce.sh --no-start   # converge, then stop the VM (no GPU billing)
#   workers/longcat/deploy-gce.sh --wait       # also wait for /health to report model_loaded
#
# Environment (all optional):
#   GCP_PROJECT     aerial-vehicle-466722-p5
#   ZONE            us-central1-a
#   MACHINE_TYPE    a2-ultragpu-1g (1x A100-80GB) or a3-highgpu-1g (1x H100-80GB)
#   PROVISIONING    STANDARD (default) or SPOT
#   IMAGE_URI       worker image (default: the :latest tag in Artifact Registry)
#   IDLE_MINUTES    idle window before the host halts itself (default 20)
#   GRACE_MINUTES   boot grace so a waking caller can submit a job (default 15)
#
# Access: the VM has one static external IP. Caddy terminates TLS for
# <ip-with-dashes>.sslip.io (a real Let's Encrypt certificate, no domain needed)
# and proxies to the worker, which compares bearer tokens in constant time. The
# firewall opens 80 (ACME) and 443 only. LONGCAT_WORKER_URL is the https URL
# this script prints; the IP is reserved, so it survives stop/start.
set -euo pipefail

PROJECT="${GCP_PROJECT:-aerial-vehicle-466722-p5}"
ZONE="${ZONE:-us-central1-a}"
REGION="${ZONE%-*}"
MACHINE_TYPE="${MACHINE_TYPE:-a2-ultragpu-1g}"
PROVISIONING="${PROVISIONING:-STANDARD}"
NAME="${INSTANCE_NAME:-longcat-avatar}"
IP_NAME="${NAME}-ip"
FIREWALL="${NAME}-https"
SA_NAME="avatar-reconstruction-sa"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
SECRET="longcat-video-avatar-key"
WEIGHTS_BUCKET="three-ws-model-weights"
OUTPUT_BUCKET="three-ws-avatar-reconstructions"
IMAGE_URI="${IMAGE_URI:-${REGION}-docker.pkg.dev/${PROJECT}/longcat-video-avatar/server:latest}"
IDLE_MINUTES="${IDLE_MINUTES:-20}"
GRACE_MINUTES="${GRACE_MINUTES:-15}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

START=1
WAIT=0
for arg in "$@"; do
	case "${arg}" in
		--no-start) START=0 ;;
		--wait) WAIT=1 ;;
		-h|--help) sed -n '2,24p' "$0"; exit 0 ;;
		*) echo "unknown argument: ${arg}" >&2; exit 2 ;;
	esac
done

gc() { gcloud --project "${PROJECT}" "$@"; }

echo "==> checking the weights are staged"
if ! gc storage ls "gs://${WEIGHTS_BUCKET}/longcat/weights.sha256" >/dev/null 2>&1; then
	echo "weights are not staged in gs://${WEIGHTS_BUCKET}/longcat/ (run the stage-weights Cloud Build job first)" >&2
	exit 1
fi

echo "==> static IP ${IP_NAME}"
if ! gc compute addresses describe "${IP_NAME}" --region "${REGION}" >/dev/null 2>&1; then
	gc compute addresses create "${IP_NAME}" --region "${REGION}"
fi
IP="$(gc compute addresses describe "${IP_NAME}" --region "${REGION}" --format='value(address)')"
PUBLIC_HOST="${IP//./-}.sslip.io"

echo "==> firewall ${FIREWALL}"
if ! gc compute firewall-rules describe "${FIREWALL}" >/dev/null 2>&1; then
	gc compute firewall-rules create "${FIREWALL}" --network default --direction INGRESS \
		--allow tcp:80,tcp:443 --target-tags "${NAME}" --source-ranges 0.0.0.0/0
fi

echo "==> service account access"
gc secrets add-iam-policy-binding "${SECRET}" --member "serviceAccount:${SA_EMAIL}" \
	--role roles/secretmanager.secretAccessor --condition=None >/dev/null
gc storage buckets add-iam-policy-binding "gs://${WEIGHTS_BUCKET}" --member "serviceAccount:${SA_EMAIL}" \
	--role roles/storage.objectViewer >/dev/null
gc storage buckets add-iam-policy-binding "gs://${OUTPUT_BUCKET}" --member "serviceAccount:${SA_EMAIL}" \
	--role roles/storage.objectAdmin >/dev/null
gc artifacts repositories add-iam-policy-binding longcat-video-avatar --location "${REGION}" \
	--member "serviceAccount:${SA_EMAIL}" --role roles/artifactregistry.reader >/dev/null
gc projects add-iam-policy-binding "${PROJECT}" --member "serviceAccount:${SA_EMAIL}" \
	--role roles/datastore.user --condition=None >/dev/null

echo "==> letting the API wake this one host (compute.instances.start/get, scoped to the instance)"
gc projects add-iam-policy-binding "${PROJECT}" --member "serviceAccount:three-ws@${PROJECT}.iam.gserviceaccount.com" \
	--role roles/compute.instanceAdmin.v1 \
	--condition="title=longcat-wake,expression=resource.name == \"projects/${PROJECT}/zones/${ZONE}/instances/${NAME}\"" >/dev/null

METADATA="longcat-image=${IMAGE_URI},weights-uri=gs://${WEIGHTS_BUCKET}/longcat,output-bucket=${OUTPUT_BUCKET},firestore-project=${PROJECT},api-key-secret=${SECRET},public-host=${PUBLIC_HOST},idle-minutes=${IDLE_MINUTES},grace-minutes=${GRACE_MINUTES}"
FILES="startup-script=${HERE}/host/startup.sh,idle-shutdown-js=${HERE}/scripts/idle-shutdown.mjs"

echo "==> instance ${NAME} (${MACHINE_TYPE}, ${PROVISIONING})"
if gc compute instances describe "${NAME}" --zone "${ZONE}" >/dev/null 2>&1; then
	gc compute instances add-metadata "${NAME}" --zone "${ZONE}" \
		--metadata "${METADATA}" --metadata-from-file "${FILES}" >/dev/null
	echo "instance exists, metadata refreshed"
else
	extra=()
	if [[ "${PROVISIONING}" == "SPOT" ]]; then
		extra+=(--provisioning-model SPOT --instance-termination-action STOP)
	fi
	gc compute instances create "${NAME}" --zone "${ZONE}" --machine-type "${MACHINE_TYPE}" \
		--maintenance-policy TERMINATE --address "${IP}" --tags "${NAME}" \
		--image-family common-cu129-ubuntu-2204-nvidia-580 --image-project deeplearning-platform-release \
		--boot-disk-size 300GB --boot-disk-type pd-ssd \
		--service-account "${SA_EMAIL}" --scopes cloud-platform \
		--metadata "${METADATA}" --metadata-from-file "${FILES}" "${extra[@]}"
fi

STATUS="$(gc compute instances describe "${NAME}" --zone "${ZONE}" --format='value(status)')"
if [[ "${START}" -eq 0 ]]; then
	[[ "${STATUS}" == "RUNNING" ]] && gc compute instances stop "${NAME}" --zone "${ZONE}"
	echo "host converged and stopped. Start it with: node workers/longcat/scripts/host.mjs ensure"
elif [[ "${STATUS}" != "RUNNING" ]]; then
	gc compute instances start "${NAME}" --zone "${ZONE}"
fi

echo
echo "LONGCAT_WORKER_URL=https://${PUBLIC_HOST}"
if [[ "${WAIT}" -eq 1 && "${START}" -eq 1 ]]; then
	echo "==> waiting for model_loaded (first boot syncs and verifies about 45 GB, allow 20 minutes)"
	for _ in $(seq 1 120); do
		if curl -fsS --max-time 10 "https://${PUBLIC_HOST}/health" 2>/dev/null | grep -q '"model_loaded":true'; then
			echo "healthy"
			exit 0
		fi
		sleep 15
	done
	echo "host did not report model_loaded within 30 minutes; read the serial console: gcloud compute instances get-serial-port-output ${NAME} --zone ${ZONE}" >&2
	exit 1
fi
